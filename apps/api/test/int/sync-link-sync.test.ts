import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestDb, integration } from '../helpers/db.js';
import { startWpStub, type WpStub } from '../../../../packages/connectors/test/helpers/wpStub.js';
import { buildL6TestApp } from '../helpers/l6/testApp.js';
import { memoryRevisions, seedDocument, sqlDocumentsService } from '../helpers/l6/seedDoc.js';

const run = integration ? describe : describe.skip;

/**
 * Stage-5 contract: `POST /sync/links/:id/sync` — the per-row "ייבא עכשיו" / "דחוף עכשיו".
 * One link, one direction, synchronous; both changed → 409 with the link row rather than
 * either side winning silently.
 */
run('POST /sync/links/:id/sync', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: FastifyInstance;
  let stub: WpStub;
  let connectorId: string;
  const revisions = memoryRevisions();
  let importLink: { id: string; docId: string };
  let pushLink: { id: string; docId: string };
  let conflictLink: { id: string; docId: string };

  const seedLink = async (postId: number) => {
    const { docId } = await seedDocument(db.pool, connectorId, `posts:${postId}`);
    await app.connectors.sync.pushDocument(connectorId, docId, null);
    const id = (
      await db.pool.query('select id from sync_links where connector_id=$1 and document_id=$2', [
        connectorId,
        docId,
      ])
    ).rows[0].id as string;
    return { id, docId };
  };

  beforeAll(async () => {
    db = await startTestDb();
    await db.pool.query(
      "insert into users(subject, source, display_name) values ('sync-link', 'local', 'בודק')",
    );
    const userId = (await db.pool.query("select id from users where subject='sync-link'")).rows[0].id;
    const post = (id: number) => ({
      id,
      title: { rendered: 'איטיות גלישה' },
      content: { rendered: '<h2>שלב 1</h2><p>פתח CRM</p>' },
      modified_gmt: '2025-06-12T10:00:00',
      link: `http://wp/${id}`,
      status: 'publish',
    });
    stub = await startWpStub([post(101), post(102), post(103)]);
    app = await buildL6TestApp({
      pool: db.pool,
      databaseUrl: db.url,
      testUser: { id: userId, permissions: ['connectors.manage', 'sources.manage', 'docs.publish'] },
      revisions,
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
    expect(created.statusCode).toBe(201);
    connectorId = created.json().id;
    importLink = await seedLink(101);
    pushLink = await seedLink(102);
    conflictLink = await seedLink(103);
  }, 180000);

  afterAll(async () => {
    await app?.close();
    await stub?.close();
    await db.stop();
  });

  it('404s for an unknown link', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/links/00000000-0000-0000-0000-000000000000/sync',
      payload: { direction: 'import' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('requires sources.manage for import and docs.publish for push', async () => {
    const noPerm = await buildL6TestApp({
      pool: db.pool,
      databaseUrl: db.url,
      testUser: {
        id: (await db.pool.query("select id from users where subject='sync-link'")).rows[0].id,
        permissions: ['connectors.manage'],
      },
      revisions,
      documents: sqlDocumentsService(db.pool),
    });
    const imp = await noPerm.inject({
      method: 'POST',
      url: `/api/v1/sync/links/${importLink.id}/sync`,
      payload: { direction: 'import' },
    });
    expect(imp.statusCode).toBe(403);
    expect(imp.json().details).toMatchObject({ permission: 'sources.manage' });
    const push = await noPerm.inject({
      method: 'POST',
      url: `/api/v1/sync/links/${importLink.id}/sync`,
      payload: { direction: 'push' },
    });
    expect(push.statusCode).toBe(403);
    expect(push.json().details).toMatchObject({ permission: 'docs.publish' });
    await noPerm.close();
  });

  it('imports a remote-only change into the source, without touching the other links', async () => {
    stub.posts.get('posts:101')!.content.rendered = '<h2>שלב 1</h2><p>פתח CRM ↗ שדה חדש</p>';
    stub.posts.get('posts:101')!.modified_gmt = '2025-07-01T00:00:00';
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/sync/links/${importLink.id}/sync`,
      payload: { direction: 'import' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ imported: 1, pushed: 0, conflicts: 0, errors: [] });
    const row = (await db.pool.query('select state from sync_links where id=$1', [importLink.id])).rows[0];
    expect(row.state).toBe('pending_import');
    expect(revisions.calls).toHaveLength(1);

    // Idempotent: with no local change and a direction that does not act on the
    // (still) remote-changed baseline, syncing again does no work.
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/sync/links/${importLink.id}/sync`,
      payload: { direction: 'push' },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ imported: 0, pushed: 0, conflicts: 0 });
    expect(revisions.calls).toHaveLength(1);
  });

  it('pushes a local-only change to the remote', async () => {
    await db.pool.query('update documents set current_version=2, title=$2 where id=$1', [
      pushLink.docId,
      'איטיות גלישה (מעודכן)',
    ]);
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/sync/links/${pushLink.id}/sync`,
      payload: { direction: 'push' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ imported: 0, pushed: 1, conflicts: 0, errors: [] });
    expect(stub.posts.get('posts:102')!.title.rendered).toBe('איטיות גלישה (מעודכן)');
    const row = (
      await db.pool.query('select state, base_local_version from sync_links where id=$1', [pushLink.id])
    ).rows[0];
    expect(row).toMatchObject({ state: 'synced', base_local_version: 2 });
  });

  it('both sides changed → 409 CONFLICT with the link row, and neither side is overwritten', async () => {
    stub.posts.get('posts:103')!.content.rendered = '<h2>שלב 1</h2><p>שינוי מרחוק</p>';
    stub.posts.get('posts:103')!.modified_gmt = '2025-07-01T00:00:00';
    await db.pool.query('update documents set current_version=2 where id=$1', [conflictLink.docId]);
    const before = stub.posts.get('posts:103')!.title.rendered;
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/sync/links/${conflictLink.id}/sync`,
      payload: { direction: 'import' },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('CONFLICT');
    expect(r.json().details).toMatchObject({ id: conflictLink.id, state: 'conflict' });
    // Neither an import nor a push happened: the remote post is untouched…
    expect(stub.posts.get('posts:103')!.title.rendered).toBe(before);
    // …and the link now carries an open conflict, visible through the existing view.
    const view = await app.inject({
      method: 'GET',
      url: `/api/v1/sync/links/${conflictLink.id}/conflict`,
    });
    expect(view.statusCode).toBe(200);
    expect(view.json().link.state).toBe('conflict');

    // Pushing instead is refused the same way — the rule is direction-independent.
    const pushAttempt = await app.inject({
      method: 'POST',
      url: `/api/v1/sync/links/${conflictLink.id}/sync`,
      payload: { direction: 'push' },
    });
    expect(pushAttempt.statusCode).toBe(409);
  });
});
