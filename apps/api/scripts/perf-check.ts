/**
 * §11 non-functional requirement gate: "library reads < 300 ms with 5,000 documents,
 * search < 500 ms" (p95). Spins up a throwaway testcontainers Postgres, migrates it,
 * loads a 5,000-document fixture (`load-fixture.ts`), then measures p50/p95 for:
 *   - GET /documents (a filtered page of 50)
 *   - GET /documents/:id
 *   - GET /search?q=… (Hebrew and Latin terms, separately)
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

const THRESHOLDS_MS = {
  'GET /documents': 300,
  'GET /documents/:id': 300,
  'GET /search (hebrew)': 500,
  'GET /search (latin)': 500,
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

    const inject = (url: string) => app.inject({ method: 'GET', url, headers });

    // Warm up connection pools / query plan caches before measuring.
    for (let i = 0; i < WARMUP; i++) {
      await inject(`/api/v1/documents?pageSize=50&category=${categories[i % categories.length]}`);
      await inject(`/api/v1/documents/${ids[i % ids.length]}`);
      await inject(`/api/v1/search?q=${encodeURIComponent('גלישה')}`);
      await inject(`/api/v1/search?q=network`);
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
      pad('endpoint', 24) + pad('p50 ms', 10) + pad('p95 ms', 10) + pad('max ms', 10) + 'threshold',
    );
    for (const r of rows)
      console.log(
        pad(r.name, 24) +
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
