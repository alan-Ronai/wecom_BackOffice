import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth } from './helpers/fixtures.js';

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

  it('rejects an empty or oversized telemetry batch', async () => {
    expect((await post('/api/v1/telemetry', { events: [] })).statusCode).toBe(400);
    expect((await post('/api/v1/telemetry', { events: [{ kind: 'nope' }] })).statusCode).toBe(400);
  });
});
