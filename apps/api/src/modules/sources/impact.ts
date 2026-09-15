import type pg from 'pg';
import type { ImpactSet, ProposedSuggestion } from '@wecom/model';
import type { AffectsItem } from '@wecom/shared';
import { inboundFor } from '../graph/repo.js';

export interface StepRef {
  documentId: string;
  stepKey: string;
  blockId?: string;
}
export interface ImpactOptions {
  relatedK?: number;
  scopes?: string[] | null;
}

/**
 * Wave 6 (X1): the blast radius of a change, so the model (and the editor) see what else a
 * suggestion touches. Everything here is a read over tables other lanes own; nothing is cached
 * because a proposal runs once per revision and a chat tool call is already a round trip.
 *
 * `affects` is deliberately computed here rather than asked of the model (spec §1.6): a model
 * cannot claim a change touches a document it never saw, and the `usedBy` counts are the
 * difference between "rewrite this action" and "this action appears in nine documents".
 */
export class ImpactService {
  constructor(private readonly pool: pg.Pool) {}

  async impactForSteps(steps: StepRef[], opts: ImpactOptions = {}): Promise<ImpactSet> {
    const docIds = [...new Set(steps.map((s) => s.documentId))];
    const stepKeys = [...new Set(steps.map((s) => s.stepKey))];
    const impact: ImpactSet = { documents: [], blocks: [], fields: [], topics: [], related: [] };
    if (!docIds.length) return impact;

    // Shared blocks: the step's own block plus its block_refs, with how many live documents use each.
    const blocks = await this.pool.query(
      `with touched as (
         select distinct coalesce(s.block_id, r.ref) as block_id
           from steps s left join lateral unnest(s.block_refs) r(ref) on true
          where s.document_id = any($1::uuid[]) and s.step_key = any($2::text[])
            and coalesce(s.block_id, r.ref) is not null)
       select b.id, b.title,
              (select count(distinct s2.document_id) from steps s2
                 join documents d2 on d2.id = s2.document_id and d2.deleted_at is null
                where s2.block_id = b.id or b.id = any(s2.block_refs))::int as used_by
         from touched t join blocks b on b.id = t.block_id::uuid and b.deleted_at is null
        order by b.title`,
      [docIds, stepKeys],
    );
    impact.blocks = blocks.rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      usedBy: r.used_by as number,
    }));

    // CRM fields referenced by the steps, with how many live documents reference each.
    const fields = await this.pool.query(
      `select f.field_name as name,
              (select count(distinct s3.document_id) from step_field_refs f3
                 join steps s3 on s3.id = f3.step_id
                 join documents d3 on d3.id = s3.document_id and d3.deleted_at is null
                where f3.field_name = f.field_name)::int as used_by
         from step_field_refs f join steps s on s.id = f.step_id
        where s.document_id = any($1::uuid[]) and s.step_key = any($2::text[])
        group by f.field_name order by 1`,
      [docIds, stepKeys],
    );
    impact.fields = fields.rows.map((r) => ({
      name: r.name as string,
      usedBy: r.used_by as number,
    }));

    // Documents pointing at the changed documents (links, goto, related, shares_block…), via the graph.
    const seen = new Map<string, { id: string; title: string; why: string }>();
    for (const id of docIds) {
      const rows = await inboundFor(this.pool, { kind: 'document', key: id }, opts.scopes ?? null, true);
      for (const r of rows)
        if (!docIds.includes(r.documentId) && !seen.has(r.documentId))
          seen.set(r.documentId, { id: r.documentId, title: r.title, why: WHY[r.type] ?? r.type });
    }
    impact.documents = [...seen.values()];

    // Topic siblings.
    const topics = await this.pool.query(
      `select distinct t.id, t.name from document_topics dt join topics t on t.id = dt.topic_id and t.active
        where dt.document_id = any($1::uuid[]) order by t.name`,
      [docIds],
    );
    impact.topics = topics.rows.map((r) => ({ id: r.id as string, name: r.name as string }));

    // Related by embedding (cosine), excluding the changed documents themselves. A document
    // with no vector yet (a fresh 0051 column before `ai.reindex` ran) simply contributes none.
    const k = opts.relatedK ?? 5;
    const related = await this.pool.query(
      `select d.id, d.title, 1 - (d.embedding <=> src.embedding) as sim
         from documents src, documents d
        where src.id = $1 and src.embedding is not null and d.embedding is not null
          and d.deleted_at is null and d.status in ('published','partial') and d.id <> all($2::uuid[])
        order by d.embedding <=> src.embedding limit $3`,
      [docIds[0], docIds, k],
    );
    impact.related = related.rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      similarity: Number(r.sim),
    }));
    return impact;
  }

  /** What X2's `read_impact` tool calls: the whole document's radius, not one changed step. */
  async impactForDocument(documentId: string, opts: ImpactOptions = {}): Promise<ImpactSet> {
    const steps = await this.pool.query(
      `select step_key, block_id from steps where document_id=$1 order by position`,
      [documentId],
    );
    return this.impactForSteps(
      steps.rows.map((r) => ({
        documentId,
        stepKey: r.step_key as string,
        blockId: (r.block_id as string | null) ?? undefined,
      })),
      opts,
    );
  }

  /** The subset of the impact set a single suggestion actually touches. */
  affectsFor(impact: ImpactSet, s: ProposedSuggestion): AffectsItem[] {
    const out: AffectsItem[] = [];
    if (s.targetBlockId) {
      const b = impact.blocks.find((x) => x.id === s.targetBlockId);
      if (b) out.push({ kind: 'block', id: b.id, title: b.title, why: `בלוק משותף ב-${b.usedBy} מסמכים` });
    }
    if (s.type === 'field-alert') {
      const name = (s.payload as { fieldName?: string }).fieldName;
      const f = impact.fields.find((x) => x.name === name);
      if (f) out.push({ kind: 'field', id: f.name, title: f.name, why: `שדה CRM ב-${f.usedBy} מסמכים` });
    }
    for (const d of impact.documents) out.push({ kind: 'document', id: d.id, title: d.title, why: d.why });
    for (const t of impact.topics) out.push({ kind: 'topic', id: t.id, title: t.name, why: 'נושא משותף' });
    return out;
  }

  /** Hebrew bullets for the prompt / chat, cut to `maxChars` on a line boundary. */
  formatImpact(impact: ImpactSet, maxChars: number): string {
    return formatImpactLines(impact, maxChars);
  }
}

