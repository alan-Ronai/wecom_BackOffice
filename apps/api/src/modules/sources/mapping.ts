import type pg from 'pg';
import { similarity, stripFmt, paragraphText, type Paragraph } from '@wecom/shared';
import type { LinkedStep, ModelClient } from '@wecom/model';
import { embedMany } from './embeddings.js';

const anchor = (ref: string) => ref.replace(/^§/, '');

/** Minimum similarity for an automatic paragraph → step mapping proposal. */
export const MAP_THRESHOLD = 0.6;

/**
 * Wave 6 (X1), spec §1.10. Minimum cosine for an *embedding*-based mapping. Higher than
 * `MAP_THRESHOLD` because cosine over a multilingual embedder is generous — two unrelated
 * support paragraphs in Hebrew sit around 0.6 — and a wrong mapping is worse than none: it
 * anchors a step to the wrong paragraph and every later revision proposes against it.
 */
export const EMBED_MAP_THRESHOLD = 0.78;

export interface MappingProposal {
  ref: string;
  documentId: string;
  stepKey: string;
  score: number;
}

/** Keeps `document_links(derived_from_source)` and `steps.source_ref` in sync with a source. */
export class MappingService {
  constructor(
    private readonly pool: pg.Pool,
    /** Wave 6 (X1): embedding-based mapping when the model can embed; trigram otherwise. */
    private readonly model: ModelClient | null = null,
  ) {}

  /** Every step anchored to a paragraph of this source, with the actions the model should see. */
  async linkedSteps(sourceId: string): Promise<LinkedStep[]> {
    const r = await this.pool.query(
      `select d.id as document_id, d.title as document_title, s.step_key, s.num, s.title, s.source_ref, s.block_id,
          coalesce((select array_agg(text order by position) from step_actions a where a.step_id=s.id), '{}') as actions,
          coalesce((select array_agg(text order by position) from block_actions ba where ba.block_id=s.block_id), '{}') as block_actions
        from document_links l
        join documents d on d.id=l.from_document_id and d.deleted_at is null
        join steps s on s.document_id=d.id and s.step_key=l.from_step_key
        where l.to_source_id=$1 and l.type='derived_from_source' and s.source_ref is not null
        order by d.title, s.position`,
      [sourceId],
    );
    return r.rows.map((x) => ({
      documentId: x.document_id,
      documentTitle: x.document_title,
      stepKey: x.step_key,
      stepNum: x.num,
      stepTitle: x.title,
      anchor: anchor(x.source_ref),
      actions: (x.block_id ? x.block_actions : x.actions) as string[],
      blockId: x.block_id ?? undefined,
    }));
  }

  /** First-import helper: best-matching step per paragraph among documents not yet linked here. */
  async proposeInitialMapping(sourceId: string, paragraphs: Paragraph[]): Promise<MappingProposal[]> {
    /**
     * Wave 6 (X1): cosine over `step_embeddings` first. Trigram similarity compares *characters*,
     * so a paragraph that says the same thing in different words mapped to nothing and the whole
     * revision came back as `new-card`s. The embedding pass falls through to trigram whenever the
     * model cannot embed, the vectors are missing (a fresh 0051 column before `ai.reindex`) or
     * nothing cleared the threshold — the pre-wave-6 behaviour, unchanged.
     */
    const embedded = await this.embeddingMapping(sourceId, paragraphs);
    if (embedded.length) return embedded;
    const r = await this.pool.query(
      `select d.id as document_id, s.step_key, s.title,
          coalesce((select string_agg(text, ' ' order by position) from step_actions a where a.step_id=s.id), '') as actions
        from steps s join documents d on d.id=s.document_id and d.deleted_at is null
        where not exists (select 1 from document_links l where l.from_document_id=d.id and l.to_source_id=$1)`,
      [sourceId],
    );
    const out: MappingProposal[] = [];
    for (const p of paragraphs) {
      const text = stripFmt(paragraphText(p));
      let best: { documentId: string; stepKey: string; score: number } | null = null;
      for (const s of r.rows) {
        const score = similarity(text, stripFmt(s.title + ' ' + s.actions));
        if (score >= MAP_THRESHOLD && (!best || score > best.score))
          best = { documentId: s.document_id, stepKey: s.step_key, score };
      }
      if (best) out.push({ ref: p.ref, ...best });
    }
    return out;
  }

  /** The embedding half of `proposeInitialMapping`; `[]` means "nothing to say, use trigram". */
  private async embeddingMapping(sourceId: string, paragraphs: Paragraph[]): Promise<MappingProposal[]> {
    if (!this.model?.embed || !paragraphs.length) return [];
    const texts = paragraphs.map((p) => stripFmt(paragraphText(p)));
    let vecs: number[][] = [];
    try {
      vecs = await embedMany(this.model, texts);
    } catch {
      return [];
    }
    if (vecs.length !== paragraphs.length) return [];
    const out: MappingProposal[] = [];
    for (let i = 0; i < paragraphs.length; i++) {
      const best = await this.pool.query(
        `select e.document_id, s.step_key, 1 - (e.embedding <=> $1::vector) as score
           from step_embeddings e join steps s on s.id = e.step_id
           join documents d on d.id = e.document_id and d.deleted_at is null
          where not exists (select 1 from document_links l where l.from_document_id=d.id and l.to_source_id=$2)
          order by e.embedding <=> $1::vector limit 1`,
        [JSON.stringify(vecs[i]), sourceId],
      );
      const b = best.rows[0];
      if (b && Number(b.score) >= EMBED_MAP_THRESHOLD)
        out.push({
          ref: paragraphs[i].ref,
          documentId: b.document_id as string,
          stepKey: b.step_key as string,
          score: Number(b.score),
        });
    }
    return out;
  }

  async confirmMapping(
    sourceId: string,
    pairs: { ref: string; documentId: string; stepKey: string }[],
  ): Promise<void> {
    for (const p of pairs) {
      await this.pool.query(`update steps set source_ref=$3 where document_id=$1 and step_key=$2`, [
        p.documentId,
        p.stepKey,
        '§' + anchor(p.ref),
      ]);
      // M2: `where not exists` is a check, not a guarantee — two editors confirming the same
      // mapping read "absent" in the same instant and both insert, and since 0037 gave
      // `document_links` its edge-identity unique index the loser gets a 23505 out of a plain
      // 500. `on conflict do nothing` is the same intent expressed atomically, and is what the
      // other three writers of this edge (`seed.ts`, `suggestions.ts` twice) already use.
      await this.pool.query(
        `insert into document_links(from_document_id, from_step_key, to_source_id, type, origin)
         values ($1,$2,$3,'derived_from_source','explicit') on conflict do nothing`,
        [p.documentId, p.stepKey, sourceId],
      );
      await this.pool.query(`update documents set source_id=coalesce(source_id,$2) where id=$1`, [
        p.documentId,
        sourceId,
      ]);
    }
  }
}
