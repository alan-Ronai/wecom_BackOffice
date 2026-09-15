import type pg from 'pg';
import type { FewShotExample, ProposedSuggestion } from '@wecom/model';

/**
 * Wave 6 (X1), spec §1.7. Accepted (or applied) suggestions of the same types, preferring the
 * same source, then the same worlds. The stored `edited_payload` wins over `payload`: what the
 * editor kept is the example, not what the model first said — which is what turns the review
 * queue into a training signal without any training. Newest first, `limit` total.
 *
 * `source_revisions.meta->'diffs'` is written by `processRevision`, so revisions from before
 * wave 6 have no diff text and fall back to the anchor alone. That is still a usable example:
 * the suggestion JSON is the part the model is asked to imitate.
 */
export async function fewShotExamples(
  q: Pick<pg.Pool, 'query'>,
  opts: { sourceId: string; worldSlugs: string[]; types: string[]; limit?: number },
): Promise<FewShotExample[]> {
  const limit = opts.limit ?? 3;
  if (!opts.types.length) return [];
  const r = await q.query(
    `select s.anchor, s.type, s.title, s.target_document_id, s.target_step_key, s.target_block_id,
            coalesce(s.edited_payload, s.payload) as payload, s.confidence, s.rationale,
            (select string_agg(format('§%s %s: %s → %s', d->>'ref', d->>'kind', d->>'before', d->>'after'), '; ')
               from jsonb_array_elements(coalesce(sr.meta->'diffs', '[]'::jsonb)) d
              where d->>'ref' = regexp_replace(s.anchor,'^§','')) as diff,
            (sr.source_id = $1) as same_source
       from suggestions s
       join source_revisions sr on sr.id = s.source_revision_id
       left join documents doc on doc.id = s.target_document_id
      where s.status in ('accepted','applied') and s.type = any($3::text[])
        and (sr.source_id = $1 or doc.category = any($2::text[]) or exists (
              select 1 from document_worlds dw where dw.document_id = doc.id and dw.world_slug = any($2::text[])))
      order by same_source desc, s.decided_at desc nulls last limit $4`,
    [opts.sourceId, opts.worldSlugs, opts.types, limit],
  );
  return r.rows.map((x) => ({
    diff: (x.diff as string | null) ?? `§${String(x.anchor).replace(/^§/, '')}`,
    suggestion: {
      anchor: x.anchor,
      type: x.type,
      title: x.title,
      targetDocumentId: x.target_document_id,
      targetStepKey: x.target_step_key,
      targetBlockId: x.target_block_id,
      payload: x.payload,
      confidence: Number(x.confidence),
      rationale: x.rationale,
    } as ProposedSuggestion,
  }));
}