/**
 * Shared with `@wecom/model`'s prompt assembler, which cannot import the api and therefore
 * keeps its own copy of these thirty lines (`packages/model/src/prompt.ts`). Both must render
 * the same shape, so the eval harness and production show the model the same text.
 */
export function formatImpactLines(impact: ImpactSet, maxChars: number): string {
  const lines: string[] = [];
  for (const b of impact.blocks)
    lines.push(`- בלוק משותף "${b.title}" (blockId=${b.id}) בשימוש ב-${b.usedBy} מסמכים`);
  for (const f of impact.fields) lines.push(`- שדה CRM "${f.name}" בשימוש ב-${f.usedBy} מסמכים`);
  for (const d of impact.documents) lines.push(`- מסמך "${d.title}" (documentId=${d.id}) — ${d.why}`);
  for (const t of impact.topics) lines.push(`- נושא "${t.name}"`);
  for (const r of impact.related)
    lines.push(`- מסמך קרוב "${r.title}" (documentId=${r.id}, דמיון ${r.similarity.toFixed(2)})`);
  let out = '';
  for (const l of lines) {
    if (out.length + l.length + 1 > maxChars) {
      // A budget too small for even the first line still has to say *something* about the
      // impact — an answer consisting only of an ellipsis is worse than a cut first bullet.
      if (!out) return maxChars > 1 ? lines[0].slice(0, maxChars - 1) + '…' : '';
      out += '\n- …';
      break;
    }
    out += (out ? '\n' : '') + l;
  }
  return out.length > maxChars ? out.slice(0, maxChars) : out;
}

/** `LinkType` (`packages/shared/src/schemas/content.ts`) in the editor's language. */
const WHY: Record<string, string> = {
  link: 'קישור מפורש',
  next: 'מעבר (goto) לשלב',
  prerequisite: 'תנאי מקדים',
  shares_block: 'משתמש באותו בלוק',
  same_field: 'משתמש באותו שדה CRM',
  related: 'מסמך קשור',
  derived_from_source: 'נגזר מאותו מקור',
};
