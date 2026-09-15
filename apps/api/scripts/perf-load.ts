/**
 * F-5 / acceptance review §7 item 12: prove the §11 NFR "search p95 < 500 ms at 5,000 documents"
 * **under concurrent load**.
 *
 * `perf-check.ts` is the quick gate: it issues one request at a time, so it measures latency with
 * no queueing and a fully warm cache, and it only ever asks two query shapes. This script is the
 * opt-in load profile — 20 concurrent clients for 60 s over a mix of 200 Hebrew queries spanning
 * the five shapes that cost different things (single word, two words, prefix, stopword-heavy,
 * world-filtered) — and it reports p50/p95/p99 per class so a regression can be attributed to a
 * shape rather than to "search".
 *
 * Requests go through `app.inject`, which is the real route: auth, the zod querystring parse,
 * `search()`, `labelHits()`, the usage write and the response serialization. There is no network
 * hop, which is the one thing it does not measure; everything a search request does to the
 * database it does here.
 *
 * Usage:
 *   pnpm --filter @wecom/api perf:load [--docs 5000] [--seconds 60] [--clients 20]
 *                                      [--pool 20] [--seed 42] [--explain] [--out report.json]
 *                                      [--no-gate] [--compare]
 * `docs/perf.md` documents the flags and how to read the output. One warning worth repeating
 * here: two separate invocations of this script are not comparable — machine state moves the
 * numbers further than the code under test does. Use `--compare` for any before/after claim.
 */
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { search } from '../src/modules/search/repo.js';
import { startTestDb } from '../test/helpers/db.js';
import fakeAuth from '../test/helpers/fakeAuth.js';
import { makeUser, auth } from '../test/helpers/fixtures.js';
import { seedPerfCorpus } from './perf-seed.js';
import { buildQueryMix, LatencyRecorder, QUERY_CLASSES, type PerfQuery } from './perf-mix.js';
import { maybeRewrite } from './perf-rewrite.js';

const args = process.argv.slice(2);
const argNum = (name: string, def: number): number => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const argStr = (name: string, def: string | null = null): string | null => {
  const i = args.indexOf(name);
  return i >= 0 ? String(args[i + 1]) : def;
};
const flag = (name: string) => args.includes(name);

const DOCS = argNum('--docs', 5000);
const SECONDS = argNum('--seconds', 60);
const CLIENTS = argNum('--clients', 20);
const POOL_MAX = argNum('--pool', 20);
const SEED = argNum('--seed', 42);
const PER_CLASS = argNum('--per-class', 40);
const OUT = argStr('--out');
const EXPLAIN = flag('--explain');
const GATE_MS = flag('--no-gate') ? Infinity : argNum('--gate', 500);
/**
 * Measure the *proposed* `steps` predicate (`perf-rewrite.ts`) instead of the one in `repo.ts`.
 * The rewrite is applied to the SQL text on its way to the driver, so the route, `search()`, the
 * parameters and the bindings are all unchanged — this lane does not own `repo.ts` and does not
 * edit it. Without the flag, the run measures main as it stands.
 */
const REWRITE_STEPS = flag('--rewrite-steps');
/**
 * On top of `--rewrite-steps`, drop `search_hebrew_stopwords` words from the `ilike` conjunction
 * — proposal 2 in the report. Implies `--rewrite-steps`.
 */
const DROP_STOPWORDS = flag('--drop-stopwords');
/**
 * Measure every configuration in one process against one warm database, in the order
 * A B C C B A, and report each config as the mean of its two passes.
 *
 * This exists because separate runs of this script are not comparable on a laptop. Measured
 * across six separate 60 s runs, throughput for *identical* configurations varied from 10 to 110
 * req/s depending on what else the machine had been doing and whether a run followed another one
 * closely — a 10x order effect, which is larger than any of the differences being measured. The
 * palindrome ordering cancels it: any monotonic drift in machine speed over the sequence hits the
 * first and last pass of each config symmetrically.
 */
const COMPARE = flag('--compare');

/** The three query classes whose statements get an EXPLAIN (ANALYZE, BUFFERS) in the report. */
const EXPLAIN_TOP_N = 3;

