import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth } from './helpers/fixtures.js';
import { CACHE_PREFIX } from '../src/modules/dashboards/cache.js';

const run = integration ? describe : describe.skip;

run('stage 4: dashboards and telemetry', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let u: Awaited<ReturnType<typeof makeUser>>;
  let docId: string;

  const get = (url: string) => app.inject({ method: 'GET', url, headers: auth(u) });
  const post = (url: string, payload?: unknown) =>
    app.inject({ method: 'POST', url, headers: auth(u), payload });

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    u = await makeUser(db.pool);
    docId = (
      await post('/api/v1/documents', {
        title: 'איטיות גלישה',
        description: '',
        category: 'tech',
        wave: 1,
        priority: 'hh',
        kind: 'steps',
      })
    ).json().id;
    await post('/api/v1/documents', {
      title: 'חיוב כפול',
      description: '',
      category: 'billing',
      wave: 2,
      priority: 'm',
      kind: 'steps',
    });
    await post(`/api/v1/documents/${docId}/view`);
  }, 180000);

  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  it('aggregates coverage, freshness, pipeline and sync from the live tables', async () => {
    const r = await get('/api/v1/dashboards');
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d.coverage.cards).toBe(2);
    expect(d.coverage.drafts).toBe(2);
    expect(d.coverage.withDocument).toBe(0);
    expect(d.coverage.byCategory.map((c: { category: string }) => c.category).sort()).toEqual([
      'billing',
      'tech',
    ]);
    expect(d.freshness.updatedLast30d).toBe(2);
    expect(d.freshness.staleOver180d).toBe(0);
    expect(d.freshness.byCategory.every((c: { median_days: number }) => c.median_days >= 0)).toBe(true);
    expect(d.usage.views7d).toBe(1);
    expect(d.usage.topDocuments[0]).toMatchObject({ documentId: docId, views: 1 });
    expect(d.pipeline).toMatchObject({ pending: 0, accepted: 0, rejected: 0, applied: 0, bySource: [] });
    expect(d.sync).toMatchObject({ links: 0, conflicts: 0, lastRunAt: null });
    expect(new Date(d.generatedAt).toString()).not.toBe('Invalid Date');
  });

  it('counts telemetry the web posted, and drops rows for documents that are gone', async () => {
    const r = await post('/api/v1/telemetry', {
      events: [
        { kind: 'outcome', documentId: docId, stepKey: 's1' },
        { kind: 'outcome', documentId: docId, stepKey: 's2' },
        { kind: 'call_completed', documentId: docId },
        { kind: 'palette' },
        // A card the client still had open but the KB no longer has.
        { kind: 'jump', documentId: '11111111-1111-4111-8111-111111111111' },
      ],
    });
    expect(r.statusCode).toBe(204);
    const rows = await db.pool.query('select kind, count(*)::int n from telemetry_events group by kind');
    const byKind = Object.fromEntries(rows.rows.map((x) => [x.kind, x.n]));
    expect(byKind).toEqual({ outcome: 2, call_completed: 1, palette: 1 });

    const d = (await get('/api/v1/dashboards')).json();
    expect(d.usage.outcomesPicked7d).toBe(2);
    expect(d.usage.callsCompleted7d).toBe(1);
  });

  it('serves the dashboard from a 60 s cache', async () => {
    const first = (await get('/api/v1/dashboards')).json();
    await post('/api/v1/documents', {
      title: 'חדש',
      description: '',
      category: 'ops',
      wave: 3,
      priority: 'l',
      kind: 'steps',
    });
    const second = (await get('/api/v1/dashboards')).json();
    expect(second.generatedAt).toBe(first.generatedAt);
    expect(second.coverage.cards).toBe(first.coverage.cards);
  });

  /**
   * The half the per-process `Map` could not do. Age alone was always within "cached 60 s", but
   * only the worker that took a telemetry batch cleared its own map, so the other replicas went
   * on serving the pre-batch counts — an agent refreshing twice could watch the number go
   * backwards. A second app on the same pool is a second replica.
   */
  it('shares one snapshot across replicas, and invalidates all of them at once', async () => {
    // Its own pool as well as its own app, so closing it takes nothing from the suite.
    const replica = await buildTestApp(new pg.Pool({ connectionString: db.url }), db.url);
    try {
      const getOn = (url: string) => replica.inject({ method: 'GET', url, headers: auth(u) });
      const a1 = (await get('/api/v1/dashboards')).json();
      const b1 = (await getOn('/api/v1/dashboards')).json();
      // The second replica computed nothing: it read the snapshot the first one wrote.
      expect(b1.generatedAt).toBe(a1.generatedAt);

      // A batch recorded on one replica has to reach the others' panels, not just its own.
      expect((await post('/api/v1/telemetry', { events: [{ kind: 'palette' }] })).statusCode).toBe(204);
      const b2 = (await getOn('/api/v1/dashboards')).json();
      expect(b2.generatedAt).not.toBe(b1.generatedAt);
      // And they agree again on the new one.
      expect((await get('/api/v1/dashboards')).json().generatedAt).toBe(b2.generatedAt);
    } finally {
      await replica.close();
    }
  });

  /**
   * L5. A failed cache *read* used to leave `stamp = ''`, and the snapshot was then written
   * under `''` — a value no later read matches once a stamp exists. That key was then a
   * permanent miss: every request recomputed the panel and rewrote the same unusable row,
   * for good. The cache is an optimisation, so a read that failed must skip the write, not
   * poison it.
   */
  it('does not write a snapshot under a stamp it could not read', async () => {
    const pool = new pg.Pool({ connectionString: db.url });
    // Reads of `system_state` fail; writes go through, so a write that should not happen is
    // visible as a row rather than swallowed by a second failure.
    const readsFail = new Proxy(pool, {
      get(target, prop, receiver) {
        if (prop !== 'query') return Reflect.get(target, prop, receiver);
        return (text: unknown, params?: unknown) => {
          if (typeof text === 'string' && /select .* from system_state/i.test(text))
            return Promise.reject(new Error('system_state unreadable'));
          return (target.query as (t: unknown, p?: unknown) => unknown)(text, params);
        };
      },
    }) as pg.Pool;

    const blind = await buildTestApp(readsFail, db.url);
    try {
      await pool.query(`delete from system_state where key like $1`, [CACHE_PREFIX + '%']);
      const r = await blind.inject({ method: 'GET', url: '/api/v1/dashboards', headers: auth(u) });
      // The panel is still served — the cache is never a dependency.
      expect(r.statusCode).toBe(200);
      expect(r.json().coverage.cards).toBeGreaterThan(0);
      // …and nothing was stored under a stamp that was never read.
      const rows = await pool.query(`select key from system_state where key like $1`, [CACHE_PREFIX + '%']);
      expect(rows.rowCount, 'no snapshot written from a failed read').toBe(0);
    } finally {
      await blind.close();
      await pool.end().catch(() => undefined);
    }

    // Control: with the read working, the very same request does store a snapshot.
    expect((await get('/api/v1/dashboards')).statusCode).toBe(200);
    expect(
      (await db.pool.query(`select key from system_state where key like $1`, [CACHE_PREFIX + '%'])).rowCount,
    ).toBeGreaterThan(0);
  });

  it('rejects an empty or oversized telemetry batch', async () => {
    expect((await post('/api/v1/telemetry', { events: [] })).statusCode).toBe(400);
    expect((await post('/api/v1/telemetry', { events: [{ kind: 'nope' }] })).statusCode).toBe(400);
  });
});
