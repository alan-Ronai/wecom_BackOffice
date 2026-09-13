import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { startTestDb, seedUser, createSession, integration } from '../helpers/l3/db.js';
import { hashToken, SESSION_COOKIE } from '../../src/lib/session.js';

const run = integration ? describe : describe.skip;
run('enforcement hook', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let leadIntlCookie: string;
  let agentCookie: string;
  let docId: string;
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({
      config: { DATABASE_URL: db.url, NODE_ENV: 'test' },
      pool: db.pool,
      boss: false,
    });
    // test-only routes exercising the hook
    app.get('/api/v1/_t/public', { config: { public: true } }, async () => ({ ok: true }));
    app.get('/api/v1/_t/read', { config: { requires: ['docs.read'] } }, async (req) => ({
      user: req.user?.id,
      displayName: req.user?.displayName,
    }));
    app.post(
      '/api/v1/_t/documents/:id/publish',
      { config: { requires: ['docs.publish'], scope: 'document' } },
      async () => ({ ok: true }),
    );
    await app.ready();
    const lead = await seedUser(db.pool, {
      email: 'lead@wecom.co.il',
      displayName: 'אלון ר.',
      roles: ['lead'],
      categoryScope: ['intl'],
    });
    const agent = await seedUser(db.pool, {
      email: 'agent@wecom.co.il',
      displayName: 'דנה ר.',
      roles: ['agent'],
    });
    const t1 = 'tok-lead';
    await createSession(db.pool, lead, hashToken(t1));
    leadIntlCookie = `${SESSION_COOKIE}=${t1}`;
    const t2 = 'tok-agent';
    await createSession(db.pool, agent, hashToken(t2));
    agentCookie = `${SESSION_COOKIE}=${t2}`;
    const d = await db.pool.query<{ id: string }>(
      `insert into documents(slug,title,category,wave,priority) values ('t-billing','x','billing',1,'m') returning id`,
    );
    docId = d.rows[0].id;
  }, 120000);
  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  it('public routes need no session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/_t/public' })).statusCode).toBe(200);
  });
  it('system health stays reachable without a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/system/health' })).statusCode).toBe(200);
  });
  it('rejects missing session with 401 and the envelope', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/_t/read' });
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBe('UNAUTHENTICATED');
  });
  it('rejects a revoked session', async () => {
    await db.pool.query(`update sessions set revoked_at=now() where token_hash=$1`, [hashToken('tok-agent')]);
    app.authCache.clear();
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/_t/read',
      headers: { cookie: agentCookie },
    });
    expect(r.statusCode).toBe(401);
    await db.pool.query(`update sessions set revoked_at=null where token_hash=$1`, [hashToken('tok-agent')]);
  });
  it('allows a permitted user and exposes req.user', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/_t/read',
      headers: { cookie: agentCookie },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().user).toBeTruthy();
    expect(r.json().displayName).toBe('דנה ר.');
  });
  it('denies missing permission with FORBIDDEN', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/_t/documents/${docId}/publish`,
      headers: { cookie: agentCookie },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('FORBIDDEN');
    expect(r.json().details).toEqual({ permission: 'docs.publish' });
  });
  it('denies out-of-scope category with SCOPE_DENIED', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/_t/documents/${docId}/publish`,
      headers: { cookie: leadIntlCookie },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('SCOPE_DENIED');
  });
  it('404s scope checks for unknown documents', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/_t/documents/00000000-0000-4000-8000-000000000000/publish`,
      headers: { cookie: leadIntlCookie },
    });
    expect(r.statusCode).toBe(404);
  });
});
