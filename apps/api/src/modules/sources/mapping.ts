import type pg from 'pg';
import { similarity, stripFmt, paragraphText, type Paragraph } from '@wecom/shared';
import type { LinkedStep } from '@wecom/model';

const anchor = (ref: string) => ref.replace(/^§/, '');

/** Minimum similarity for an automatic paragraph → step mapping proposal. */
export const MAP_THRESHOLD = 0.6;

export interface MappingProposal {
  ref: string;
  documentId: string;
  stepKey: string;
  score: number;
}

/** Keeps `document_links(derived_from_source)` and `steps.source_ref` in sync with a source. */
export class MappingService {
  constructor(private readonly pool: pg.Pool) {}

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
