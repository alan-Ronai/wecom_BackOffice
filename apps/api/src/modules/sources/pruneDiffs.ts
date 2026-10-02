import type pg from 'pg';

/**
 * Wave Y · A-M7, owner decision 3 (2026-09-29). `processRevision` stores every non-`same`
 * paragraph diff — before *and* after text — in `source_revisions.meta->'diffs'`, so a large
 * WordPress source kept roughly a second copy of the document per revision, forever.
 *
 * The rule: a revision keeps its full diffs when it is one of the newest `KEEP_FULL_DIFFS` of its
 * source, **or** any suggestion references it. Every other revision keeps only the counts
 * (`meta.diffCounts`, per diff kind) and the moment it was pruned (`meta.prunedAt`).
 *
 * Why the two readers are unaffected:
 * - `fewShotExamples` reads the diff text of revisions behind *accepted/applied suggestions* —
 *   always kept by the second arm — and already falls back to the anchor alone when a revision
 *   has no diffs (pre-wave-6 rows), so even a pruned row would degrade, not break.
 * - The acceptance analytics (`sources/analytics.ts`) join `source_revisions` for `source_id`
 *   only and never read `meta`.
 *
 * Idempotent: a pruned row has no `diffs` key, so the next run skips it.
 */
export const KEEP_FULL_DIFFS = 20;

export async function pruneRevisionDiffs(
  q: Pick<pg.Pool, 'query'>,
  keep: number = KEEP_FULL_DIFFS,
): Promise<number> {
  const r = await q.query(
    `with ranked as (
       select id, row_number() over (partition by source_id order by imported_at desc, id desc) rn
         from source_revisions
     )
     update source_revisions sr
        set meta = (sr.meta - 'diffs') || jsonb_build_object(
              'diffCounts', coalesce((
                select jsonb_object_agg(k, n) from (
                  select coalesce(d->>'kind', 'unknown') k, count(*)::int n
                    from jsonb_array_elements(sr.meta->'diffs') d group by 1) c), '{}'::jsonb),
              'prunedAt', to_jsonb(now()))
       from ranked r
      where r.id = sr.id
        and r.rn > $1
        and jsonb_typeof(sr.meta->'diffs') = 'array'
        and not exists (select 1 from suggestions g where g.source_revision_id = sr.id)`,
    [keep],
  );
  return r.rowCount ?? 0;
}
