import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { startTestDb, integration } from '../helpers/db.js';
import { makeUser, auth } from '../helpers/fixtures.js';
import { buildApp } from '../../src/app.js';
import fakeAuth from '../helpers/fakeAuth.js';
import { runEvalJob } from '../../src/jobs/ai.js';

/**
 * Wave 6 (X1), spec §4.1. The admin surface for the model: the brief and the slots, a per-slot
 * reachability probe, the re-embed and the offline evaluation. Everything here is `ai.manage`,
 * which only `admin` holds — an editor with every content permission must still get a 403.
 *
 * `MODEL_DISABLED: true`, so `models/test` answers `reachable: false` with a reason rather than
 * hanging on a daemon that is not running, and the eval runs the deterministic engine.
 */
const run = integration ? describe : describe.skip;

run('admin AI routes', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let admin: Awaited<ReturnType<typeof makeUser>>;
  let editor: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({
      config: { DATABASE_URL: db.url, NODE_ENV: 'test', MODEL_DISABLED: true },
      pool: db.pool as pg.Pool,
      boss: false,
      plugins: [fakeAuth],
    });
    await app.ready();
    admin = await makeUser(db.pool);
    editor = await makeUser(db.pool, { perms: ['docs.read', 'docs.edit', 'suggestions.review'] });
  }, 240000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  const inject = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, who = admin) =>
    app.inject({ method, url, payload: payload as object, headers: { ...auth(who) } });

  it('refuses every operation without ai.manage', async () => {
    expect((await inject('GET', '/api/v1/admin/ai/settings', undefined, editor)).statusCode).toBe(403);
    expect((await inject('POST', '/api/v1/admin/ai/models/test', { slot: 'embed' }, editor)).statusCode).toBe(
      403,
    );
    expect((await inject('POST', '/api/v1/admin/ai/reindex', {}, editor)).statusCode).toBe(403);
    expect((await inject('POST', '/api/v1/admin/ai/eval', {}, editor)).statusCode).toBe(403);
    expect((await inject('GET', '/api/v1/admin/ai/eval/runs', undefined, editor)).statusCode).toBe(403);
  });

  it('reads and writes the brief, bumping the prompt version and keeping the history', async () => {
    const before = await inject('GET', '/api/v1/admin/ai/settings');
    expect(before.statusCode).toBe(200);
    expect(before.json().brief).toEqual({ text: '', version: 0 });

    const put = await inject('PUT', '/api/v1/admin/ai/settings', {
      brief: { text: 'wecom היא חברת סלולר ישראלית.' },
      limits: { maxContextChars: 12000 },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().brief).toEqual({ text: 'wecom היא חברת סלולר ישראלית.', version: 1 });
    expect(put.json().limits.maxContextChars).toBe(12000);

    const versions = await inject('GET', '/api/v1/admin/ai/settings/versions?key=ai.brief');
    expect(versions.statusCode).toBe(200);
    expect(versions.json().items[0]).toMatchObject({ key: 'ai.brief', version: 1 });
  });

  it('reports an unreachable slot instead of throwing', async () => {
    const r = await inject('POST', '/api/v1/admin/ai/models/test', { slot: 'embed' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ slot: 'embed', reachable: false });
    expect(r.json().tag).toBeTruthy();
    expect(r.json().error).toContain('MODEL_DISABLED');
  });

  it('accepts a reindex request even with pg-boss down, and says so', async () => {
    const r = await inject('POST', '/api/v1/admin/ai/reindex', {});
    expect(r.statusCode).toBe(202);
    // `jobId: null` is the honest answer when there is no queue — the call does not pretend.
    expect(r.json()).toEqual({ queued: true, jobId: null });
    const audited = await db.pool.query(`select count(*)::int n from audit_log where action=$1`, [
      'admin.ai.reindex',
    ]);
    expect(audited.rows[0].n).toBeGreaterThan(0);
  });

  it('queues an eval, records the run and lists it', async () => {
    const queued = await inject('POST', '/api/v1/admin/ai/eval', { useRules: true });
    expect(queued.statusCode).toBe(202);
    expect(queued.json()).toEqual({ queued: true, jobId: null });

    const pending = await inject('GET', '/api/v1/admin/ai/eval/runs');
    expect(pending.statusCode).toBe(200);
    const runId = pending.json().items[0].id as string;
    expect(pending.json().items[0]).toMatchObject({ model: 'rules', finishedAt: null, cases: 0 });
    expect(pending.json().items[0].promptVersion).toMatch(/^v3\./);

    // pg-boss is disabled in tests, so the worker body is driven directly.
    await runEvalJob(app, { runId, useRules: true });

    const done = (await inject('GET', '/api/v1/admin/ai/eval/runs')).json().items[0];
    expect(done.id).toBe(runId);
    expect(done.cases).toBeGreaterThanOrEqual(8);
    expect(done.hitTarget).toBeGreaterThan(0);
    expect(done.finishedAt).not.toBeNull();
  });
});
