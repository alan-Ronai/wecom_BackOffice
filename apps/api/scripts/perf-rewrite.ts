/**
 * The *proposed* `steps`-group predicate, as a transform over the statement `search()` already
 * issues.
 *
 * `apps/api/src/modules/search/repo.ts` belongs to another session, so this lane does not edit
 * it. To measure a proposal honestly it still has to run, so the rewrite is applied one layer
 * lower — to the SQL text on its way to the driver (`perf-load --rewrite-steps`,
 * `perf-sql`). Everything else about the request is unchanged: same route, same `search()`, same
 * parameters, same bindings. That makes the measurement a faithful preview of what the diff in
 * `.superpowers/sdd/program/perf-search-report.md` would do, and it makes the diff checkable —
 * `rewriteStepsToUnion` produces exactly the SQL the proposed TypeScript renders.
 *
 * What is being proposed and why
 * ------------------------------
 * `repo.ts` matches a step against one word with a five-way `or`:
 *
 *   (s.title ilike P or coalesce(s.description,'') ilike P
 *    or coalesce((select string_agg(a.text,' ') from step_actions a where a.step_id=s.id),'') ilike P
 *    or coalesce(s.script,'') ilike P or coalesce(b.title,'') ilike P)
 *
 * Two of those arms are unindexable *in principle*, not for want of an index: one is a
 * correlated aggregate, the other a column of an outer-joined table. An `or` is only index-driven
 * when every arm is, so the whole predicate falls back to a sequential scan of `steps` that
 * re-aggregates each step's actions — ~235,000 shared buffer hits and ~700 ms per query at 5,000
 * documents (46,002 steps).
 *
 * The rewrite says the same thing as a set of step ids, assembled from arms that each have an
 * index (migration 0044):
 *
 *   s.id in (select s1.id from steps s1 where s1.title ilike P or coalesce(s1.description,'') ilike P
 *                                              or coalesce(s1.script,'') ilike P
 *            union select a1.step_id from step_actions a1 where a1.text ilike P
 *            union select s2.id from steps s2 join blocks b1 on b1.id = s2.block_id
 *                   where b1.title ilike P)
 *
 * Semantics are identical with one disclosed exception: the old form could match a substring that
 * spans the `' '` joining two of a step's actions ("…foo" + "bar…" matching `%o b%`); the new form
 * matches within one action. `perf-sql` checks row-for-row equality over the sampled queries.
 */

/** The exact column text `repo.ts` renders for a step's aggregated action text. */
const AGG_COL = "coalesce((select string_agg(a.text, ' ') from step_actions a where a.step_id=s.id),'')";
const ESCAPE = " escape '\\'";
/** Start of one word's `or` group, as `wordClause` renders it for the `steps` column list. */
const GROUP_HEAD = '(s.title ilike ';

/** Start of one word's union group, as `repo.ts` renders it since the proposal landed. */
const UNION_HEAD = 's.id in (select s1.id from steps s1 where s1.title ilike ';

/** Only the `steps` group joins `steps` to `documents`; nothing else in `search()` does. */
export const isStepsStatement = (sql: string): boolean =>
  sql.includes('from steps s join documents d') && (sql.includes(AGG_COL) || sql.includes(UNION_HEAD));

/** True once `repo.ts` emits the union form — i.e. the proposal below has landed. */
export const isUnionForm = (sql: string): boolean => sql.includes(UNION_HEAD);

/**
 * The inverse of `rewriteStepsToUnion`: the pre-proposal five-way `or`, reconstructed from the
 * union form `repo.ts` now emits.
 *
 * The proposal landed in V6, so the A/B this file exists for can no longer be "current → candidate".
 * It is the same comparison read the other way: the statement the code issues is the candidate,
 * and the baseline is derived from it. Parameter numbering is untouched — both forms bind one
 * parameter per word and reference it five times — so one params array drives both.
 */
export function rewriteUnionToLegacy(sql: string): { sql: string; groups: number } {
  let out = '';
  let rest = sql;
  let groups = 0;
  for (;;) {
    const at = rest.indexOf(UNION_HEAD);
    if (at < 0) break;
    const patStart = at + UNION_HEAD.length;
    const escAt = rest.indexOf(ESCAPE, patStart);
    if (escAt < 0) break;
    const p = rest.slice(patStart, escAt);
    const tail = `where b1.title ilike ${p}${ESCAPE})`;
    const tailAt = rest.indexOf(tail, escAt);
    if (tailAt < 0) break;
    const end = tailAt + tail.length;
    out +=
      rest.slice(0, at) +
      `(s.title ilike ${p}${ESCAPE}` +
      ` or coalesce(s.description,'') ilike ${p}${ESCAPE}` +
      ` or ${AGG_COL} ilike ${p}${ESCAPE}` +
      ` or coalesce(s.script,'') ilike ${p}${ESCAPE}` +
      ` or coalesce(b.title,'') ilike ${p}${ESCAPE})`;
    rest = rest.slice(end);
    groups++;
  }
  return { sql: out + rest, groups };
}

