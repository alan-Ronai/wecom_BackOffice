import { describe, it, expect } from 'vitest';
import { search } from '../../src/modules/search/repo.js';
import { isStepsStatement, maybeRewrite, rewriteStepsToUnion } from '../../scripts/perf-rewrite.js';

/**
 * `perf-rewrite.ts` is a string transform over SQL that `repo.ts` renders, and a string transform
 * over someone else's SQL rots the moment that SQL changes. These tests feed it the *real*
 * statements — `search()` driven by a stub `Q` that answers no rows, so every group runs without
 * a database — and fail loudly if the shape it targets is no longer the shape `repo.ts` emits.
 * That matters because the alternative failure is silent: `perf-load --rewrite-steps` would
 * measure the unchanged query and report the proposal as free.
 */
const capture = async (q: string, opts: { world?: string; scopes?: string[] } = {}) => {
  const seen: { sql: string; params: unknown[] }[] = [];
  const stub = {
    query: async (sql: string, params?: unknown[]) => {
      seen.push({ sql, params: params ?? [] });
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

  it('rewrites one word group per query word', async () => {
    const one = (await capture('גלישה')).find((s) => isStepsStatement(s.sql))!;
    const two = (await capture('בדיקת גלישה')).find((s) => isStepsStatement(s.sql))!;
    expect(rewriteStepsToUnion(one.sql).groups).toBe(1);
    expect(rewriteStepsToUnion(two.sql).groups).toBe(2);
  });

  it('removes the correlated aggregate and the outer-joined title from the predicate', async () => {
    const steps = (await capture('גלישה')).find((s) => isStepsStatement(s.sql))!;
    expect(steps.sql).toContain('string_agg');
    const out = rewriteStepsToUnion(steps.sql).sql;
    // The select list still projects the first action; only the *predicate* changes.
    expect(out).not.toContain('string_agg');
    expect(out).toContain('union select a1.step_id from step_actions a1');
    expect(out).toContain('join blocks b1 on b1.id = s2.block_id');
    expect(out).toContain('s.id in (');
  });

  it('keeps every parameter placeholder, so the bindings still line up', async () => {
    const steps = (await capture('בדיקת גלישה', { world: 'tech', scopes: ['tech'] })).find((s) =>
      isStepsStatement(s.sql),
    )!;
    const placeholders = (sql: string) => [...new Set(sql.match(/\$\d+/g) ?? [])].sort();
    const out = rewriteStepsToUnion(steps.sql).sql;
    expect(placeholders(out)).toEqual(placeholders(steps.sql));
    // Each word's pattern is now referenced by five arms rather than five or-branches.
    expect((out.match(/\$1\b/g) ?? []).length).toBe((steps.sql.match(/\$1\b/g) ?? []).length);
  });

  it('leaves the scope, taxonomy and limit clauses alone', async () => {
    const steps = (await capture('גלישה', { world: 'tech', scopes: ['tech', 'billing'] })).find((s) =>
      isStepsStatement(s.sql),
    )!;
    const out = rewriteStepsToUnion(steps.sql).sql;
    for (const frag of ['document_worlds sw', 'document_worlds fw', 'order by d.title, s.position'])
      expect(out).toContain(frag);
  });

  it('is idempotent — a second pass has nothing left to rewrite', async () => {
    const steps = (await capture('גלישה')).find((s) => isStepsStatement(s.sql))!;
    const once = rewriteStepsToUnion(steps.sql).sql;
    const twice = rewriteStepsToUnion(once);
    expect(twice.groups).toBe(0);
    expect(twice.sql).toBe(once);
  });

  it('drops a stopword term but keeps its placeholder, so the bind arity survives', async () => {
    const seen = await capture('של גלישה');
    const steps = seen.find((s) => isStepsStatement(s.sql))!;
    const stopwords = new Set(['של']);
    const plain = rewriteStepsToUnion(steps.sql);
    expect(plain.dropped).toBe(0);
    const dropped = rewriteStepsToUnion(steps.sql, { params: steps.params, stopwords });
    expect(dropped.groups).toBe(2);
    expect(dropped.dropped).toBe(1);
    // One word's set survives, the stopword's becomes a no-op that still references its $n.
    expect((dropped.sql.match(/s\.id in \(/g) ?? []).length).toBe(1);
    expect(dropped.sql).toContain('$1 is not null');
    const placeholders = (sql: string) => [...new Set(sql.match(/\$\d+/g) ?? [])].sort();
    expect(placeholders(dropped.sql)).toEqual(placeholders(steps.sql));
  });

  it('drops nothing without both the params and the stopword list', async () => {
    const steps = (await capture('של גלישה')).find((s) => isStepsStatement(s.sql))!;
    expect(rewriteStepsToUnion(steps.sql, { params: steps.params }).dropped).toBe(0);
    expect(rewriteStepsToUnion(steps.sql, { stopwords: new Set(['של']) }).dropped).toBe(0);
  });

  it('passes every other statement through untouched', async () => {
    const seen = await capture('גלישה');
    const others = seen.filter((s) => !isStepsStatement(s.sql));
    expect(others.length).toBeGreaterThan(0);
    for (const o of others) expect(maybeRewrite(o.sql)).toBe(o.sql);
  });
});
