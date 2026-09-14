import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth } from './helpers/fixtures.js';
import { PgUsage } from '../src/modules/usage/recorder.js';

const run = integration ? describe : describe.skip;
run('usage', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let u: Awaited<ReturnType<typeof makeUser>>;
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    u = await makeUser(db.pool);
  }, 120000);
  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  describe('PgUsage', () => {
    it('writes search_log rows and upserts topic_views', async () => {
      const rec = new PgUsage(db.pool);
      await rec.recordSearch({ userId: u.id, q: 'apn', filters: { types: 'steps' }, results: 0, tookMs: 7 });
      await rec.recordSearch({ userId: null, q: 'apn', filters: {}, results: 3, tookMs: 2 });
      const rows = await db.pool.query(
        'select user_id, q, filters, results, took_ms from search_log order by at',
      );
      expect(rows.rows).toEqual([
        { user_id: u.id, q: 'apn', filters: { types: 'steps' }, results: 0, took_ms: 7 },
        { user_id: null, q: 'apn', filters: {}, results: 3, took_ms: 2 },
      ]);
      const topic = '22222222-2222-4222-8222-222222222222';
      await rec.recordTopicView(u.id, topic);
      await rec.recordTopicView(u.id, topic);
      const tv = await db.pool.query('select count from topic_views where user_id=$1 and topic_id=$2', [
        u.id,
        topic,
      ]);
      expect(tv.rows[0].count).toBe(2);
    });
    it('never throws when the database rejects the write', async () => {
      const broken = new pg.Pool({ connectionString: 'postgres://nobody:x@127.0.0.1:1/none' });
      const warns: unknown[] = [];
      const rec = new PgUsage(broken, { warn: (o: unknown) => warns.push(o) } as never);
      await expect(
        rec.recordSearch({ userId: null, q: 'x', filters: {}, results: 0, tookMs: 0 }),
      ).resolves.toBeUndefined();
      await expect(
        rec.recordTopicView(u.id, '22222222-2222-4222-8222-222222222222'),
      ).resolves.toBeUndefined();
      expect(warns.length).toBe(2);
      await broken.end();
    });
  });

  describe('GET /analytics/usage', () => {
    const D = '33333333-3333-4333-8333-333333333333';
    const E = '44444444-4444-4444-8444-444444444444';
    let viewer: Awaited<ReturnType<typeof makeUser>>;
    let reader: Awaited<ReturnType<typeof makeUser>>;
    beforeAll(async () => {
      viewer = await makeUser(db.pool, { name: 'צופה' });
      reader = await makeUser(db.pool, { name: 'קורא', perms: ['docs.read'] });
      await db.pool.query('delete from search_log');
      await db.pool.query(
        `insert into documents(id, slug, title, category, wave, priority, status, current_version, updated_at)
         values ($1,'d-usage-1','גלישה איטית','tech',1,'hh','published',1, now() - interval '40 days'),
                ($2,'d-usage-2','חיוב כפול','billing',1,'h','published',1, now() - interval '2 days')`,
        [D, E],
      );
      // two users, three views: u→D twice, viewer→D once, viewer→E once
      for (const [usr, doc] of [
        [u.id, D],
        [u.id, D],
        [viewer.id, D],
        [viewer.id, E],
      ] as const)
        await app.inject({
          method: 'POST',
          url: `/api/v1/documents/${doc}/view`,
          headers: auth(usr === u.id ? u : viewer),
        });
      const rec = new PgUsage(db.pool);
      await rec.recordSearch({ userId: u.id, q: 'zzz-none', filters: {}, results: 0, tookMs: 1 });
      await rec.recordSearch({ userId: u.id, q: 'zzz-none', filters: {}, results: 0, tookMs: 1 });
      await rec.recordSearch({ userId: viewer.id, q: 'apn', filters: {}, results: 4, tookMs: 1 });
    });

    it('aggregates views, viewers, zero-result terms and staleness', async () => {
      const r = await app.inject({ method: 'GET', url: '/api/v1/analytics/usage', headers: auth(u) });
      expect(r.statusCode).toBe(200);
      const b = r.json();
      const d1 = b.itemViews.find((x: { documentId: string }) => x.documentId === D);
      expect(d1).toMatchObject({ title: 'גלישה איטית', views: 3, viewers: 2 });
      expect(b.topItems[0]).toMatchObject({ documentId: D, views: 3 });
      expect(b.viewers.find((v: { userId: string }) => v.userId === viewer.id)).toMatchObject({
        displayName: 'צופה',
        views: 2,
      });
      expect(b.zeroResultTerms).toEqual([expect.objectContaining({ q: 'zzz-none', count: 2 })]);
      const stale = b.staleness.find((s: { documentId: string }) => s.documentId === D);
      expect(stale.daysSinceUpdate).toBeGreaterThanOrEqual(39);
      expect(b.topTopics).toEqual([]); // topics table not created yet in this DB
    });

    it('filters by world (primary category) and honours from/to', async () => {
      const r = (
        await app.inject({ method: 'GET', url: '/api/v1/analytics/usage?world=billing', headers: auth(u) })
      ).json();
      expect(r.itemViews.map((x: { documentId: string }) => x.documentId)).toEqual([E]);
      const old = (
        await app.inject({
          method: 'GET',
          url: '/api/v1/analytics/usage?from=2020-01-01T00:00:00.000Z&to=2020-01-02T00:00:00.000Z',
          headers: auth(u),
        })
      ).json();
      expect(old.itemViews).toEqual([]);
      expect(old.zeroResultTerms).toEqual([]);
    });

    it('is cached for 60 s per query string', async () => {
      const before = (
        await app.inject({ method: 'GET', url: '/api/v1/analytics/usage?limit=5', headers: auth(u) })
      ).json();
      await new PgUsage(db.pool).recordSearch({
        userId: u.id,
        q: 'zzz-none',
        filters: {},
        results: 0,
        tookMs: 1,
      });
      const again = (
        await app.inject({ method: 'GET', url: '/api/v1/analytics/usage?limit=5', headers: auth(u) })
      ).json();
      expect(again.zeroResultTerms[0].count).toBe(before.zeroResultTerms[0].count); // stale by design
      const other = (
        await app.inject({ method: 'GET', url: '/api/v1/analytics/usage?limit=6', headers: auth(u) })
      ).json();
      expect(other.zeroResultTerms[0].count).toBe(before.zeroResultTerms[0].count + 1); // different key → fresh
    });

    it('denies users without analytics.read', async () => {
      const r = await app.inject({ method: 'GET', url: '/api/v1/analytics/usage', headers: auth(reader) });
      expect(r.statusCode).toBe(403);
      const s = await app.inject({
        method: 'GET',
        url: '/api/v1/analytics/search-log',
        headers: auth(reader),
      });
      expect(s.statusCode).toBe(403);
    });

    it('lists the search log, zero-only when asked', async () => {
      const all = (
        await app.inject({ method: 'GET', url: '/api/v1/analytics/search-log', headers: auth(u) })
      ).json();
      expect(all.total).toBeGreaterThanOrEqual(3);
      expect(all.items[0]).toMatchObject({ userName: expect.any(String), filters: {} });
      const zero = (
        await app.inject({
          method: 'GET',
          url: '/api/v1/analytics/search-log?zeroOnly=true',
          headers: auth(u),
        })
      ).json();
      expect(zero.items.every((i: { results: number }) => i.results === 0)).toBe(true);
    });

    it('fills topTopics from W1\'s worlds/topics tables', async () => {
      // W1 (migration 0030) owns `worlds` and `topics`; this test used to fake them.
      const W = (await db.pool.query(`select id from worlds where slug='tech'`)).rows[0].id as string;
      const T = (
        await db.pool.query(
          `insert into topics(world_id, slug, name, position) values ($1,'slow-data','גלישה איטית',999) returning id`,
          [W],
        )
      ).rows[0].id as string;
      const rec = new PgUsage(db.pool);
      await rec.recordTopicView(u.id, T);
      await rec.recordTopicView(viewer.id, T);
      const r = (
        await app.inject({ method: 'GET', url: '/api/v1/analytics/usage?limit=9', headers: auth(u) })
      ).json();
      expect(r.topTopics).toContainEqual({
        topicId: T,
        name: 'גלישה איטית',
        worldSlug: 'tech',
        views: 2,
      });
      await db.pool.query('delete from topic_views where topic_id=$1', [T]);
      await db.pool.query('delete from topics where id=$1', [T]);
    });
  });
});