export interface RewriteOptions {
  /**
   * The statement's bind parameters, and the `search_hebrew_stopwords` list. Given both, a word
   * that is a stopword is dropped from the `ilike` conjunction — proposal 2 in the report.
   *
   * `kb_tsquery` (migration 0027) already strips stopwords from the *ranking* side, on the
   * grounds that a word appearing in almost every document constrains nothing. The `ilike`
   * conjunction never got that treatment, so a three-word query like `של גלישה על` still requires
   * the literal substrings `של` and `על` — two characters each, which `pg_trgm` cannot index at
   * all (an ILIKE pattern needs three characters to produce a trigram), so those two words alone
   * force a sequential scan of `steps` and `step_actions` that the other word would have avoided.
   *
   * Dropping the term rather than deleting the parameter keeps the bind arity intact, which is
   * what lets this be measured without touching `repo.ts`: `($n is not null)` is always true for
   * a bound word and costs nothing. The proposed change in `repo.ts` would not push the parameter
   * in the first place.
   */
  params?: readonly unknown[];
  stopwords?: ReadonlySet<string>;
}

/**
 * Replaces each per-word five-way `or` group with the union-of-indexable-arms form.
 * Returns the rewritten SQL, how many groups were rewritten (one per query word), and how many
 * of those were dropped as stopwords. Zero groups means `repo.ts` no longer renders the shape
 * this was written against, which callers treat as an error rather than silently measuring the
 * unchanged statement.
 */
export function rewriteStepsToUnion(
  sql: string,
  opts: RewriteOptions = {},
): { sql: string; groups: number; dropped: number } {
  let out = '';
  let rest = sql;
  let groups = 0;
  let dropped = 0;
  const isStopword = (p: string): boolean => {
    if (!opts.params || !opts.stopwords) return false;
    const n = Number(/\$(\d+)/.exec(p)?.[1]);
    const v = Number.isFinite(n) ? opts.params[n - 1] : undefined;
    return typeof v === 'string' && opts.stopwords.has(v);
  };
  for (;;) {
    const at = rest.indexOf(GROUP_HEAD);
    if (at < 0) break;
    // The pattern expression is everything between `(s.title ilike ` and its ` escape '\'`.
    const patStart = at + GROUP_HEAD.length;
    const escAt = rest.indexOf(ESCAPE, patStart);
    if (escAt < 0) break;
    const p = rest.slice(patStart, escAt);
    // The group ends at the `)` closing `coalesce(b.title,'') ilike <p> escape '\'`.
    const tail = `coalesce(b.title,'') ilike ${p}${ESCAPE})`;
    const tailAt = rest.indexOf(tail, escAt);
    if (tailAt < 0) break;
    const end = tailAt + tail.length;
    if (isStopword(p)) {
      // Always true, and it keeps `$n` referenced so the bind arity is unchanged. The `::text`
      // is required, not cosmetic: `$n is not null` is the only remaining use of that parameter,
      // and with no other context Postgres cannot infer its type ("could not determine data type
      // of parameter $n") and the whole statement fails.
      out += rest.slice(0, at) + `(${/\$\d+/.exec(p)?.[0]}::text is not null)`;
      dropped++;
    } else {
      out +=
        rest.slice(0, at) +
        `s.id in (` +
        `select s1.id from steps s1 where s1.title ilike ${p}${ESCAPE}` +
        ` or coalesce(s1.description,'') ilike ${p}${ESCAPE}` +
        ` or coalesce(s1.script,'') ilike ${p}${ESCAPE}` +
        ` union select a1.step_id from step_actions a1 where a1.text ilike ${p}${ESCAPE}` +
        ` union select s2.id from steps s2 join blocks b1 on b1.id = s2.block_id` +
        ` where b1.title ilike ${p}${ESCAPE})`;
    }
    rest = rest.slice(end);
    groups++;
  }
  return { sql: out + rest, groups, dropped };
}

/** `rewriteStepsToUnion` applied only to the `steps` statement, otherwise a pass-through. */
export const maybeRewrite = (sql: string, opts: RewriteOptions = {}): string =>
  isStepsStatement(sql) ? rewriteStepsToUnion(sql, opts).sql : sql;
