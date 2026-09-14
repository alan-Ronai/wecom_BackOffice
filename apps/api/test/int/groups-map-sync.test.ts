import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { startTestDb, seedUser, createSession, integration } from '../helpers/l3/db.js';
import { startOidcMock } from '../helpers/l3/oidc.js';
import { hashToken } from '../../src/lib/session.js';
import { IdentityService } from '../../src/modules/auth/identity.js';
import { runIdentitySync } from '../../src/jobs/identity-sync.js';
import { readGroupsSyncState } from '../../src/modules/admin/groups-sync-state.js';

const run = integration ? describe : describe.skip;

/**
 * Design 3d's two remaining halves: the Entra group picker, and "סנכרון אחרון" per mapping.
 *
 * The timestamps are the interesting half to test, because the honest answer has three states and
 * only two of them are obvious: synced, never-synced-because-the-job-has-not-run, and
 * never-synced-because-this-mapping-was-added-after-the-last-run. The third is what the screen has
 * to be able to show, and it is the one a "just use the job's last run time" shortcut erases.
 */
run('admin — group map sync stamps and Entra group search', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const admin = { cookie: 'kb_session=gmadm' };

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool, boss: false, config: { DATABASE_URL: db.url, NODE_ENV: 'test' } });
    await app.ready();
    const adminId = await seedUser(db.pool, {
      email: 'gm-admin@wecom.co.il',
      displayName: 'Admin',
      roles: ['admin'],
    });
    await createSession(db.pool, adminId, hashToken('gmadm'));
    await db.pool.query(
      `insert into groups_map(idp_group_id, idp_group_name, role_id) select 'grp-leads','KB-Leads', id from roles where name='lead'`,
    );
  }, 120000);

  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  const entries = async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/groups-map', headers: admin });
    expect(r.statusCode).toBe(200);
    return r.json().entries as { idpGroupId: string; lastSyncedAt: string | null }[];
  };

  it('reads back null before the nightly job has ever run', async () => {
    expect(await entries()).toEqual([
      { idpGroupId: 'grp-leads', idpGroupName: 'KB-Leads', roleId: expect.any(String), lastSyncedAt: null },
    ]);
  });

  it('stamps every mapping the run reconciled', async () => {
    await seedUser(db.pool, {
      email: 'lead@wecom.co.il',
      displayName: 'L',
      subject: 'sub-lead',
      roles: [],
    });
    const summary = await runIdentitySync({
      db: db.pool,
      oidc: {
        listDisabledUsers: async () => new Set<string>(),
        listUserGroups: async () => ['grp-leads'],
      },
      identity: new IdentityService(db.pool, () => undefined),
      log: { info: () => undefined },
    });
    expect(summary.groups).toBe(1);
    const [row] = await entries();
    expect(row.lastSyncedAt).not.toBeNull();
    expect(Date.parse(row.lastSyncedAt!)).toBeLessThanOrEqual(Date.now());
  });

  it('leaves a mapping added after the last run reading as never synced', async () => {
    await db.pool.query(
      `insert into groups_map(idp_group_id, idp_group_name, role_id) select 'grp-new','KB-New', id from roles where name='editor'`,
    );
    const rows = await entries();
    expect(rows.find((e) => e.idpGroupId === 'grp-new')!.lastSyncedAt).toBeNull();
    // …while the mapping the run did reconcile keeps its stamp.
    expect(rows.find((e) => e.idpGroupId === 'grp-leads')!.lastSyncedAt).not.toBeNull();
  });

  it('keeps the stamps out of the write side: PUT does not have to round-trip them', async () => {
    const before = await readGroupsSyncState(db.pool);
    const roleId = (await db.pool.query("select id from roles where name='lead'")).rows[0].id;
    const r = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/groups-map',
      headers: admin,
      payload: { entries: [{ idpGroupId: 'grp-leads', idpGroupName: 'KB-Leads', roleId }] },
    });
    expect(r.statusCode).toBe(200);
    expect(await readGroupsSyncState(db.pool)).toEqual(before);
    expect((await entries())[0].lastSyncedAt).toBe(before['grp-leads']);
  });

  it('answers 503 OIDC_NOT_CONFIGURED for group search when no issuer is configured', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/groups/search?q=KB',
      headers: admin,
    });
    expect(r.statusCode).toBe(503);
    expect(r.json().code).toBe('OIDC_NOT_CONFIGURED');
  });

  it('rejects an empty query rather than asking Graph for every group in the tenant', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/groups/search?q=', headers: admin });
    expect(r.statusCode).toBe(400);
  });

  it('requires roles.manage', async () => {
    const readerId = await seedUser(db.pool, {
      email: 'reader@wecom.co.il',
      displayName: 'R',
      roles: ['agent'],
    });
    await createSession(db.pool, readerId, hashToken('gmread'));
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/groups/search?q=KB',
      headers: { cookie: 'kb_session=gmread' },
    });
    expect(r.statusCode).toBe(403);
  });
});

