/**
 * A/B bench for the *proposed* `steps`-group rewrite (`perf-rewrite.ts`), run directly against
 * the database.
 *
 * `apps/api/src/modules/search/repo.ts` is owned by another session, so this lane does not edit
 * it. What this script does instead is take the statement `search()` actually issues — captured
 * by running the real function through a recording `Q`, so nothing is transcribed by hand — apply
 * the rewrite, and then (a) prove it returns exactly the same rows for every sampled query and
 * (b) time both versions and print both plans. That is the evidence behind the diff proposed in
 * `.superpowers/sdd/program/perf-search-report.md`, for the owning session to apply or reject.
 *
 * Usage: pnpm --filter @wecom/api perf:sql [--docs 5000] [--iterations 20] [--sample 12] [--seed 42]
 */
import type pg from 'pg';
import { search } from '../src/modules/search/repo.js';
import { startTestDb } from '../test/helpers/db.js';
import { seedPerfCorpus } from './perf-seed.js';
import { buildQueryMix, summarize, type PerfQuery } from './perf-mix.js';
import { isStepsStatement, rewriteStepsToUnion } from './perf-rewrite.js';

const args = process.argv.slice(2);
const argNum = (name: string, def: number): number => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const DOCS = argNum('--docs', 5000);
const ITERATIONS = argNum('--iterations', 20);
const SEED = argNum('--seed', 42);
const SAMPLE = argNum('--sample', 12);

interface Captured {
  q: PerfQuery;
  sql: string;
  params: unknown[];
}

const rowKey = (r: pg.QueryResult): string =>
  JSON.stringify(
    r.rows.map((x) => {
      const o = x as Record<string, unknown>;
      return `${o.document_id}#${o.step_key}`;
    }),
  );

async function main() {
  console.log('perf-sql: starting Postgres and migrating...');
  const db = await startTestDb();
  try {
    console.log(`perf-sql: seeding ${DOCS} documents...`);
    const seeded = await seedPerfCorpus(db.pool, {
      docs: DOCS,
      seed: SEED,
      log: (m) => console.log('  ' + m),
    });
    console.log(`perf-sql: ${seeded.documents} documents, ${seeded.steps} steps`);

    // Capture the live `steps` statement for a sample of queries, straight out of `search()`.
    const captured: Captured[] = [];
    let current: PerfQuery | null = null;
    const recordingQ = {
      query: async (text: string, params?: unknown[]) => {
        if (current && isStepsStatement(text)) captured.push({ q: current, sql: text, params: params ?? [] });
        return db.pool.query(text, params as never);
      },
    };
    const mix = buildQueryMix(SAMPLE, SEED)
      .filter((m) => m.cls === 'single' || m.cls === 'two-word')
      .slice(0, SAMPLE);
    for (const m of mix) {
      current = m;
      await search(recordingQ as never, { q: m.q, limit: 40 } as never, null, null, true);
    }
    current = null;
    if (!captured.length) throw new Error('captured no `steps` statement — has repo.ts changed shape?');
    const probe = rewriteStepsToUnion(captured[0].sql);
    if (!probe.groups)
      throw new Error('the rewrite matched no `or` group — repo.ts no longer renders the shape it targets');
    console.log(
      `perf-sql: captured ${captured.length} steps statements, ${probe.groups} word group(s) rewritten`,
    );

    // Correctness first: a faster query that answers differently is not a candidate.
    console.log('perf-sql: verifying the rewrite returns identical rows...');
    let mismatches = 0;
    for (const c of captured) {
      const rewritten = rewriteStepsToUnion(c.sql).sql;
      const [a, b] = await Promise.all([
        db.pool.query(c.sql, c.params as never),
        db.pool.query(rewritten, c.params as never),
      ]);
      if (rowKey(a) !== rowKey(b)) {
        mismatches++;
        console.error(`  MISMATCH for q="${c.q.q}": ${a.rowCount} vs ${b.rowCount} rows`);
      }
    }
    console.log(
      mismatches
        ? `perf-sql: ${mismatches} MISMATCHES — do not propose this rewrite`
        : `  identical for every one of the ${captured.length} sampled queries`,
    );

    // Then speed, alternating the two so machine drift hits both equally.
    const cur: number[] = [];
    const cand: number[] = [];
    console.log(`perf-sql: timing ${ITERATIONS} iterations over ${captured.length} queries...`);
    for (let i = 0; i < ITERATIONS; i++) {
      for (const c of captured) {
        const rewritten = rewriteStepsToUnion(c.sql).sql;
        let t0 = performance.now();
        await db.pool.query(c.sql, c.params as never);
        cur.push(performance.now() - t0);
        t0 = performance.now();
        await db.pool.query(rewritten, c.params as never);
        cand.push(performance.now() - t0);
      }
    }
    const a = summarize(cur);
    const b = summarize(cand);
    const pad = (s: string, n: number) => s.padEnd(n);
    console.log('');
    console.log(pad('steps statement', 32) + pad('n', 8) + pad('p50 ms', 10) + pad('p95 ms', 10) + 'max ms');
    for (const [name, s] of [
      ['current (string_agg ilike or)', a],
      ['candidate (union of arms)', b],
    ] as const)
      console.log(
        pad(name, 32) +
          pad(String(s.count), 8) +
          pad(s.p50.toFixed(1), 10) +
          pad(s.p95.toFixed(1), 10) +
          s.max.toFixed(1),
      );
    console.log('');
    console.log(
      `p95 ${a.p95.toFixed(1)} ms → ${b.p95.toFixed(1)} ms (${(a.p95 / b.p95).toFixed(1)}x), ` +
        `p50 ${a.p50.toFixed(1)} ms → ${b.p50.toFixed(1)} ms (${(a.p50 / b.p50).toFixed(1)}x)`,
    );

    // Plans for the slowest of the sampled queries, both versions.
    let worst = captured[0];
    let worstMs = -1;
    for (const c of captured) {
      const t0 = performance.now();
      await db.pool.query(c.sql, c.params as never);
      const ms = performance.now() - t0;
      if (ms > worstMs) {
        worstMs = ms;
        worst = c;
      }
    }
    for (const [name, sql] of [
      ['CURRENT', worst.sql],
      ['CANDIDATE', rewriteStepsToUnion(worst.sql).sql],
    ] as const) {
      const r = await db.pool.query(`explain (analyze, buffers) ${sql}`, worst.params as never);
      console.log('');
      console.log(`── ${name} plan for q="${worst.q.q}" ───────────────────────`);
      console.log(sql);
      console.log(r.rows.map((x) => (x as Record<string, string>)['QUERY PLAN']).join('\n'));
    }
    if (mismatches) process.exitCode = 1;
  } finally {
    await db.stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
