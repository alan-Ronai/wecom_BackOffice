import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { SyncService } from '../src/modules/connectors/sync.js';
import { ConnectorsRepo } from '../src/modules/connectors/repo.js';
import { buildRegistry } from '../src/modules/connectors/registry.js';
import { startWpStub, type WpStub } from '../../../packages/connectors/test/helpers/wpStub.js';
import { seedDocument, sqlDocumentsService, memoryRevisions } from './helpers/l6/seedDoc.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;

run('sync integration', () => {
  let c: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let stub: WpStub;
  let repo: ConnectorsRepo;
  let svc: SyncService;
  let connectorId: string;
  let docId: string;
  let sourceId: string;
  const revisions = memoryRevisions();
  const events: unknown[] = [];

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
    stub = await startWpStub([
      {
        id: 7,
        title: { rendered: 'איטיות גלישה' },
        content: { rendered: '<h2>שלב 1</h2><p>פתח CRM</p>' },
        modified_gmt: '2025-06-12T10:00:00',
        link: 'http://wp/7',
        status: 'publish',
      },
    ]);
    repo = new ConnectorsRepo(pool, '00'.repeat(32));
    const row = await repo.create(
      {
        type: 'wordpress',
        name: 'wp',
        config: {
          baseUrl: stub.url,
          username: 'u',
          applicationPassword: 'p',
          postTypes: ['posts'],
          categoryMap: {},
          webhookSecret: 'topsecret1',
        },
      },
      null,
    );
    connectorId = row.id;
    ({ docId, sourceId } = await seedDocument(pool, connectorId, 'posts:7'));
    svc = new SyncService({
      repo,
      registry: buildRegistry(),
      db: pool,
      revisions,
      documents: sqlDocumentsService(pool),
      events: { publish: (e) => events.push(e) },
    });
    // Establish the baseline: the first push sends local v1 -> synced.
    await svc.pushDocument(connectorId, docId, null);
  }, 180000);

  afterAll(async () => {
    await pool?.end();
    await stub?.close();
    await c?.stop();
  });

  it('starts synced', async () => {
    expect((await repo.links(connectorId))[0].state).toBe('synced');
    expect((await svc.runConnector(connectorId, null)).imported).toBe(0);
  });

  it('remote-only edit → revision ingested, pending_import', async () => {
    stub.posts.get('posts:7')!.content.rendered = '<h2>שלב 1</h2><p>פתח CRM ↗ שדה חדש</p>';
    stub.posts.get('posts:7')!.modified_gmt = '2025-07-01T00:00:00';
    const r = await svc.runConnector(connectorId, null);
    expect(r.imported).toBe(1);
    expect(revisions.calls.map((x) => x.sourceId)).toEqual([sourceId]);
    expect((await repo.links(connectorId))[0].state).toBe('pending_import');
  });

  it('after suggestions applied → baseline moves and state is synced', async () => {
    await pool.query('update documents set current_version=2 where id=$1', [docId]);
    await svc.afterSuggestionsApplied(sourceId, docId, 2);
    const l = (await repo.links(connectorId))[0];
    expect(l.state).toBe('synced');
    expect(l.base_local_version).toBe(2);
    expect((await svc.runConnector(connectorId, null)).imported).toBe(0);
  });

  it('local-only edit → pushed to WordPress', async () => {
    await pool.query('update documents set current_version=3, title=$2 where id=$1', [
      docId,
      'איטיות גלישה (מעודכן)',
    ]);
    const r = await svc.runConnector(connectorId, null);
    expect(r.pushed).toBe(1);
    expect(stub.posts.get('posts:7')!.title.rendered).toBe('איטיות גלישה (מעודכן)');
    expect((await repo.links(connectorId))[0]).toMatchObject({ state: 'synced', base_local_version: 3 });
  });

  it('both changed → conflict, then merged resolution pushes and clears', async () => {
    stub.posts.get('posts:7')!.content.rendered = '<h2>שלב 1</h2><p>שינוי מרחוק</p>';
    await pool.query('update documents set current_version=4 where id=$1', [docId]);
    const r = await svc.runConnector(connectorId, null);
    expect(r.conflicts).toBe(1);
    const link = (await repo.links(connectorId))[0];
    expect(link.state).toBe('conflict');
    expect((link.conflict as { remote: unknown[] }).remote).toHaveLength(2);
    expect(events.some((e) => (e as { name: string }).name === 'sync.conflict')).toBe(true);
    const merged = await sqlDocumentsService(pool).getById(docId);
    const resolved = await svc.resolveConflict(link, { resolution: 'merged', merged: merged! }, null);
    expect(resolved.state).toBe('synced');
    expect(stub.puts[stub.puts.length - 1].id).toBe(7);
  });
});
