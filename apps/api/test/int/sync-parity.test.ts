import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestDb, integration } from '../helpers/db.js';
import { startWpStub, type WpStub } from '../../../../packages/connectors/test/helpers/wpStub.js';
import { buildL6TestApp } from '../helpers/l6/testApp.js';
import { memoryRevisions, seedDocument, sqlDocumentsService } from '../helpers/l6/seedDoc.js';
import { createRemoteCache } from '../../src/modules/sync/remote-cache.js';

const run = integration ? describe : describe.skip;

/**
 * Design 4d: the parity report. The queue answers "what is waiting"; this answers "what is the
 * standing" — every link with the *content fingerprint of each side*, plus the two lists the queue
 * structurally cannot show, because they are about rows that do not exist: published documents with
 * no link, and remote items with no link.
 */
run('stage 5 — parity report (design 4d)', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: FastifyInstance;
  let stub: WpStub;
  let connectorId: string;
  let linkedDocId: string;
  let cache: ReturnType<typeof createRemoteCache>;

  const linked = { id: 7, modified_gmt: '2026-06-12T10:00:00' };
  const orphanRemote = { id: 99, modified_gmt: '2026-06-12T11:00:00' };

  const wpPost = (id: number, title: string, modified: string) => ({
    id,
    title: { rendered: title },
    content: { rendered: '<h2>שלב 1</h2><p>פתח CRM</p>' },
    modified_gmt: modified,
    link: `http://wp/${id}`,
    status: 'publish',
  });

  beforeAll(async () => {
    db = await startTestDb();
    await db.pool.query("insert into users(subject, source, display_name) values ('parity','local','בודק')");
    stub = await startWpStub([
      wpPost(linked.id, 'איטיות גלישה', linked.modified_gmt),
      wpPost(orphanRemote.id, 'עמוד שאין לו מסמך', orphanRemote.modified_gmt),
    ]);
    const userId = (await db.pool.query("select id from users where subject='parity'")).rows[0].id;
    cache = createRemoteCache();
    app = await buildL6TestApp({
      pool: db.pool,
      databaseUrl: db.url,
      testUser: { id: userId, permissions: ['connectors.manage', 'sources.manage', 'suggestions.apply'] },
      revisions: memoryRevisions(),
      documents: sqlDocumentsService(db.pool),
      enqueue: async () => 'job-1',
      remoteCache: cache,
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors',
      payload: {
        type: 'wordpress',
        name: 'אתר תמיכה',
        config: {
          baseUrl: stub.url,
          username: 'kb',
          applicationPassword: 'pw',
          postTypes: ['posts'],
          // The connector declares which KB categories it owns; the unlinked-documents list is
          // scoped to exactly these, so it can never degenerate into "the whole library".
          categoryMap: { support: 'tech' },
          webhookSecret: 'topsecret1',
        },
      },
    });
    expect(created.statusCode).toBe(201);
    connectorId = created.json().id;
    ({ docId: linkedDocId } = await seedDocument(db.pool, connectorId, 'posts:' + linked.id));
    await app.connectors.sync.pushDocument(connectorId, linkedDocId, null);
  }, 180000);

  beforeEach(() => cache.clear());

  afterAll(async () => {
    await app?.close();
    await stub?.close();
    await db.stop();
  });

  const parity = async (query = '') => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/sync/parity' + query });
    expect(r.statusCode).toBe(200);
    return r.json().connectors[0];
  };

  it('reports both sides of every link: local hash, remote hash and the agreed baseline', async () => {
    const report = await parity(`?connectorId=${connectorId}`);
    expect(report).toMatchObject({ connectorId, connectorName: 'אתר תמיכה', remoteAvailable: true });
    const row = report.items.find((i: { documentId: string }) => i.documentId === linkedDocId);
    expect(row.localHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.remoteHash).toMatch(/^[0-9a-f]+$/);
    // The push established the baseline, so the remote has not moved since.
    expect(row.baseRemoteHash).toBe(row.remoteHash);
    expect(row.remoteChanged).toBe(false);
    expect(row.remoteUpdatedAt).not.toBeNull();
    expect(row.unlinkedReason).toBeUndefined();
  });

  it('notices the remote moving under a link', async () => {
    const before = (await parity(`?connectorId=${connectorId}`)).items[0];
    stub.posts.set('posts:' + linked.id, {
      ...wpPost(linked.id, 'איטיות גלישה', '2026-06-13T09:00:00'),
      content: { rendered: '<h2>שלב 1</h2><p>פתח CRM ובדוק את החיבור</p>' },
    });
    cache.clear();
    const after = (await parity(`?connectorId=${connectorId}`)).items[0];
    expect(after.remoteHash).not.toBe(before.remoteHash);
    expect(after.baseRemoteHash).toBe(before.baseRemoteHash);
    expect(after.remoteChanged).toBe(true);
    // The local side did not move, and the report must not pretend it did.
    expect(after.localHash).toBe(before.localHash);
  });

  it('lists remote items with no link, and published documents with no link', async () => {
    const orphanDoc = await db.pool.query(
      `insert into documents(slug, title, category, wave, priority, status, current_version)
       values ('orphan-doc','מסמך ללא קישור','tech',1,'hh','published',2) returning id`,
    );
    // A different category, and a draft in the right one: neither belongs in this connector's list.
    await db.pool.query(
      `insert into documents(slug, title, category, wave, priority, status, current_version)
       values ('other-cat','שייך לקטגוריה אחרת','billing',1,'hh','published',1),
              ('still-draft','טיוטה','tech',1,'hh','draft',0)`,
    );
    cache.clear();
    const report = await parity(`?connectorId=${connectorId}`);

    expect(report.unlinked.remote.map((r: { externalId: string }) => r.externalId)).toEqual([
      'posts:' + orphanRemote.id,
    ]);
    expect(report.unlinked.remote[0]).toMatchObject({ title: 'עמוד שאין לו מסמך', kind: 'posts' });

    const docs = report.unlinked.documents.map((d: { documentId: string }) => d.documentId);
    expect(docs).toContain(orphanDoc.rows[0].id);
    expect(docs).not.toContain(linkedDocId);
    expect(report.unlinked.documents.every((d: { category: string }) => d.category === 'tech')).toBe(true);
    expect(report.unlinked.documents.map((d: { title: string }) => d.title)).not.toContain('טיוטה');
  });

  it('separates "the item is gone" from "the connector is down"', async () => {
    const gone = stub.posts.get('posts:' + linked.id)!;
    stub.posts.delete('posts:' + linked.id);
    cache.clear();
    const missing = (await parity(`?connectorId=${connectorId}`)).items.find(
      (i: { documentId: string }) => i.documentId === linkedDocId,
    );
    expect(missing.remoteHash).toBeNull();
    expect(missing.unlinkedReason).toBe('remote_missing');
    stub.posts.set('posts:' + linked.id, gone);

    await stub.close();
    cache.clear();
    const down = await parity(`?connectorId=${connectorId}`);
    expect(down.remoteAvailable).toBe(false);
    expect(down.items[0].unlinkedReason).toBe('remote_unavailable');
    // An outage is not a mass deletion: nothing is reported as an orphan on either side.
    expect(down.unlinked.remote).toEqual([]);
    // The local side is still readable, which is the whole reason the row is still shown.
    expect(down.items[0].localHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('404s for an unknown connector rather than reporting an empty one', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/parity?connectorId=11111111-1111-4111-8111-111111111111',
    });
    expect(r.statusCode).toBe(404);
  });
});