interface RecordedStatement {
  sql: string;
  params: unknown[];
  ms: number;
  cls: string;
}

/** `search_hebrew_stopwords`, loaded when any phase needs them. */
let stopwords: ReadonlySet<string> | undefined;

interface Phase {
  name: string;
  rewrite: boolean;
  drop: boolean;
}
const PHASES: Record<string, Phase> = {
  current: { name: 'current (main)', rewrite: false, drop: false },
  rewrite: { name: 'proposal 1 (steps union)', rewrite: true, drop: false },
  both: { name: 'proposal 1 + 2 (and stopword drop)', rewrite: true, drop: true },
};
/** The phase the pool wrapper is currently applying; swapped between phases of `--compare`. */
let phase: Phase = PHASES.current;

async function main() {
  console.log(`perf-load: starting Postgres and migrating...`);
  const db = await startTestDb();
  // The app under load gets its own pool sized to the client count: a pool smaller than the
  // concurrency turns the measurement into a queueing experiment on the pool rather than on the
  // query, and a production API would be sized for its own concurrency.
  const pool = new pg.Pool({ connectionString: db.url, max: POOL_MAX });
  stopwords = new Set(
    (await db.pool.query('select word from search_hebrew_stopwords')).rows.map((r) => r.word as string),
  );
  phase = COMPARE
    ? PHASES.current
    : DROP_STOPWORDS
      ? PHASES.both
      : REWRITE_STEPS
        ? PHASES.rewrite
        : PHASES.current;
  {
    // Swap the statement text on its way out, one layer below `search()`. Text only: the
    // parameters, their order and their bindings are exactly what `repo.ts` built. A no-op for
    // the `current` phase, so the wrapper itself is not a difference between phases.
    const original = pool.query.bind(pool) as (text: string, params?: unknown[]) => Promise<unknown>;
    (pool as unknown as { query: unknown }).query = (text: string, params?: unknown[]) =>
      original(
        typeof text === 'string' && phase.rewrite
          ? maybeRewrite(text, { params, stopwords: phase.drop ? stopwords : undefined })
          : text,
        params,
      );
  }
  try {
    console.log(`perf-load: seeding ${DOCS} documents...`);
    const seeded = await seedPerfCorpus(db.pool, {
      docs: DOCS,
      seed: SEED,
      log: (m) => console.log('  ' + m),
    });
    console.log(
      `perf-load: seeded ${seeded.documents} documents (${seeded.stepDocuments} with steps, ` +
        `${seeded.textDocuments} text/type-T, ${seeded.steps} steps, ${seeded.links} links) in ${(seeded.ms / 1000).toFixed(1)}s`,
    );

    const app = await buildApp({
      pool,
      boss: false,
      plugins: [fakeAuth],
      config: { DATABASE_URL: db.url, NODE_ENV: 'test' },
    });
    await app.ready();

    // Two callers: an unscoped one, and one scoped to two worlds so the `document_worlds`
    // intersection in `search()` is on the measured path for the world-filtered class.
    const wide = await makeUser(db.pool, { name: 'עומס רחב' });
    const scoped = await makeUser(db.pool, { name: 'עומס מצומצם', scopes: ['tech', 'billing'] });
    const headersFor = (q: PerfQuery) => auth(q.cls === 'world-filtered' ? scoped : wide);

    const urlFor = (q: PerfQuery) => {
      const p = new URLSearchParams({ q: q.q });
      if (q.world) p.set('world', q.world);
      return `/api/v1/search?${p.toString()}`;
    };

    const mix = buildQueryMix(PER_CLASS, SEED);
    console.log(`perf-load: query mix = ${mix.length} queries over ${QUERY_CLASSES.length} classes`);

    /** One warm-up sweep plus one `SECONDS` load run at whatever `phase` is currently set to. */
    const runPhase = async (): Promise<{ rec: LatencyRecorder; errors: number; elapsed: number }> => {
      // Warm up: every query once, sequentially, so the run measures steady state rather than
      // first-touch page reads and plan caching.
      for (const q of mix) await app.inject({ method: 'GET', url: urlFor(q), headers: headersFor(q) });
      const rec = new LatencyRecorder();
      const deadline = Date.now() + SECONDS * 1000;
      let cursor = 0;
      let errors = 0;
      const started = Date.now();
      const client = async () => {
        while (Date.now() < deadline) {
          const q = mix[cursor++ % mix.length];
          const t0 = performance.now();
          const res = await app.inject({ method: 'GET', url: urlFor(q), headers: headersFor(q) });
          const ms = performance.now() - t0;
          if (res.statusCode !== 200) errors++;
          else rec.record(q.cls, ms);
        }
      };
      await Promise.all(Array.from({ length: CLIENTS }, client));
      return { rec, errors, elapsed: (Date.now() - started) / 1000 };
    };

    const report1 = (p: Phase, r: { rec: LatencyRecorder; errors: number; elapsed: number }) => {
      const n = r.rec.all().count;
      console.log('');
      console.log(
        `── ${p.name}: ${n} requests in ${r.elapsed.toFixed(1)}s = ${(n / r.elapsed).toFixed(0)} req/s` +
          (r.errors ? `  (${r.errors} non-200 responses)` : ''),
      );
      console.log(r.rec.table());
    };

    // `--compare` runs every configuration against this one warm database, A B C C B A, and
    // reports each as the mean of its two passes. Separate invocations of this script are not
    // comparable on a laptop: identical configurations measured minutes apart varied 10x.
    const order: Phase[] = COMPARE
      ? [PHASES.current, PHASES.rewrite, PHASES.both, PHASES.both, PHASES.rewrite, PHASES.current]
      : [phase];
    const passes: { phase: Phase; rec: LatencyRecorder; errors: number; elapsed: number }[] = [];
    console.log(
      `perf-load: ${CLIENTS} concurrent clients, ${SECONDS}s per phase (pool max ${POOL_MAX}), ` +
        `${order.length} phase(s): ${order.map((p) => p.name).join(' → ')}`,
    );
    for (const p of order) {
      phase = p;
      const r = await runPhase();
      passes.push({ phase: p, ...r });
      report1(p, r);
    }
    phase = order[order.length - 1];

    // Merge the passes of each configuration, in input order, and print the comparison.
    const merged = new Map<
      string,
      { phase: Phase; rec: LatencyRecorder; errors: number; reqs: number; secs: number }
    >();
    for (const p of passes) {
      let m = merged.get(p.phase.name);
      if (!m)
        merged.set(
          p.phase.name,
          (m = { phase: p.phase, rec: new LatencyRecorder(), errors: 0, reqs: 0, secs: 0 }),
        );
      for (const c of p.rec.classes()) for (const ms of p.rec.samples(c)) m.rec.record(c, ms);
      m.errors += p.errors;
      m.reqs += p.rec.all().count;
      m.secs += p.elapsed;
    }
    // The gate and the JSON report describe the *last* configuration measured, which for a single
    // run is the one asked for and for `--compare` is `current` — the state of main, which is what
    // a gate should be about.
    const last = [...merged.values()][merged.size - 1];
    const rec = last.rec;
    const total = last.reqs;
    const errors = [...merged.values()].reduce((a, m) => a + m.errors, 0);
    const elapsed = last.secs;
    if (COMPARE) {
      console.log('');
      console.log('perf-load: both passes of each configuration, combined');
      for (const m of merged.values()) {
        console.log('');
        console.log(`── ${m.phase.name}: ${m.reqs} requests, ${(m.reqs / m.secs).toFixed(0)} req/s`);
        console.log(m.rec.table());
      }
    }
    console.log('');

    const explains: { cls: string; ms: number; sql: string; params: unknown[]; plan: string }[] = [];
    if (EXPLAIN) {
      console.log('perf-load: EXPLAIN (ANALYZE, BUFFERS) for the slowest statement shapes...');
      for (const e of await explainSlowest(pool, mix)) {
        explains.push(e);
        console.log('');
        console.log(`── ${e.cls} · ${e.ms.toFixed(1)} ms ─────────────────────────────`);
        console.log(e.sql);
        console.log(e.plan);
      }
      console.log('');
    }

    await app.close();

    const report = {
      generatedAt: new Date().toISOString(),
      documents: seeded.documents,
      steps: seeded.steps,
      clients: CLIENTS,
      poolMax: POOL_MAX,
      seconds: SECONDS,
      requests: total,
      errors,
      throughputPerSec: total / elapsed,
      configuration: last.phase.name,
      overall: rec.all(),
      byClass: Object.fromEntries(rec.classes().map((c) => [c, rec.stats(c)])),
      phases: [...merged.values()].map((m) => ({
        configuration: m.phase.name,
        requests: m.reqs,
        throughputPerSec: m.reqs / m.secs,
        errors: m.errors,
        overall: m.rec.all(),
        byClass: Object.fromEntries(m.rec.classes().map((c) => [c, m.rec.stats(c)])),
      })),
      explains: explains.map((e) => ({ cls: e.cls, ms: e.ms, sql: e.sql, plan: e.plan })),
    };
    if (OUT) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(OUT, JSON.stringify(report, null, 2));
      console.log(`perf-load: wrote ${OUT}`);
    }

    const over = rec.classes().filter((c) => rec.stats(c).p95 > GATE_MS);
    if (errors) {
      console.error(`perf-load FAILED: ${errors} requests did not answer 200`);
      process.exitCode = 1;
    } else if (over.length) {
      console.error(
        `perf-load FAILED: p95 over ${GATE_MS} ms for ${over.map((c) => `${c} (${rec.stats(c).p95.toFixed(0)} ms)`).join(', ')}`,
      );
      process.exitCode = 1;
    } else if (Number.isFinite(GATE_MS)) {
      console.log(`perf-load PASSED: every query class is inside the ${GATE_MS} ms p95 budget`);
    }
  } finally {
    await pool.end().catch(() => undefined);
    await db.stop();
  }
}

