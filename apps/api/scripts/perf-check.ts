/**
 * §11 non-functional requirement gate: "library reads < 300 ms with 5,000 documents,
 * search < 500 ms" (p95). Spins up a throwaway testcontainers Postgres, migrates it,
 * loads a 5,000-document fixture (`load-fixture.ts`), then measures p50/p95 for:
 *   - GET /documents (a filtered page of 50)
 *   - GET /documents/:id
 *   - GET /search?q=… (Hebrew and Latin terms, separately)
 *   - GET /graph, GET /graph/impact/:nodeId (document and CRM field)
 *   - GET /fields/:name/page, GET /blocks/:id/page
 *   - GET /documents/:id/backlinks
 *   - GET /dashboards (cache busted on every call, so this measures the aggregates)
 * against the real app (`buildApp`, in-process `app.inject` — no network hop, but the
 * full route/auth/serialization/DB path), and fails (non-zero exit) if any p95 exceeds
 * its threshold.
 *
 * Usage: `pnpm --filter @wecom/api perf:check [--docs 5000] [--iterations 40]`
 */
import { buildApp } from '../src/app.js';
import { startTestDb } from '../test/helpers/db.js';
import fakeAuth from '../test/helpers/fakeAuth.js';
import { makeUser, auth } from '../test/helpers/fixtures.js';
import { loadFixture } from './load-fixture.js';

const args = process.argv.slice(2);
const argNum = (name: string, def: number): number => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const DOCS = argNum('--docs', 5000);
const ITERATIONS = argNum('--iterations', 40);
const WARMUP = 5;

/**
 * All of the stage-4 read models are library reads, so they take §11's 300 ms budget. The
 * numbers measured on this fixture are far inside it — `/graph?limit=400&depth=2` p95 ≈ 80 ms,
 * `/graph/impact/:nodeId` ≈ 55 ms, the field and block pages ≈ 10 ms, `/dashboards` ≈ 6 ms,
 * `/documents/:id/backlinks` ≈ 1.5 ms — and the headroom is deliberate: `loadGraph` scales with
 * total link and field-ref rows, and this fixture is sparse (~10 % of documents link to
 * another), so a densely cross-linked real library will be materially slower than the numbers
 * above. A threshold at the measured value would fail on a busy runner; one at the budget
 * fails when the endpoint stops meeting the contract, which is what this gate is for.
 */
const THRESHOLDS_MS = {
  'GET /documents': 300,
  'GET /documents/:id': 300,
  'GET /search (hebrew)': 500,
  'GET /search (latin)': 500,
  'GET /graph': 300,
  'GET /graph/impact/:doc': 300,
  'GET /graph/impact/:field': 300,
  'GET /fields/:name/page': 300,
  'GET /blocks/:id/page': 300,
  'GET /documents/:id/backlinks': 300,
  'GET /dashboards': 300,
};

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function timeIt(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

async function measure(name: string, iterations: number, fn: () => Promise<unknown>): Promise<number[]> {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) samples.push(await timeIt(fn));
  samples.sort((a, b) => a - b);
  return samples;
}