/**
 * The Graph half, end to end: a real `OidcProvider` against a mock issuer and a stub Graph host.
 *
 * Stubbing `app.oidc` directly is not available from here — the decorator lives on the `/api/v1`
 * scope, which Fastify's encapsulation deliberately keeps out of the root instance — and stubbing
 * the method would in any case skip the parts most worth testing: the client-credentials grant, the
 * OData filter this builds, and the `$select` that keeps the payload to three fields.
 */
run('admin — Entra group search against a Graph stub', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let issuer: Awaited<ReturnType<typeof startOidcMock>>;
  let graph: GraphStub;
  const admin = { cookie: 'kb_session=gsadm' };

  beforeAll(async () => {
    db = await startTestDb();
    issuer = await startOidcMock(8091);
    graph = await startGraphStub();
    app = await buildApp({
      pool: db.pool,
      boss: false,
      config: {
        DATABASE_URL: db.url,
        NODE_ENV: 'test',
        OIDC_ISSUER: issuer.issuer,
        OIDC_CLIENT_ID: 'kb',
        OIDC_CLIENT_SECRET: 'secret',
        OIDC_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/callback',
        OIDC_GRAPH_URL: graph.url,
      },
    });
    await app.ready();
    const adminId = await seedUser(db.pool, {
      email: 'gs-admin@wecom.co.il',
      displayName: 'Admin',
      roles: ['admin'],
    });
    await createSession(db.pool, adminId, hashToken('gsadm'));
  }, 120000);

  afterAll(async () => {
    await app.close();
    await graph.close();
    await issuer.stop();
    await db.stop();
  });

  it('returns the groups Graph found, description optional', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/groups/search?q=KB', headers: admin });
    expect(r.statusCode).toBe(200);
    expect(r.json().items).toEqual([
      { id: 'g-1', displayName: 'KB-Editors', description: 'עורכי ידע' },
      { id: 'g-2', displayName: 'KB-Leads' },
    ]);
    const call = graph.calls.at(-1)!;
    expect(call.searchParams.get('$filter')).toBe("startswith(displayName,'KB')");
    expect(call.searchParams.get('$select')).toBe('id,displayName,description');
    expect(call.authorization).toMatch(/^Bearer /);
  });

  it('trims the query and escapes a quote instead of letting it close the literal', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/admin/groups/search?q=%20KB%20', headers: admin });
    expect(graph.calls.at(-1)!.searchParams.get('$filter')).toBe("startswith(displayName,'KB')");

    await app.inject({
      method: 'GET',
      url: '/api/v1/admin/groups/search?q=' + encodeURIComponent("x') or startswith(displayName,'"),
      headers: admin,
    });
    expect(graph.calls.at(-1)!.searchParams.get('$filter')).toBe(
      "startswith(displayName,'x'') or startswith(displayName,''')",
    );
  });

  it('turns a Graph failure into a 502 the screen can explain, not a 500', async () => {
    graph.fail = true;
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/groups/search?q=boom', headers: admin });
    graph.fail = false;
    expect(r.statusCode).toBe(502);
    expect(r.json().code).toBe('GRAPH_UNAVAILABLE');
  });
});

interface GraphStub {
  url: string;
  calls: { searchParams: URLSearchParams; authorization: string | null }[];
  fail: boolean;
  close(): Promise<void>;
}

/** Just enough of `GET /groups` to exercise the filter this builds and the token it sends. */
async function startGraphStub(): Promise<GraphStub> {
  const calls: GraphStub['calls'] = [];
  let fail = false;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    calls.push({ searchParams: url.searchParams, authorization: req.headers.authorization ?? null });
    if (fail) {
      res.writeHead(503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { code: 'serviceUnavailable' } }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        value: [
          { id: 'g-1', displayName: 'KB-Editors', description: 'עורכי ידע' },
          { id: 'g-2', displayName: 'KB-Leads' },
        ],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: 'http://127.0.0.1:' + (server.address() as AddressInfo).port,
    calls,
    get fail() {
      return fail;
    },
    set fail(v: boolean) {
      fail = v;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
