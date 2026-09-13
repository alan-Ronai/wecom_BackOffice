import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { startTestDb, seedUser, integration } from '../helpers/l3/db.js';
import { hashPassword } from '../../src/modules/auth/local.js';
import { startPaloAltoStub } from '../helpers/l3/paloalto.js';

const run = integration ? describe : describe.skip;
run('local login, sessions, palo alto fallback', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let stub: Awaited<ReturnType<typeof startPaloAltoStub>>;
  beforeAll(async () => {
    db = await startTestDb();
    stub = await startPaloAltoStub(8091);
    stub.setMapping('10.1.2.3', 'WECOM\\dana');
    await seedUser(db.pool, {
      email: 'admin@wecom.co.il',
      displayName: 'Admin',
      source: 'local',
      subject: 'admin@wecom.co.il',
      roles: ['admin'],
      passwordHash: await hashPassword('Str0ng-pass!'),
    });
    app = await buildApp({
      pool: db.pool,
      boss: false,
      config: {
        DATABASE_URL: db.url,
        NODE_ENV: 'test',
        AUTH_FALLBACK: 'paloalto',
        PALOALTO_HOST: '127.0.0.1:8091',
        PALOALTO_API_KEY: 'k',
        PALOALTO_SUBNETS: '10.1.0.0/16',
        PALOALTO_SCHEME: 'http',
      },
    });
    await app.ready();
  }, 120000);
  afterAll(async () => {
    await app.close();
    await stub.stop();
    await db.stop();
  });

  it('logs in a local break-glass admin', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/local',
      payload: { email: 'admin@wecom.co.il', password: 'Str0ng-pass!' },
    });
    expect(r.statusCode).toBe(200);
    const s = r.cookies.find((c) => c.name === 'kb_session')!;
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `kb_session=${s.value}` },
    });
    expect(me.json().roles).toEqual(['admin']);
  });
  it('rejects wrong password with INVALID_CREDENTIALS', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/local',
      payload: { email: 'admin@wecom.co.il', password: 'nope' },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBe('INVALID_CREDENTIALS');
  });
  it('rate-limits local login', async () => {
    let last = 0;
    for (let i = 0; i < 7; i++)
      last = (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/local',
          payload: { email: 'x@y.z', password: 'p' },
          remoteAddress: '203.0.113.9',
        })
      ).statusCode;
    expect(last).toBe(429);
  });
  it('identifies a LAN user through the Palo Alto fallback and creates a session', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', remoteAddress: '10.1.2.3' });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({
      source: 'paloalto',
      subject: 'WECOM\\dana',
      displayName: 'dana',
    });
    expect(me.cookies.find((c) => c.name === 'kb_session')).toBeTruthy();
    expect(me.json().roles).toEqual([]);
  });
  it('does not consult the firewall outside the allowed subnets', async () => {
    const before = stub.calls.length;
    const r = await app.inject({ method: 'GET', url: '/api/v1/auth/me', remoteAddress: '172.16.0.5' });
    expect(r.statusCode).toBe(401);
    expect(stub.calls.length).toBe(before);
  });
});