async function main() {
  console.log(`perf-check: starting Postgres testcontainer and migrating...`);
  const db = await startTestDb();
  try {
    console.log(`perf-check: loading ${DOCS} fixture documents...`);
    const load = await loadFixture(db.pool, {
      docs: DOCS,
      log: (m) => console.log('  ' + m),
    });
    console.log(
      `perf-check: fixture loaded in ${(load.ms / 1000).toFixed(1)}s (${load.steps} steps, ${load.fieldRefs} field refs, ${load.links} links)`,
    );

    const app = await buildApp({
      pool: db.pool,
      boss: false,
      plugins: [fakeAuth],
      config: { DATABASE_URL: db.url, NODE_ENV: 'test' },
    });
    await app.ready();

    const u = await makeUser(db.pool, { name: 'בודק ביצועים' });
    const headers = auth(u);

    const ids = (await db.pool.query('select id from documents order by random() limit 200')).rows.map(
      (r) => r.id as string,
    );
    const categories = ['sim', 'tech', 'billing', 'plans', 'intl', 'ops'];
    // The stage-4 read models are keyed by catalogue entities, so pick real ones out of the
    // fixture rather than inventing ids that would measure the 404 path.
    const blockIds = (await db.pool.query('select id from blocks order by random() limit 50')).rows.map(
      (r) => r.id as string,
    );
    const fieldNames = (
      await db.pool.query(
        `select r.field_name from step_field_refs r group by r.field_name
          order by count(*) desc limit 20`,
      )
    ).rows.map((r) => r.field_name as string);
    // Documents that something actually points at, so `backlinks` and `impact` do real work.
    const linkedIds = (
      await db.pool.query(
        'select distinct to_document_id id from document_links where to_document_id is not null limit 200',
      )
    ).rows.map((r) => r.id as string);
    if (!blockIds.length || !fieldNames.length || !linkedIds.length)
      throw new Error('fixture produced no blocks, field refs or document links to measure against');

    const inject = (url: string) => app.inject({ method: 'GET', url, headers });

    // Warm up connection pools / query plan caches before measuring.
    for (let i = 0; i < WARMUP; i++) {
      await inject(`/api/v1/documents?pageSize=50&category=${categories[i % categories.length]}`);
      await inject(`/api/v1/documents/${ids[i % ids.length]}`);
      await inject(`/api/v1/search?q=${encodeURIComponent('גלישה')}`);
      await inject(`/api/v1/search?q=network`);
      await inject('/api/v1/graph?limit=400&depth=2');
      await inject(`/api/v1/graph/impact/doc:${linkedIds[i % linkedIds.length]}`);
      await inject(`/api/v1/fields/${encodeURIComponent(fieldNames[i % fieldNames.length])}/page`);
      await inject(`/api/v1/blocks/${blockIds[i % blockIds.length]}/page`);
      await inject('/api/v1/dashboards');
    }

    let i = 0;
    const results: Record<string, number[]> = {};
    results['GET /documents'] = await measure('GET /documents', ITERATIONS, () =>
      inject(`/api/v1/documents?pageSize=50&category=${categories[i++ % categories.length]}&sort=updated`),
    );
    i = 0;
    results['GET /documents/:id'] = await measure('GET /documents/:id', ITERATIONS, () =>
      inject(`/api/v1/documents/${ids[i++ % ids.length]}`),
    );
    const hebrewTerms = ['גלישה', 'חיוב', 'נדידה בינלאומית', 'תמיכה טכנית', 'שדרוג חבילה'];
    i = 0;
    results['GET /search (hebrew)'] = await measure('GET /search (hebrew)', ITERATIONS, () =>
      inject(`/api/v1/search?q=${encodeURIComponent(hebrewTerms[i++ % hebrewTerms.length])}`),
    );
    const latinTerms = ['SIM', 'eSIM', 'network', 'roaming', 'CRM'];
    i = 0;
    results['GET /search (latin)'] = await measure('GET /search (latin)', ITERATIONS, () =>
      inject(`/api/v1/search?q=${encodeURIComponent(latinTerms[i++ % latinTerms.length])}`),
    );

    // ── stage 4: connected data ─────────────────────────────────────────────
    // `/graph` with no focus is the expensive shape: it loads the whole graph and ranks it.
    results['GET /graph'] = await measure('GET /graph', ITERATIONS, () =>
      inject('/api/v1/graph?limit=400&depth=2'),
    );
    i = 0;
    results['GET /graph/impact/:doc'] = await measure('GET /graph/impact/:doc', ITERATIONS, () =>
      inject(`/api/v1/graph/impact/doc:${linkedIds[i++ % linkedIds.length]}`),
    );
    i = 0;
    results['GET /graph/impact/:field'] = await measure('GET /graph/impact/:field', ITERATIONS, () =>
      inject(`/api/v1/graph/impact/field:${encodeURIComponent(fieldNames[i++ % fieldNames.length])}`),
    );
    i = 0;
    results['GET /fields/:name/page'] = await measure('GET /fields/:name/page', ITERATIONS, () =>
      inject(`/api/v1/fields/${encodeURIComponent(fieldNames[i++ % fieldNames.length])}/page`),
    );
    i = 0;
    results['GET /blocks/:id/page'] = await measure('GET /blocks/:id/page', ITERATIONS, () =>
      inject(`/api/v1/blocks/${blockIds[i++ % blockIds.length]}/page`),
    );
    i = 0;
    results['GET /documents/:id/backlinks'] = await measure('GET /documents/:id/backlinks', ITERATIONS, () =>
      inject(`/api/v1/documents/${linkedIds[i++ % linkedIds.length]}/backlinks`),
    );
    // The dashboard caches for 60 s per scope, so measuring it naively would time one real
    // call and then the cache. A telemetry write clears that cache, which is what the web
    // does between visits anyway.
    results['GET /dashboards'] = await measure('GET /dashboards', ITERATIONS, async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/telemetry',
        headers,
        payload: { events: [{ kind: 'palette' }] },
      });
      return inject('/api/v1/dashboards');
    });

    console.log('');
    console.log(`perf-check: p50/p95 over ${ITERATIONS} requests each, ${DOCS} documents loaded`);
    console.log('');
    const rows: { name: string; p50: number; p95: number; max: number; threshold: number; ok: boolean }[] =
      [];
    for (const [name, samples] of Object.entries(results)) {
      const p50 = percentile(samples, 50);
      const p95 = percentile(samples, 95);
      const max = samples[samples.length - 1];
      const threshold = THRESHOLDS_MS[name as keyof typeof THRESHOLDS_MS];
      rows.push({ name, p50, p95, max, threshold, ok: p95 <= threshold });
    }
    const pad = (s: string, n: number) => s.padEnd(n);
    console.log(
      pad('endpoint', 30) + pad('p50 ms', 10) + pad('p95 ms', 10) + pad('max ms', 10) + 'threshold',
    );
    for (const r of rows)
      console.log(
        pad(r.name, 30) +
          pad(r.p50.toFixed(1), 10) +
          pad(r.p95.toFixed(1), 10) +
          pad(r.max.toFixed(1), 10) +
          `${r.threshold} ms ${r.ok ? 'OK' : 'FAIL'}`,
      );
    console.log('');

    await app.close();
    const failed = rows.filter((r) => !r.ok);
    if (failed.length) {
      console.error(
        `perf-check FAILED: ${failed.map((f) => f.name).join(', ')} exceeded their p95 threshold`,
      );
      process.exitCode = 1;
    } else {
      console.log('perf-check PASSED: all endpoints within their §11 p95 threshold');
    }
  } finally {
    await db.stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
