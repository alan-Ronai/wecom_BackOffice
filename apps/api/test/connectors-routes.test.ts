import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import type { FastifyInstance } from 'fastify';
import { signBody } from '@wecom/connectors';
import { buildApp } from '../src/app.js';
import { startWpStub, type WpStub } from '../../../packages/connectors/test/helpers/wpStub.js';
import { buildL6TestApp } from './helpers/l6/testApp.js';
import { memoryRevisions, seedDocument, sqlDocumentsService } from './helpers/l6/seedDoc.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;

run('connector routes', () => {
  let c: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let app: FastifyInstance;
  let stub: WpStub;
  let userId: string;
  const enqueued: { name: string; data: unknown }[] = [];

  beforeAll(async () => {
    c = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    await runner({
      databaseUrl: c.getConnectionUri(),
      dir: 'migrations',
      direction: 'up',
      migrationsTable: 'pgmigrations',
      ignorePattern: 'package\\.json',
      log: () => undefined,
    });
    pool = new pg.Pool({ connectionString: c.getConnectionUri() });
    userId = (
      await pool.query(
        "insert into users(subject, source, display_name) values ('t', 'local', 'בודק') returning id",
      )
    ).rows[0].id;
    stub = await startWpStub([]);
    app = await buildL6TestApp({
      pool,
      databaseUrl: c.getConnectionUri(),
      testUser: { id: userId, permissions: ['connectors.manage', 'suggestions.apply'] },
      revisions: memoryRevisions(),
      documents: sqlDocumentsService(pool),
      enqueue: async (name, data) => {
        enqueued.push({ name, data });
        return 'job-' + enqueued.length;
      },
    });
  }, 180000);

  afterAll(async () => {
    await app?.close();
    await stub?.close();
    await pool?.end();
    await c?.stop();
  });

  const body = () => ({
    type: 'wordpress',
    name: 'אתר תמיכה',
    config: {
      baseUrl: stub.url,
      username: 'kb',
      applicationPassword: 'pw',
      postTypes: ['posts'],
      categoryMap: {},
      webhookSecret: 'topsecret1',
    },
  });

  it('creates, masks secrets, tests, lists, patches and deletes', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/connectors', payload: body() });
    expect(created.statusCode).toBe(201);
    const conn = created.json();
    // Every connector route answers `ConnectorRowSchema` — the same shape the list returns,
    // so `config` (not `configMasked`) plus the two counts, and no per-type `capabilities`
    // (those belong to `GET /connectors/types`).
    expect(conn.config.applicationPassword).toBe('••••');
    expect(conn.config.webhookSecret).toBe('••••');
    expect(conn.config.baseUrl).toBe(stub.url);
    expect(conn).toMatchObject({ links: 0, conflicts: 0, lastStatus: 'never' });
    expect(conn.capabilities).toBeUndefined();
    const fetched = await app.inject({ method: 'GET', url: `/api/v1/connectors/${conn.id}` });
    const listed = (await app.inject({ method: 'GET', url: '/api/v1/connectors' })).json().items[0];
    // The by-id route and the list are one resource, so they are byte-identical.
    expect(fetched.json()).toEqual(listed);
    const test = await app.inject({ method: 'POST', url: `/api/v1/connectors/${conn.id}/test` });
    expect(test.json().ok).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/v1/connectors' })).json().items).toHaveLength(1);
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/connectors/${conn.id}`,
      payload: { name: 'שם חדש', enabled: false },
    });
    expect(patched.json()).toMatchObject({ name: 'שם חדש', enabled: false });
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/connectors/${conn.id}` })).statusCode).toBe(
      204,
    );
  });

  it('rejects invalid config for the connector type', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors',
      payload: { ...body(), config: { baseUrl: 'nope' } },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('INVALID_CONFIG');
  });

  // Stage-5 contract: the wizard's step-3 dry run, before the connector has an id.
  it('dry-runs a connector test without persisting anything', async () => {
    const before = (await app.inject({ method: 'GET', url: '/api/v1/connectors' })).json().items.length;
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/test',
      payload: { type: 'wordpress', config: body().config },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);
    expect(typeof r.json().message).toBe('string');
    const after = (await app.inject({ method: 'GET', url: '/api/v1/connectors' })).json().items.length;
    expect(after).toBe(before);
  });

  it('a bad dry-run config is a 400, not a stored connector', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/test',
      payload: { type: 'wordpress', config: { baseUrl: 'nope' } },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('INVALID_CONFIG');
  });

  it('an unknown connector type on a dry run is a 400', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/test',
      payload: { type: 'no-such-type', config: {} },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('UNKNOWN_TYPE');
  });

  it('PATCH accepts a body carrying only enabled, only name, or only schedule', async () => {
    const conn = (await app.inject({ method: 'POST', url: '/api/v1/connectors', payload: body() })).json();
    const onlyEnabled = await app.inject({
      method: 'PATCH',
      url: `/api/v1/connectors/${conn.id}`,
      payload: { enabled: false },
    });
    expect(onlyEnabled.statusCode).toBe(200);
    expect(onlyEnabled.json()).toMatchObject({ enabled: false, name: conn.name });

    const onlyName = await app.inject({
      method: 'PATCH',
      url: `/api/v1/connectors/${conn.id}`,
      payload: { name: 'שם אחר' },
    });
    expect(onlyName.statusCode).toBe(200);
    expect(onlyName.json()).toMatchObject({ name: 'שם אחר', enabled: false });

    const onlySchedule = await app.inject({
      method: 'PATCH',
      url: `/api/v1/connectors/${conn.id}`,
      payload: { schedule: '*/5 * * * *' },
    });
    expect(onlySchedule.statusCode).toBe(200);
    expect(onlySchedule.json()).toMatchObject({ schedule: '*/5 * * * *', name: 'שם אחר' });
    // None of the three PATCHes carried a config, so the stored secret survived untouched.
    expect(onlySchedule.json().config.applicationPassword).toBe('••••');
    await app.inject({ method: 'DELETE', url: `/api/v1/connectors/${conn.id}` });
  });

  // Backend ask #1: `schedule` must be clearable — an explicit `null` on the write side
  // is "ללא תזמון", distinct from omitting the key (which leaves the schedule alone).
  it('clears the schedule to null and leaves it alone when the key is omitted', async () => {
    const conn = (await app.inject({ method: 'POST', url: '/api/v1/connectors', payload: body() })).json();
    expect(conn.schedule).toBe('*/15 * * * *');

    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/v1/connectors/${conn.id}`,
      payload: { schedule: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().schedule).toBeNull();
    const row = await pool.query('select schedule from connectors where id=$1', [conn.id]);
    expect(row.rows[0].schedule).toBeNull();

    // Omitting `schedule` entirely on the next PATCH must leave it cleared, not
    // silently restore a default — the tri-state write is the whole point of the ask.
    const untouched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/connectors/${conn.id}`,
      payload: { name: 'עוד שם' },
    });
    expect(untouched.statusCode).toBe(200);
    expect(untouched.json().schedule).toBeNull();

    const reset = await app.inject({
      method: 'PATCH',
      url: `/api/v1/connectors/${conn.id}`,
      payload: { schedule: '*/10 * * * *' },
    });
    expect(reset.json().schedule).toBe('*/10 * * * *');
    await app.inject({ method: 'DELETE', url: `/api/v1/connectors/${conn.id}` });
  });

  it('creates a connector with no schedule when the client asks for none up front', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors',
      payload: { ...body(), schedule: null },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().schedule).toBeNull();
    await app.inject({ method: 'DELETE', url: `/api/v1/connectors/${created.json().id}` });
  });

  // Backend ask #2: PATCH merges `config` rather than replacing it.
  it('merges config on PATCH: partial updates keep other keys, and null clears one', async () => {
    const conn = (await app.inject({ method: 'POST', url: '/api/v1/connectors', payload: body() })).json();

    // A partial config PATCH (one key) must not disturb the keys it didn't mention.
    const partial = await app.inject({
      method: 'PATCH',
      url: `/api/v1/connectors/${conn.id}`,
      payload: { config: { username: 'kb-partial' } },
    });
    expect(partial.statusCode).toBe(200);
    expect(partial.json().config).toMatchObject({
      username: 'kb-partial',
      baseUrl: stub.url,
      postTypes: ['posts'],
    });

    // Explicit `null` clears a key — `categoryMap` has a schema default ({}), so
    // clearing it is observable as the config reverting to that default.
    const beforeClear = await app.inject({ method: 'GET', url: `/api/v1/connectors/${conn.id}` });
    expect(beforeClear.json().config.categoryMap).toEqual({});
    const withMap = await app.inject({
      method: 'PATCH',
      url: `/api/v1/connectors/${conn.id}`,
      payload: { config: { categoryMap: { תמיכה: 'sim' } } },
    });
    expect(withMap.json().config.categoryMap).toEqual({ תמיכה: 'sim' });
    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/v1/connectors/${conn.id}`,
      payload: { config: { categoryMap: null } },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().config.categoryMap).toEqual({});
    // Untouched keys (including the still-masked secrets) survive both PATCHes above.
    expect(cleared.json().config).toMatchObject({ username: 'kb-partial', baseUrl: stub.url });
    expect(cleared.json().config.applicationPassword).toBe('••••');
    await app.inject({ method: 'DELETE', url: `/api/v1/connectors/${conn.id}` });
  });

  // N3 (re-review, minor): `type` is immutable — `repo.update` has no column for it, and
  // `config` is validated against the *stored* type, so a silently-accepted `type` change
  // would validate config against the wrong schema and then drop the type change anyway.
  it('rejects a PATCH that tries to change the connector type', async () => {
    const conn = (await app.inject({ method: 'POST', url: '/api/v1/connectors', payload: body() })).json();
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/connectors/${conn.id}`,
      payload: { type: 'json' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('IMMUTABLE_TYPE');
    const fetched = await app.inject({ method: 'GET', url: `/api/v1/connectors/${conn.id}` });
    expect(fetched.json().type).toBe('wordpress');
    await app.inject({ method: 'DELETE', url: `/api/v1/connectors/${conn.id}` });
  });

  it('a re-sent, unchanged type is not treated as a type change', async () => {
    const conn = (await app.inject({ method: 'POST', url: '/api/v1/connectors', payload: body() })).json();
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/connectors/${conn.id}`,
      payload: { type: 'wordpress', name: 'שם עדכני' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ type: 'wordpress', name: 'שם עדכני' });
    await app.inject({ method: 'DELETE', url: `/api/v1/connectors/${conn.id}` });
  });

  it('a masked secret round-tripped in a PATCH leaves the stored secret unchanged', async () => {
    const conn = (await app.inject({ method: 'POST', url: '/api/v1/connectors', payload: body() })).json();
    const before = await pool.query('select config_encrypted from connectors where id=$1', [conn.id]);
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/connectors/${conn.id}`,
      payload: {
        config: {
          // Unchanged: the UI would normally omit these, but the server must not
          // trust a client that sends the placeholder back literally either.
          applicationPassword: '••••',
          webhookSecret: '••••',
          // The one field actually being changed.
          username: 'kb2',
        },
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().config).toMatchObject({
      applicationPassword: '••••',
      webhookSecret: '••••',
      username: 'kb2',
    });
    const after = await pool.query('select config_encrypted from connectors where id=$1', [conn.id]);
    // username changed, so the ciphertext blob as a whole differs from before — the real
    // assertion is what it decrypts to.
    expect(Buffer.compare(before.rows[0].config_encrypted, after.rows[0].config_encrypted)).not.toBe(0);
    const row = await app.connectors.repo.get(conn.id);
    const decrypted = app.connectors.repo.config<{
      applicationPassword: string;
      webhookSecret: string;
      username: string;
    }>(row!);
    // The literal mask was never written over the real secret — it decrypts to the
    // original value the connector was created with, not '••••'.
    expect(decrypted.applicationPassword).toBe(body().config.applicationPassword);
    expect(decrypted.webhookSecret).toBe(body().config.webhookSecret);
    expect(decrypted.username).toBe('kb2');
    await app.inject({ method: 'DELETE', url: `/api/v1/connectors/${conn.id}` });
  });

  // Stage-5 contract: "run now" answers with what the run did (`SyncRunResultSchema`),
  // not a job id — the operator pressing it is watching for those numbers.
  it('runs a connector and reports the result', async () => {
    const conn = (await app.inject({ method: 'POST', url: '/api/v1/connectors', payload: body() })).json();
    const r = await app.inject({ method: 'POST', url: `/api/v1/connectors/${conn.id}/run` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ imported: 0, pushed: 0, conflicts: 0, errors: [] });
    await app.inject({ method: 'DELETE', url: `/api/v1/connectors/${conn.id}` });
  });

  it('accepts a signed webhook and rejects an unsigned one', async () => {
    const conn = (await app.inject({ method: 'POST', url: '/api/v1/connectors', payload: body() })).json();
    const raw = JSON.stringify({
      event: 'save_post',
      post_type: 'posts',
      post_id: 7,
      modified_gmt: '2025-06-12T10:00:00',
      sent_at: new Date().toISOString(),
    });
    const ok = await app.inject({
      method: 'POST',
      url: `/api/v1/connectors/${conn.id}/webhook`,
      payload: raw,
      headers: { 'content-type': 'application/json', 'x-kb-signature': signBody('topsecret1', raw) },
    });
    expect(ok.statusCode).toBe(202);
    expect(enqueued.at(-1)).toMatchObject({ name: 'connector.webhook' });
    const bad = await app.inject({
      method: 'POST',
      url: `/api/v1/connectors/${conn.id}/webhook`,
      payload: raw,
      headers: { 'content-type': 'application/json', 'x-kb-signature': 'ff'.repeat(32) },
    });
    expect(bad.statusCode).toBe(401);
    await app.inject({ method: 'DELETE', url: `/api/v1/connectors/${conn.id}` });
  });

  /**
   * I7 residual. The signature proves the bytes are ours and `assertFresh` proves they are at
   * most five minutes old; neither says how many times they have arrived. Before this, anyone
   * who could observe one delivery could post it again inside that window, as often as they
   * liked, and every copy was a real sync run.
   */
  it('rejects a replayed signed webhook as 409 REPLAY, and still rejects a stale one as 401', async () => {
    const conn = (await app.inject({ method: 'POST', url: '/api/v1/connectors', payload: body() })).json();
    const deliver = (raw: string) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/connectors/${conn.id}/webhook`,
        payload: raw,
        headers: {
          'content-type': 'application/json',
          'x-kb-signature': signBody('topsecret1', raw),
          'x-kb-nonce': JSON.parse(raw).nonce,
        },
      });
    const raw = JSON.stringify({
      event: 'save_post',
      post_type: 'posts',
      post_id: 11,
      modified_gmt: '2025-06-12T10:00:00',
      sent_at: new Date().toISOString(),
      nonce: 'nonce-' + Date.now(),
    });

    const first = await deliver(raw);
    expect(first.statusCode).toBe(202);
    const before = enqueued.length;

    // Byte-for-byte the same request, signature and all — which is exactly what a capture is.
    const second = await deliver(raw);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('REPLAY');
    // The point of the 409: no second sync run was queued.
    expect(enqueued.length).toBe(before);

    // A different body under the same connector is not a replay.
    const other = await deliver(raw.replace('"post_id":11', '"post_id":12'));
    expect(other.statusCode).toBe(202);

    // The out-of-window rejection is unchanged: still 401, still not distinguishable from a
    // bad secret, so probing cannot tell a stale capture from a wrong key.
    const staleRaw = JSON.stringify({
      event: 'save_post',
      post_type: 'posts',
      post_id: 13,
      modified_gmt: '2025-06-12T10:00:00',
      sent_at: new Date(Date.now() - 20 * 60_000).toISOString(),
      nonce: 'stale',
    });
    expect((await deliver(staleRaw)).statusCode).toBe(401);

    // The nonce header is optional for one release: an old plugin that omits it still works.
    const oldPluginRaw = JSON.stringify({
      event: 'save_post',
      post_type: 'posts',
      post_id: 14,
      modified_gmt: '2025-06-12T10:00:00',
      sent_at: new Date().toISOString(),
    });
    const oldPlugin = await app.inject({
      method: 'POST',
      url: `/api/v1/connectors/${conn.id}/webhook`,
      payload: oldPluginRaw,
      headers: {
        'content-type': 'application/json',
        'x-kb-signature': signBody('topsecret1', oldPluginRaw),
      },
    });
    expect(oldPlugin.statusCode).toBe(202);

    // The TTL purge is what keeps the table from growing one row per post save forever.
    const { purgeWebhookNonces } = await import('../src/modules/connectors/nonces.js');
    expect(await purgeWebhookNonces(pool, -1)).toBeGreaterThan(0);
    expect((await pool.query('select count(*)::int n from webhook_nonces')).rows[0].n).toBe(0);
    // Purged means forgettable: the same bytes are accepted again once the window has passed.
    expect((await deliver(raw)).statusCode).toBe(202);

    await app.inject({ method: 'DELETE', url: `/api/v1/connectors/${conn.id}` });
  });

  /** The flag is the deprecation switch, not the protection: it makes a pre-header plugin loud. */
  it('refuses a webhook with no nonce header once WEBHOOK_REQUIRE_NONCE is on', async () => {
    const strict = await buildL6TestApp({
      pool,
      databaseUrl: c.getConnectionUri(),
      env: { WEBHOOK_REQUIRE_NONCE: 'true' },
      testUser: { id: userId, permissions: ['connectors.manage', 'suggestions.apply'] },
      revisions: memoryRevisions(),
      documents: sqlDocumentsService(pool),
      enqueue: async () => 'job-strict',
    });
    try {
      const conn = (
        await strict.inject({ method: 'POST', url: '/api/v1/connectors', payload: body() })
      ).json();
      const raw = JSON.stringify({
        event: 'save_post',
        post_type: 'posts',
        post_id: 21,
        modified_gmt: '2025-06-12T10:00:00',
        sent_at: new Date().toISOString(),
        nonce: 'n-21',
      });
      const headers = {
        'content-type': 'application/json',
        'x-kb-signature': signBody('topsecret1', raw),
      };
      const without = await strict.inject({
        method: 'POST',
        url: `/api/v1/connectors/${conn.id}/webhook`,
        payload: raw,
        headers,
      });
      expect(without.statusCode).toBe(400);
      expect(without.json().code).toBe('MISSING_NONCE');
      const with_ = await strict.inject({
        method: 'POST',
        url: `/api/v1/connectors/${conn.id}/webhook`,
        payload: raw,
        headers: { ...headers, 'x-kb-nonce': 'n-21' },
      });
      expect(with_.statusCode).toBe(202);
      await strict.inject({ method: 'DELETE', url: `/api/v1/connectors/${conn.id}` });
    } finally {
      await strict.close();
    }
  });

  it('forbids without permission', async () => {
    const noPerm = await buildL6TestApp({
      pool,
      databaseUrl: c.getConnectionUri(),
      testUser: { id: userId, permissions: ['docs.read'] },
      revisions: memoryRevisions(),
      documents: sqlDocumentsService(pool),
    });
    expect((await noPerm.inject({ method: 'GET', url: '/api/v1/connectors' })).statusCode).toBe(403);
    expect(
      (
        await noPerm.inject({
          method: 'POST',
          url: '/api/v1/connectors/test',
          payload: { type: 'wordpress', config: body().config },
        })
      ).statusCode,
    ).toBe(403);
    await noPerm.close();
  });

  it('pushes a linked document on publish', async () => {
    const conn = (await app.inject({ method: 'POST', url: '/api/v1/connectors', payload: body() })).json();
    const { docId } = await seedDocument(pool, conn.id, 'posts:7');
    stub.posts.set('posts:7', {
      id: 7,
      title: { rendered: 'ישן' },
      content: { rendered: '<p>ישן</p>' },
      modified_gmt: '2025-01-01T00:00:00',
      link: 'http://wp/7',
      status: 'publish',
    });
    await app.connectors.sync.pushDocument(conn.id, docId, userId);
    expect(stub.posts.get('posts:7')!.title.rendered).toBe('איטיות גלישה');
    const links = (await app.inject({ method: 'GET', url: `/api/v1/connectors/${conn.id}/links` })).json();
    expect(links.items[0]).toMatchObject({ externalId: 'posts:7', state: 'synced', baseLocalVersion: 1 });

    // The hook L2's publish.ts calls: every in-parity link is pushed again.
    await pool.query('update documents set current_version=2, title=$2 where id=$1', [docId, 'גרסה חדשה']);
    const refs = await app.connectors.sync.pushOnPublish(docId, userId);
    expect(refs).toHaveLength(1);
    expect(stub.posts.get('posts:7')!.title.rendered).toBe('גרסה חדשה');
    const after = (await app.inject({ method: 'GET', url: `/api/v1/connectors/${conn.id}/links` })).json();
    expect(after.items[0]).toMatchObject({ state: 'synced', baseLocalVersion: 2 });
    await app.inject({ method: 'DELETE', url: `/api/v1/connectors/${conn.id}` });
  });

  it('is registered on the real app and refuses anonymous access', async () => {
    // Its own pool: buildApp's db plugin ends the pool it is given on close.
    const ownPool = new pg.Pool({ connectionString: c.getConnectionUri() });
    const real = await buildApp({
      config: { DATABASE_URL: c.getConnectionUri(), NODE_ENV: 'test' },
      pool: ownPool,
      boss: false,
    });
    const r = await real.inject({ method: 'GET', url: '/api/v1/connectors' });
    // L3's auth plugin answers 401 for an anonymous caller; the local shim
    // (used before L3 landed) answers 403. Either proves the route is wired
    // and not public.
    expect([401, 403]).toContain(r.statusCode);
    await real.close();
  });
});