run('stage 5 — POST /sync/links (the parity report\'s "קשר")', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: FastifyInstance;
  let stub: WpStub;
  let connectorId: string;
  let docId: string;

  beforeAll(async () => {
    db = await startTestDb();
    await db.pool.query("insert into users(subject, source, display_name) values ('linker','local','בודק')");
    stub = await startWpStub([]);
    const userId = (await db.pool.query("select id from users where subject='linker'")).rows[0].id;
    app = await buildL6TestApp({
      pool: db.pool,
      databaseUrl: db.url,
      testUser: { id: userId, permissions: ['connectors.manage', 'sources.manage'] },
      revisions: memoryRevisions(),
      documents: sqlDocumentsService(db.pool),
      enqueue: async () => 'job-1',
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors',
      payload: {
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
      },
    });
    connectorId = created.json().id;
    docId = (
      await db.pool.query(
        `insert into documents(slug, title, category, wave, priority, status, current_version)
         values ('to-link','מסמך לקישור','tech',1,'hh','published',3) returning id`,
      )
    ).rows[0].id;
  }, 180000);

  afterAll(async () => {
    await app?.close();
    await stub?.close();
    await db.stop();
  });

  it('creates the link unsynced, so the first run establishes the baseline', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/links',
      payload: { connectorId, documentId: docId, externalId: 'posts:42' },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      connectorId,
      documentId: docId,
      externalId: 'posts:42',
      state: 'pending_import',
      lastSyncedAt: null,
      currentLocalVersion: 3,
    });
    const row = (
      await db.pool.query('select base_remote_hash, last_synced_at from sync_links where id=$1', [
        r.json().id,
      ])
    ).rows[0];
    // Writing a baseline here would be a claim the two sides agree, which nothing has checked.
    expect(row.base_remote_hash).toBeNull();
    expect(row.last_synced_at).toBeNull();
  });

  it('refuses a second link for the same document or the same remote item', async () => {
    const sameRemote = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/links',
      payload: { connectorId, documentId: docId, externalId: 'posts:42' },
    });
    expect(sameRemote.statusCode).toBe(409);
    expect(sameRemote.json().code).toBe('ALREADY_LINKED');

    const otherDoc = (
      await db.pool.query(
        `insert into documents(slug, title, category, wave, priority, status, current_version)
         values ('other-doc','מסמך אחר','tech',1,'hh','published',1) returning id`,
      )
    ).rows[0].id;
    const takenRemote = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/links',
      payload: { connectorId, documentId: otherDoc, externalId: 'posts:42' },
    });
    expect(takenRemote.statusCode).toBe(409);
  });

  it('404s for a document or connector that does not exist', async () => {
    const missingDoc = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/links',
      payload: {
        connectorId,
        documentId: '11111111-1111-4111-8111-111111111111',
        externalId: 'posts:50',
      },
    });
    expect(missingDoc.statusCode).toBe(404);
    const missingConnector = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/links',
      payload: {
        connectorId: '11111111-1111-4111-8111-111111111111',
        documentId: docId,
        externalId: 'posts:51',
      },
    });
    expect(missingConnector.statusCode).toBe(404);
  });

  it('appears in the parity report as a link with no baseline', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/v1/sync/parity?connectorId=${connectorId}` });
    const row = r.json().connectors[0].items.find((i: { documentId: string }) => i.documentId === docId);
    expect(row).toMatchObject({ baseRemoteHash: null, lastSyncedAt: null, unlinkedReason: 'remote_missing' });
  });
});
