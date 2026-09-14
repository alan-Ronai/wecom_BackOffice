import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { startTestDb, seedUser, createSession, integration } from '../helpers/l3/db.js';
import { startOidcMock } from '../helpers/l3/oidc.js';
import { startPaloAltoStub } from '../helpers/l3/paloalto.js';
import { hashToken } from '../../src/lib/session.js';

const run = integration ? describe : describe.skip;

run('stage 5 — admin, roles and identity settings', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let oidc: Awaited<ReturnType<typeof startOidcMock>>;
  let firewall: Awaited<ReturnType<typeof startPaloAltoStub>>;
  let adminId: string;
  let editorId: string;
  let victimId: string;
  const admin = { cookie: 'kb_session=s5adm' };
  const editor = { cookie: 'kb_session=s5edt' };

  beforeAll(async () => {
    db = await startTestDb();
    oidc = await startOidcMock(8095);
    firewall = await startPaloAltoStub(8096);
    app = await buildApp({
      pool: db.pool,
      boss: false,
      // The firewall stub speaks plain http, and the settings row has to be able to
      // override the env — so the env deliberately starts empty here.
      config: { DATABASE_URL: db.url, NODE_ENV: 'test', PALOALTO_SCHEME: 'http' },
    });
    await app.ready();
    adminId = await seedUser(db.pool, {
      email: 'admin5@wecom.co.il',
      displayName: 'מנהל',
      roles: ['admin'],
    });
    editorId = await seedUser(db.pool, {
      email: 'inbar5@wecom.co.il',
      displayName: 'ענבר לוי',
      roles: ['editor'],
      categoryScope: ['tech'],
    });
    victimId = await seedUser(db.pool, {
      email: 'old@wecom.co.il',
      displayName: 'משתמש כבוי',
      source: 'local',
      roles: ['agent'],
      active: false,
    });
    await createSession(db.pool, adminId, hashToken('s5adm'));
    await createSession(db.pool, editorId, hashToken('s5edt'));
    // Two live sessions for the editor, so the count is not trivially 1 everywhere.
    await createSession(db.pool, editorId, hashToken('s5edt-second'));
    const roleId = (await db.pool.query("select id from roles where name='editor'")).rows[0].id;
    await db.pool.query(
      `insert into groups_map(idp_group_id, idp_group_name, role_id) values ('g-ed','KB Editors',$1)`,
      [roleId],
    );
  }, 180000);

  afterAll(async () => {
    await app.close();
    await oidc.stop();
    await firewall.stop();
    await db.stop();
  });

  it('lists users with roles, groups and live session counts', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/users?q=ענבר', headers: admin });
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(1);
    const row = r.json().items[0];
    expect(row).toMatchObject({ displayName: 'ענבר לוי', sessions: 2, source: 'entra' });
    expect(row.roles[0]).toMatchObject({ roleName: 'editor', categoryScope: ['tech'] });
    expect(row.groups).toEqual(['KB Editors']);
    expect(row.createdAt).toMatch(/^\d{4}-/);
  });

  it('filters by source, role and active state', async () => {
    const bySource = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?source=local',
      headers: admin,
    });
    expect(bySource.json().items.map((u: { displayName: string }) => u.displayName)).toEqual(['משתמש כבוי']);
    const byRole = await app.inject({ method: 'GET', url: '/api/v1/admin/users?role=admin', headers: admin });
    expect(byRole.json().total).toBe(1);
    expect(byRole.json().items[0].displayName).toBe('מנהל');
    const inactive = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?active=false',
      headers: admin,
    });
    expect(inactive.json().total).toBe(1);
    expect(inactive.json().items[0].active).toBe(false);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: editor })).statusCode,
    ).toBe(403);
  });

  it('returns the role matrix with per-role user counts', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/roles/matrix', headers: admin });
    expect(r.statusCode).toBe(200);
    const m = r.json();
    expect(m.permissions.length).toBeGreaterThan(10);
    expect(m.permissions.find((p: { name: string }) => p.name === 'docs.publish').resource).toBe('docs');
    const roleNames = m.roles.map((x: { name: string }) => x.name);
    expect(roleNames).toEqual(expect.arrayContaining(['admin', 'lead', 'editor', 'agent']));
    const adminRole = m.roles.find((x: { name: string }) => x.name === 'admin');
    expect(adminRole.system).toBe(true);
    expect(adminRole.users).toBe(1);
    expect(adminRole.permissions).toContain('system.admin');
    const agentRole = m.roles.find((x: { name: string }) => x.name === 'agent');
    expect(agentRole.permissions).not.toContain('docs.publish');
  });

  it('returns one audit entry with a computed diff', async () => {
    // Patched on a user with no session of its own: deactivating revokes sessions, and
    // the editor's cookie is still needed by the 403 checks below.
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${victimId}`,
      headers: admin,
      payload: { active: true, roles: [] },
    });
    expect(patched.statusCode).toBe(200);
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit/${patched.json().auditId}`,
      headers: admin,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ action: 'admin.user.patch', entityType: 'user', entityId: victimId });
    expect(r.json().actorName).toBe('מנהל');
    expect(r.json().diff).toContainEqual({ path: 'active', before: false, after: true });
    // `roles` was present before and absent after: reported once, not exploded per role.
    expect(r.json().diff.every((d: { path: string }) => !d.path.includes('['))).toBe(true);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/admin/audit/' + adminId, headers: admin })).statusCode,
    ).toBe(404);
  });

  it('identity settings round-trip, with secrets write-only', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/v1/admin/identity', headers: admin });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({
      oidc: { enabled: false, issuer: null, hasSecret: false, groupsClaim: true },
      paloalto: { enabled: false, host: null, hasApiKey: false, subnets: [] },
    });
    expect(before.json().sessionHours).toBe(8);

    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/identity',
      headers: admin,
      payload: {
        oidc: {
          enabled: true,
          issuer: oidc.issuer,
          clientId: 'kb-client',
          clientSecret: 'super-secret-value',
          redirectUri: 'http://localhost:5173/auth/callback',
        },
        paloalto: { enabled: true, host: '127.0.0.1:8096', apiKey: 'k', subnets: ['10.0.0.0/8'] },
        sessionHours: 12,
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      oidc: { enabled: true, issuer: oidc.issuer, clientId: 'kb-client', hasSecret: true },
      paloalto: { enabled: true, host: '127.0.0.1:8096', hasApiKey: true, subnets: ['10.0.0.0/8'] },
      sessionHours: 12,
    });
    // Never echoed, never audited, and never stored in the clear.
    expect(JSON.stringify(put.json())).not.toContain('super-secret-value');
    const stored = await db.pool.query(
      "select value, secrets_encrypted from app_settings where key='identity'",
    );
    expect(JSON.stringify(stored.rows[0].value)).not.toContain('super-secret-value');
    expect(stored.rows[0].secrets_encrypted.toString('utf8')).not.toContain('super-secret-value');
    const logged = await db.pool.query(
      `select before, after from audit_log where action='admin.identity.update' order by at desc limit 1`,
    );
    expect(JSON.stringify(logged.rows[0])).not.toContain('super-secret-value');

    // A partial PUT keeps the secret it was not sent.
    const partial = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/identity',
      headers: admin,
      payload: { sessionHours: 24 },
    });
    expect(partial.json()).toMatchObject({
      sessionHours: 24,
      oidc: { hasSecret: true, clientId: 'kb-client' },
      paloalto: { hasApiKey: true },
    });
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/admin/identity', headers: editor })).statusCode,
    ).toBe(403);
  });

  it('tests OIDC discovery and the Palo Alto op command for real', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/identity/test',
      headers: admin,
      payload: { provider: 'oidc' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ provider: 'oidc', ok: true });
    expect(ok.json().details.tokenEndpoint).toContain(oidc.issuer);

    const pa = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/identity/test',
      headers: admin,
      payload: { provider: 'paloalto' },
    });
    expect(pa.json()).toMatchObject({ provider: 'paloalto', ok: true });
    expect(firewall.calls.at(-1)).toContain('type=op');
    expect(pa.json().details.status).toBe('success');
    expect(JSON.stringify(pa.json())).not.toContain('key=k');

    // A wrong key is a reported failure, not a 500.
    await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/identity',
      headers: admin,
      payload: { paloalto: { apiKey: 'wrong' } },
    });
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/identity/test',
      headers: admin,
      payload: { provider: 'paloalto' },
    });
    expect(bad.statusCode).toBe(200);
    expect(bad.json().ok).toBe(false);

    // So is an issuer nobody is listening on.
    await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/identity',
      headers: admin,
      payload: { oidc: { issuer: 'http://127.0.0.1:9/nope' } },
    });
    const unreachable = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/identity/test',
      headers: admin,
      payload: { provider: 'oidc' },
    });
    expect(unreachable.statusCode).toBe(200);
    expect(unreachable.json().ok).toBe(false);
  });
});
