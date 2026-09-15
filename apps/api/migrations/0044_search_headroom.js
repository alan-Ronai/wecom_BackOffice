/**
 * §11 / F-5 search headroom: trigram indexes for every column `search()` matches with
 * `ilike '%…%'`.
 *
 * Measured first (`pnpm --filter @wecom/api perf:load`, 5,000 documents / 46,002 steps, 20
 * concurrent clients, 60 s — see `.superpowers/sdd/program/perf-search-report.md`): the NFR
 * "search p95 < 500 ms at 5,000 documents" did **not** hold. Overall p95 was 2,577 ms and every
 * query class except the world-filtered one sat between 2.4 s and 3.1 s. All three slowest
 * statement shapes were the same one — the `steps` group — and each burned ~235,000 shared
 * buffer hits, because
 *
 *     coalesce((select string_agg(a.text, ' ') from step_actions a where a.step_id=s.id),'')
 *         ilike '%word%'
 *
 * is a correlated aggregate evaluated once per candidate step: a sequential scan of all 46,002
 * steps, each one re-reading that step's `step_actions` rows to build a string it then throws
 * away.
 *
 * Indexes alone cannot fix that shape, and this migration does not pretend otherwise. An `or`
 * that spans a correlated subquery and an outer-joined column (`coalesce(b.title,'')`) has no
 * index the planner can use for the predicate as a whole, so no index added here changes the
 * `steps` plan while the query is written that way. What this migration does is:
 *
 *   1. make the groups that *are* index-fixable index-driven today — `documents` (title,
 *      description, code) and `scripts` (title, body_html), which were full scans of
 *      `documents` because only `title` had a trigram index (0007) and a bitmap OR needs every
 *      arm to be indexable; and
 *   2. put in place exactly the indexes the proposed `repo.ts` rewrite needs, so that change is
 *      a query-only diff for the owning session with no migration attached. The rewrite turns
 *      each word's predicate into a union of indexable arms over `steps` and `step_actions`.
 *      Without these indexes it is worth nothing; with them, the same two-word statement goes
 *      from 229,404 buffers / 201 ms to 18,736 buffers / 41 ms, and the load profile's overall
 *      p95 from 2,488 ms to 676 ms at 3.5x the throughput. The proposal, the exact diff and the
 *      plans are in the report.
 *
 * The `blocks` group is deliberately **not** indexed here (post-pilot M6). Its predicate ORs
 * `title`, `coalesce(description,'')`, `coalesce(script,'')` and the `block_actions` aggregate,
 * and this migration's own rule is that a bitmap OR needs *every* arm indexable — so a lone
 * `blocks_title_trgm` could never be chosen for that predicate. It would have been GIN
 * maintenance on every blocks write bought for nothing. When the blocks arms are split the way
 * the steps arms are, they get their indexes in the change that makes them readable.
 *
 * This migration on its own does **not** restore the NFR, and the report says so in those words:
 * measured with the indexes and without the query change, overall p95 was 2,488 ms against a
 * 2,577 ms baseline — indistinguishable, because the plan for the group that dominates the
 * profile is unchanged. Adding them anyway is still right: they are the prerequisite for the fix,
 * they are the fix for the two groups that *are* index-fixable, and leaving them out would make
 * the query change land with no measurable effect and look wrong.
 *
 * Every index is on the *expression the query actually writes* (`coalesce(x,'')`, not `x`), or
 * the planner will not match it. `pg_trgm` is already installed (migration 0001).
 *
 * Cost: GIN trigram indexes are write-amplifying. The write paths here are document publish and
 * pipeline ingest — batched, not per-keystroke — and `gin_pending_list_limit` defers most of the
 * work off the inserting transaction, so this is the right trade for a read-dominated library.
 */

/** name → `create index` body, so `down` is just the names. */
const INDEXES = {
  // ── documents group: `d.title or coalesce(d.description,'') or coalesce(d.code,'')` ──
  // 0007 already indexes `title`; a bitmap OR is only possible when every arm has an index.
  documents_description_trgm: `create index documents_description_trgm on documents using gin ((coalesce(description,'')) gin_trgm_ops)`,
  documents_code_trgm: `create index documents_code_trgm on documents using gin ((coalesce(code,'')) gin_trgm_ops)`,
  // ── scripts group: `d.title or coalesce(d.body_html,'')` over type-T/text documents ──
  documents_body_html_trgm: `create index documents_body_html_trgm on documents using gin ((coalesce(body_html,'')) gin_trgm_ops)`,
  // ── steps group: the arms the proposed union rewrite scans ──
  steps_title_trgm: `create index steps_title_trgm on steps using gin (title gin_trgm_ops)`,
  steps_description_trgm: `create index steps_description_trgm on steps using gin ((coalesce(description,'')) gin_trgm_ops)`,
  steps_script_trgm: `create index steps_script_trgm on steps using gin ((coalesce(script,'')) gin_trgm_ops)`,
  step_actions_text_trgm: `create index step_actions_text_trgm on step_actions using gin (text gin_trgm_ops)`,
};

exports.up = (pgm) => {
  for (const sql of Object.values(INDEXES)) pgm.sql(sql);
  // Everything above was just built; the planner should cost it with fresh statistics.
  pgm.sql('analyze documents');
  pgm.sql('analyze steps');
  pgm.sql('analyze step_actions');
};

exports.down = (pgm) => {
  for (const name of Object.keys(INDEXES).reverse()) pgm.sql(`drop index if exists ${name}`);
};
