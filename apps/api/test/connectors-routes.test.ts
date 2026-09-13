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
    expect(conn.configMasked.applicationPassword).toBe('••••');
    expect(conn.configMasked.webhookSecret).toBe('••••');
    expect(conn.configMasked.baseUrl).toBe(stub.url);
    expect(conn.capabilities.write).toBe(true);
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

  it('enqueues a run job', async () => {
    const conn = (await app.inject({ method: 'POST', url: '/api/v1/connectors', payload: body() })).json();
    const r = await app.inject({ method: 'POST', url: `/api/v1/connectors/${conn.id}/run` });
    expect(r.statusCode).toBe(202);
    expect(r.json().jobId).toMatch(/^job-/);
    expect(enqueued.at(-1)).toMatchObject({ name: 'connector.run', data: { connectorId: conn.id } });
    await app.inject({ method: 'DELETE', url: `/api/v1/connectors/${conn.id}` });
  });

  it('accepts a signed webhook and rejects an unsigned one', async () => {
    const conn = (await app.inject({ method: 'POST', url: '/api/v1/connectors', payload: body() })).json();
    const raw = JSON.stringify({
      event: 'save_post',
      post_type: 'posts',
      post_id: 7,
      modified_gmt: '2025-06-12T10:00:00',
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

  it('forbids without permission', async () => {
    const noPerm = await buildL6TestApp({
      pool,
      databaseUrl: c.getConnectionUri(),
      testUser: { id: userId, permissions: ['docs.read'] },
      revisions: memoryRevisions(),
      documents: sqlDocumentsService(pool),
    });
    expect((await noPerm.inject({ method: 'GET', url: '/api/v1/connectors' })).statusCode).toBe(403);
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