/**
 * Where the time actually goes. `search()` issues one statement per group, so a per-request
 * number cannot say which group is slow. This runs the real `search()` against a recording
 * `Q` — no SQL is copied out of `repo.ts`, so the plans cannot drift from the code — times each
 * statement, and EXPLAINs the slowest distinct shapes.
 */
async function explainSlowest(
  pool: pg.Pool,
  mix: readonly PerfQuery[],
): Promise<{ cls: string; ms: number; sql: string; params: unknown[]; plan: string }[]> {
  const recorded: RecordedStatement[] = [];
  let cls = '';
  const recordingQ = {
    query: async (text: string, params?: unknown[]) => {
      const t0 = performance.now();
      const r = await pool.query(text, params as never);
      // Record what the database saw, which under `--rewrite-steps` is the proposal.
      const effective = REWRITE_STEPS || DROP_STOPWORDS ? maybeRewrite(text, { params, stopwords }) : text;
      recorded.push({ sql: effective, params: params ?? [], ms: performance.now() - t0, cls });
      return r;
    },
  };
  // A handful of queries per class: enough to rank the shapes, cheap enough to run serially.
  for (const c of QUERY_CLASSES) {
    const sample = mix.filter((m) => m.cls === c).slice(0, 4);
    for (const s of sample) {
      cls = c;
      await search(
        recordingQ as never,
        { q: s.q, limit: 40, ...(s.world ? { world: s.world } : {}) } as never,
        null,
        s.world ? ['tech', 'billing'] : null,
        true,
      );
    }
  }

  // Rank by the worst observation of each distinct statement shape (the SQL text, which already
  // differs per group and per word count).
  const worst = new Map<string, RecordedStatement>();
  for (const r of recorded) {
    const prev = worst.get(r.sql);
    if (!prev || r.ms > prev.ms) worst.set(r.sql, r);
  }
  const top = [...worst.values()].sort((a, b) => b.ms - a.ms).slice(0, EXPLAIN_TOP_N);

  const out: { cls: string; ms: number; sql: string; params: unknown[]; plan: string }[] = [];
  for (const t of top) {
    const r = await pool.query(`explain (analyze, buffers) ${t.sql}`, t.params as never);
    out.push({
      cls: t.cls,
      ms: t.ms,
      sql: t.sql,
      params: t.params,
      plan: r.rows.map((x) => (x as Record<string, string>)['QUERY PLAN']).join('\n'),
    });
  }
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
