import { describe, it, expect } from 'vitest';
import { resetStopwordCache, search } from '../../src/modules/search/repo.js';
import {
  isStepsStatement,
  isUnionForm,
  maybeRewrite,
  rewriteStepsToUnion,
  rewriteUnionToLegacy,
} from '../../scripts/perf-rewrite.js';

/**
 * `perf-rewrite.ts` is a string transform over SQL that `repo.ts` renders, and a string transform
 * over someone else's SQL rots the moment that SQL changes. These tests feed it the *real*
 * statements — `search()` driven by a stub `Q` that answers no rows, so every group runs without
 * a database — and fail loudly if the shape it targets is no longer the shape `repo.ts` emits.
 * That matters because the alternative failure is silent: `perf-load --rewrite-steps` would
 * measure the unchanged query and report the proposal as free.
 *
 * V6 landed the proposal, so the direction is reversed: `repo.ts` emits the union form and
 * `rewriteUnionToLegacy` reconstructs the pre-0044 baseline the A/B measures against.
 */
const capture = async (q: string, opts: { world?: string; scopes?: string[]; stopwords?: string[] } = {}) => {
  // A-M3 gave the stopword list a one-minute process-wide cache, and this helper changes what the
  // table answers between calls — which is exactly the case the cache cannot see. Dropping it per
  // capture keeps each call measuring the list it asked for.
  resetStopwordCache();
  const seen: { sql: string; params: unknown[] }[] = [];
  const stub = {
    query: async (sql: string, params?: unknown[]) => {
      seen.push({ sql, params: params ?? [] });
      // `search()` reads the stopword list before building the `ilike` conjunction.
      if (sql.includes('search_hebrew_stopwords'))
        return {
          rows: (opts.stopwords ?? []).map((word) => ({ word })),
          rowCount: (opts.stopwords ?? []).length,
        };
      return { rows: [], rowCount: 0 };
    },
  };
  await search(
    stub as never,
    { q, limit: 40, ...(opts.world ? { world: opts.world } : {}) } as never,
    null,
    opts.scopes ?? null,
    true,
  );
  return seen;
};

describe('perf-rewrite against the real search() SQL', () => {
  it('finds exactly one steps statement per search', async () => {
    const seen = await capture('גלישה');
    expect(seen.filter((s) => isStepsStatement(s.sql))).toHaveLength(1);
  });

  it('emits the union form, one group per query word', async () => {
    const one = (await capture('גלישה')).find((s) => isStepsStatement(s.sql))!;
    const two = (await capture('בדיקת גלישה')).find((s) => isStepsStatement(s.sql))!;
    expect(isUnionForm(one.sql)).toBe(true);
    expect(rewriteUnionToLegacy(one.sql).groups).toBe(1);
    expect(rewriteUnionToLegacy(two.sql).groups).toBe(2);
  });

  it('keeps the correlated aggregate out of the predicate, and reconstructs it for the baseline', async () => {
    const steps = (await capture('גלישה')).find((s) => isStepsStatement(s.sql))!;
    // The select list still projects the first action; only the *predicate* changed.
    expect(steps.sql).not.toContain('string_agg');
    expect(steps.sql).toContain('union select a1.step_id from step_actions a1');
    expect(steps.sql).toContain('join blocks b1 on b1.id = s2.block_id');
    expect(steps.sql).toContain('s.id in (');
    // …and the baseline the A/B measures against is the shape that used to be emitted.
    const base = rewriteUnionToLegacy(steps.sql).sql;
    expect(base).toContain('string_agg');
    expect(base).not.toContain('s.id in (');
  });

  it('keeps every parameter placeholder, so the bindings still line up', async () => {
    const steps = (await capture('בדיקת גלישה', { world: 'tech', scopes: ['tech'] })).find((s) =>
      isStepsStatement(s.sql),
    )!;
    const placeholders = (sql: string) => [...new Set(sql.match(/\$\d+/g) ?? [])].sort();
    const base = rewriteUnionToLegacy(steps.sql).sql;
    expect(placeholders(base)).toEqual(placeholders(steps.sql));
    // Each word's pattern is referenced by five arms in one form and five or-branches in the other.
    expect((base.match(/\$1\b/g) ?? []).length).toBe((steps.sql.match(/\$1\b/g) ?? []).length);
  });

  it('leaves the scope, taxonomy and limit clauses alone', async () => {
    const steps = (await capture('גלישה', { world: 'tech', scopes: ['tech', 'billing'] })).find((s) =>
      isStepsStatement(s.sql),
    )!;
    const out = rewriteUnionToLegacy(steps.sql).sql;
    for (const frag of ['document_worlds sw', 'document_worlds fw', 'order by d.title, s.position'])
      expect(out).toContain(frag);
  });

  it('round-trips: the reconstructed baseline rewrites back to what repo.ts emits', async () => {
    const steps = (await capture('בדיקת גלישה')).find((s) => isStepsStatement(s.sql))!;
    const base = rewriteUnionToLegacy(steps.sql);
    expect(base.groups).toBe(2);
    expect(rewriteStepsToUnion(base.sql).sql).toBe(steps.sql);
    // And each transform is idempotent in its own direction.
    expect(rewriteUnionToLegacy(base.sql).groups).toBe(0);
  });

  it('repo.ts itself drops a Hebrew stopword from the conjunction', async () => {
    // Proposal 2 landed in `repo.ts`, so it is no longer a transform: the statement arrives with
    // one word group instead of two, and the dropped word is never bound at all.
    const steps = (await capture('של גלישה', { stopwords: ['של'] })).find((s) => isStepsStatement(s.sql))!;
    expect((steps.sql.match(/s\.id in \(/g) ?? []).length).toBe(1);
    expect(steps.params).not.toContain('של');
    expect(steps.params).toContain('גלישה');
    // An all-stopword query keeps today's behaviour rather than matching everything.
    const all = (await capture('של את', { stopwords: ['של', 'את'] })).find((s) => isStepsStatement(s.sql))!;
    expect((all.sql.match(/s\.id in \(/g) ?? []).length).toBe(2);
  });

  it('the transform still drops nothing without both the params and the stopword list', async () => {
    const base = rewriteUnionToLegacy(
      (await capture('של גלישה')).find((s) => isStepsStatement(s.sql))!.sql,
    ).sql;
    expect(rewriteStepsToUnion(base, { params: ['של', 'גלישה'] }).dropped).toBe(0);
    expect(rewriteStepsToUnion(base, { stopwords: new Set(['של']) }).dropped).toBe(0);
  });

  it('passes every other statement through untouched', async () => {
    const seen = await capture('גלישה');
    const others = seen.filter((s) => !isStepsStatement(s.sql));
    expect(others.length).toBeGreaterThan(0);
    for (const o of others) expect(maybeRewrite(o.sql)).toBe(o.sql);
  });
});
