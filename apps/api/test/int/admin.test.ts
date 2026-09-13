import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { startTestDb, seedUser, createSession, integration } from '../helpers/l3/db.js';
import { hashToken } from '../../src/lib/session.js';

const run = integration ? describe : describe.skip;
run('admin routes', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminId: string;
  let editorId: string;
  const admin = { cookie: 'kb_session=adm' };
  const editor = { cookie: 'kb_session=edt' };
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({
      pool: db.pool,
      boss: false,
      config: { DATABASE_URL: db.url, NODE_ENV: 'test' },
    });
    await app.ready();
    adminId = await seedUser(db.pool, { email: 'admin@wecom.co.il', displayName: 'Admin', roles: ['admin'] });
    editorId = await seedUser(db.pool, {
      email: 'ed@wecom.co.il',
      displayName: 'ענבר ל.',
      roles: ['editor'],
    });
    await createSession(db.pool, adminId, hashToken('adm'));
    await createSession(db.pool, editorId, hashToken('edt'));
  }, 120000);
  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  it('denies non-admins', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: editor });
    expect(r.statusCode).toBe(403);
    expect(r.json().details.permission).toBe('users.manage');
  });
  it('lists users with roles and searches', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/users?q=ענבר', headers: admin });
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(1);
    expect(r.json().items[0].roles[0].roleName).toBe('editor');
  });
  it('replaces roles with a category scope and writes audit', async () => {
    const leadId = (await db.pool.query(`select id from roles where name='lead'`)).rows[0].id;
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${editorId}`,
      headers: admin,
      payload: { roles: [{ roleId: leadId, categoryScope: ['intl'] }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().auditId).toBeTruthy();
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: editor });
    expect(me.json().roles).toEqual(['lead']);
    expect(me.json().categoryScopes).toEqual(['intl']);
    const a = await db.pool.query(`select action, entity_id from audit_log where action='admin.user.patch'`);
    expect(a.rows[0].entity_id).toBe(editorId);
  });
  it('deactivation revokes sessions and self-deactivation is refused', async () => {
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/admin/users/${adminId}`,
          headers: admin,
          payload: { active: false },
        })
      ).json().code,
    ).toBe('SELF_DEACTIVATE');
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${editorId}`,
      headers: admin,
      payload: { active: false },
    });
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: editor })).statusCode).toBe(
      401,
    );
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${editorId}`,
      headers: admin,
      payload: { active: true },
    });
    // reactivation does not resurrect revoked sessions: the editor signs in again
    await createSession(db.pool, editorId, hashToken('edt2'));
    editor.cookie = 'kb_session=edt2';
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: editor })).statusCode).toBe(
      200,
    );
  });
  it('creates, edits and protects roles', async () => {
    const c = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/roles',
      headers: admin,
      payload: { name: 'qa', description: 'בקרת איכות', permissions: ['docs.read', 'suggestions.review'] },
    });
    expect(c.statusCode).toBe(200);
    expect(c.json().permissions).toEqual(['docs.read', 'suggestions.review']);
    const adminRole = (await db.pool.query(`select id from roles where name='admin'`)).rows[0].id;
    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/roles/${adminRole}`,
      headers: admin,
      payload: { permissions: ['docs.read'] },
    });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().code).toBe('LOCKED_PERMISSION');
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/roles/${adminRole}`,
      headers: admin,
    });
    expect(del.json().code).toBe('SYSTEM_ROLE');
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/admin/roles/${c.json().id}`,
          headers: admin,
        })
      ).statusCode,
    ).toBe(200);
  });
  it('replaces the group map', async () => {
    const editorRole = (await db.pool.query(`select id from roles where name='editor'`)).rows[0].id;
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/groups-map',
      headers: admin,
      payload: { entries: [{ idpGroupId: 'g1', idpGroupName: 'KB-Editors', roleId: editorRole }] },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/v1/admin/groups-map', headers: admin });
    expect(get.json().entries).toEqual([
      { idpGroupId: 'g1', idpGroupName: 'KB-Editors', roleId: editorRole },
    ]);
  });
  it('lists and revokes sessions', async () => {
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/sessions?userId=${editorId}`,
      headers: admin,
    });
    expect(list.json().items.length).toBe(1);
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/sessions/${list.json().items[0].id}`,
      headers: admin,
    });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: editor })).statusCode).toBe(
      401,
    );
  });
  it('queries the audit log', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit?entityType=user&entityId=${editorId}`,
      headers: admin,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBeGreaterThan(0);
    expect(r.json().items[0].actorName).toBe('Admin');
  });
});
