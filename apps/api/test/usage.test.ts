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
      const rows = await db.pool.query('select user_id, q, filters, results, took_ms from search_log order by at');
      expect(rows.rows).toEqual([
        { user_id: u.id, q: 'apn', filters: { types: 'steps' }, results: 0, took_ms: 7 },
        { user_id: null, q: 'apn', filters: {}, results: 3, took_ms: 2 },
      ]);
      const topic = '22222222-2222-4222-8222-222222222222';
      await rec.recordTopicView(u.id, topic);
      await rec.recordTopicView(u.id, topic);
      const tv = await db.pool.query('select count from topic_views where user_id=$1 and topic_id=$2', [u.id, topic]);
      expect(tv.rows[0].count).toBe(2);
    });
    it('never throws when the database rejects the write', async () => {
      const broken = new pg.Pool({ connectionString: 'postgres://nobody:x@127.0.0.1:1/none' });
      const warns: unknown[] = [];
      const rec = new PgUsage(broken, { warn: (o: unknown) => warns.push(o) } as never);
      await expect(rec.recordSearch({ userId: null, q: 'x', filters: {}, results: 0, tookMs: 0 })).resolves.toBeUndefined();
      await expect(rec.recordTopicView(u.id, '22222222-2222-4222-8222-222222222222')).resolves.toBeUndefined();
      expect(warns.length).toBe(2);
      await broken.end();
    });
  });
});
