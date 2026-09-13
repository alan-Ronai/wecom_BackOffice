import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { startTestDb, integration } from '../helpers/l3/db.js';
import { startOidcMock } from '../helpers/l3/oidc.js';

const run = integration ? describe : describe.skip;
const cookiesOf = (res: { cookies: { name: string; value: string }[] }) =>
  res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');

run('OIDC login round-trip', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let mock: Awaited<ReturnType<typeof startOidcMock>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    db = await startTestDb();
    mock = await startOidcMock(8090);
    await db.pool.query(
      `insert into groups_map(idp_group_id, idp_group_name, role_id) select 'grp-editors','KB-Editors', id from roles where name='editor'`,
    );
    app = await buildApp({
      pool: db.pool,
      boss: false,
      config: {
        DATABASE_URL: db.url,
        NODE_ENV: 'test',
        PUBLIC_URL: 'http://localhost:5173',
        OIDC_ISSUER: mock.issuer,
        OIDC_CLIENT_ID: 'kb',
        OIDC_CLIENT_SECRET: 'secret',
        OIDC_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/callback',
      },
    });
    await app.ready();
  }, 120000);
  afterAll(async () => {
    await app.close();
    await mock.stop();
    await db.stop();
  });

  it('lists providers', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/auth/providers' });
    expect(r.json()).toEqual({ providers: ['entra', 'local'], fallback: 'none' });
  });

  it('logs in, maps groups to roles, and serves /me', async () => {
    mock.setUser({ sub: 'entra-1', email: 'inbar@wecom.co.il', name: 'ענבר ל.', groups: ['grp-editors'] });
    const login = await app.inject({ method: 'GET', url: '/api/v1/auth/login?returnTo=/doc/browsing' });
    expect(login.statusCode).toBe(302);
    const oidcCookie = cookiesOf(login);
    const authorize = await fetch(login.headers.location as string, { redirect: 'manual' });
    const cb = new URL(authorize.headers.get('location')!);
    const callback = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/callback' + cb.search,
      headers: { cookie: oidcCookie },
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('http://localhost:5173/doc/browsing');
    const session = callback.cookies.find((c) => c.name === 'kb_session')!;
    expect(session.httpOnly).toBe(true);
    expect(session.sameSite?.toLowerCase()).toBe('lax');
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `kb_session=${session.value}` },
    });
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(body.user).toMatchObject({
      email: 'inbar@wecom.co.il',
      displayName: 'ענבר ל.',
      source: 'entra',
      initials: 'ע',
    });
    expect(body.roles).toEqual(['editor']);
    expect(body.permissions).toContain('docs.edit');
    expect(body.permissions).not.toContain('docs.publish');
    expect(body.preferences.font).toBe('plex');
    const audit = await db.pool.query(`select action from audit_log order by at desc limit 1`);
    expect(audit.rows[0].action).toBe('auth.login');
    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `kb_session=${session.value}` },
    });
    expect(out.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/auth/me',
          headers: { cookie: `kb_session=${session.value}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('rejects a callback with a mismatched state', async () => {
    const login = await app.inject({ method: 'GET', url: '/api/v1/auth/login' });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/callback?code=x&state=wrong',
      headers: { cookie: cookiesOf(login) },
    });
    expect(r.statusCode).toBe(401);
  });
});
