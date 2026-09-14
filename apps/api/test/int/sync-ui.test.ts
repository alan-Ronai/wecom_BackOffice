import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestDb, integration } from '../helpers/db.js';
import { startWpStub, type WpStub } from '../../../../packages/connectors/test/helpers/wpStub.js';
import { buildL6TestApp } from '../helpers/l6/testApp.js';
import { memoryRevisions, seedDocument, sqlDocumentsService } from '../helpers/l6/seedDoc.js';

const run = integration ? describe : describe.skip;

run('stage 5 — connectors & sync UI', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: FastifyInstance;
  let stub: WpStub;
  let connectorId: string;
  let docId: string;
  let linkId: string;

  const post = { id: 7, modified_gmt: '2025-06-12T10:00:00' };

  beforeAll(async () => {
    db = await startTestDb();
    await db.pool.query(
      "insert into users(subject, source, display_name) values ('sync-ui', 'local', 'בודק')",
    );
    stub = await startWpStub([
      {
        id: post.id,
        title: { rendered: 'איטיות גלישה' },
        content: { rendered: '<h2>שלב 1</h2><p>פתח CRM</p>' },
        modified_gmt: post.modified_gmt,
        link: 'http://wp/7',
        status: 'publish',
      },
    ]);
    const userId = (await db.pool.query("select id from users where subject='sync-ui'")).rows[0].id;
    app = await buildL6TestApp({
      pool: db.pool,
      databaseUrl: db.url,
      testUser: {
        id: userId,
        // `docs.read` is what `GET /documents/:id/sync-state` asks for — the point of that route
        // is that it does *not* need `sources.manage` like the queue does.
        permissions: ['connectors.manage', 'sources.manage', 'suggestions.apply', 'docs.read'],
      },
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
    expect(created.statusCode).toBe(201);
    connectorId = created.json().id;
    ({ docId } = await seedDocument(db.pool, connectorId, 'posts:' + post.id));
    // Establish the baseline the way a first run does: local v1 pushed → synced.
    await app.connectors.sync.pushDocument(connectorId, docId, null);
    linkId = (await db.pool.query('select id from sync_links where connector_id=$1', [connectorId])).rows[0]
      .id;
  }, 180000);

  afterAll(async () => {
    await app?.close();
    await stub?.close();
    await db.stop();
  });

  it('describes the registered connector types, secrets marked as such', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/connectors/types' });
    expect(r.statusCode).toBe(200);
    const wp = r.json().items.find((t: { id: string }) => t.id === 'wordpress');
    expect(wp).toMatchObject({ name: 'WordPress', capabilities: { read: true, write: true } });
    expect(wp.configSchema.required).toContain('baseUrl');
    expect(wp.configSchema.fields.applicationPassword.secret).toBe(true);
    expect(wp.configSchema.fields.baseUrl.secret).toBe(false);
    // A field with a default is optional and its default is safe to show.
    expect(wp.configSchema.fields.postTypes).toMatchObject({ optional: true, default: ['posts'] });
    expect(r.json().items.map((t: { id: string }) => t.id)).toContain('json');
  });

  it('lists connectors with masked config and the link and conflict counts', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/connectors' });
    expect(r.statusCode).toBe(200);
    const row = r.json().items[0];
    expect(row).toMatchObject({ type: 'wordpress', name: 'אתר תמיכה', links: 1, conflicts: 0 });
    expect(row.config.applicationPassword).toBe('••••');
    expect(row.config.webhookSecret).toBe('••••');
    expect(row.config.baseUrl).toBe(stub.url);
    expect(['ok', 'error', 'never']).toContain(row.lastStatus);
  });

  it('the sync queue reports whole-queue counts alongside the filtered page', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/sync/links' });
    expect(r.statusCode).toBe(200);
    expect(r.json().counts).toEqual({ synced: 1, pendingImport: 0, pendingPush: 0, conflict: 0 });
    expect(r.json().total).toBe(1);
    const link = r.json().items[0];
    expect(link).toMatchObject({
      connectorName: 'אתר תמיכה',
      title: 'איטיות גלישה',
      externalId: 'posts:' + post.id,
      state: 'synced',
      remoteChanged: false,
      localChanged: false,
    });
    expect(link.currentLocalVersion).toBe(1);

    // A filter narrows the page but not the counts the chips render.
    const filtered = await app.inject({ method: 'GET', url: '/api/v1/sync/links?state=conflict' });
    expect(filtered.json().total).toBe(0);
    expect(filtered.json().counts.synced).toBe(1);
    const byText = await app.inject({ method: 'GET', url: '/api/v1/sync/links?q=איטיות' });
    expect(byText.json().total).toBe(1);
  });

  /**
   * The article header's badge. The queue above answers the same question but needs
   * `sources.manage`; an editor reading an article holds `docs.read`, which is why the article
   * could not say "this is waiting to be pushed" at all.
   */
  it('one document reports its own sync state, most urgent link first', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/sync-state` });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      documentId: docId,
      overall: 'synced',
      flagReason: null,
      links: [{ linkId, state: 'synced', connectorName: 'אתר תמיכה', connectorType: 'wordpress' }],
    });

    // A conflict outranks everything else, whichever link carries it.
    await db.pool.query("update sync_links set state='conflict' where id=$1", [linkId]);
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/sync-state` })).json(),
    ).toMatchObject({ overall: 'conflict', flagReason: expect.stringContaining('קונפליקט') });
    await db.pool.query("update sync_links set state='pending_push' where id=$1", [linkId]);
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/sync-state` })).json(),
    ).toMatchObject({ overall: 'pending_push', flagReason: expect.stringContaining('ממתין לדחיפה') });
    await db.pool.query("update sync_links set state='synced' where id=$1", [linkId]);

    // Not connected is `'unlinked'`, which is not the same answer as "in sync".
    const other = (
      await db.pool.query<{ id: string }>(
        `insert into documents(slug, title, category, wave, priority, kind, status)
         values ('no-connector','ללא מחבר','tech',1,'m','steps','published') returning id`,
      )
    ).rows[0].id;
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/documents/${other}/sync-state` })).json(),
    ).toEqual({ documentId: other, overall: 'unlinked', flagReason: null, links: [] });
  });

  it('no conflict yet → the conflict view is a 404, not an empty three-way', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/v1/sync/links/${linkId}/conflict` });
    expect(r.statusCode).toBe(404);
  });

  it('both sides moved → conflict view, then resolve with merged phases', async () => {
    // Remote edit…
    stub.posts.get('posts:' + post.id)!.content.rendered = '<h2>שלב 1</h2><p>פתח CRM ↗ שדה חדש</p>';
    stub.posts.get('posts:' + post.id)!.modified_gmt = '2025-07-01T00:00:00';
    // …and a local one.
    await db.pool.query('update documents set current_version=2 where id=$1', [docId]);
    await db.pool.query(
      'insert into document_versions(document_id, version, snapshot, label) values ($1,2,$2,$3)',
      [
        docId,
        {
          id: docId,
          currentVersion: 2,
          phases: [{ id: 'p1', label: 'שלב 1', steps: [] }],
        },
        'local edit',
      ],
    );
    const result = await app.connectors.sync.runConnector(connectorId, null);
    expect(result.conflicts).toBe(1);

    const queue = await app.inject({ method: 'GET', url: '/api/v1/sync/links' });
    expect(queue.json().counts).toMatchObject({ conflict: 1, synced: 0 });
    expect(queue.json().items[0]).toMatchObject({
      state: 'conflict',
      remoteChanged: true,
      localChanged: true,
      baseLocalVersion: 1,
      currentLocalVersion: 2,
    });

    const view = await app.inject({ method: 'GET', url: `/api/v1/sync/links/${linkId}/conflict` });
    expect(view.statusCode).toBe(200);
    const v = view.json();
    expect(v.link.state).toBe('conflict');
    expect(v.base.version).toBe(1);
    expect(v.ours.version).toBe(2);
    expect(v.theirs.hash).toBeTruthy();
    expect(v.theirs.paragraphs.length).toBeGreaterThan(0);
    // Remote paragraphs arrive as flat text the reviewer can read side by side.
    expect(v.theirs.paragraphs.map((p: { text: string }) => p.text).join(' ')).toContain('שדה חדש');

    const merged = {
      resolution: 'merged',
      label: 'מיזוג ידני לאחר בדיקה',
      merged: {
        phases: [
          {
            id: 'p1',
            label: 'שלב 1',
            steps: [
              {
                key: 's1',
                num: '1',
                title: 'פתח CRM ↗ שדה חדש',
                blockRefs: [],
                deps: [],
                actions: [{ id: 'a1', text: 'פתח CRM ↗ שדה חדש' }],
                outcomes: [],
              },
            ],
          },
        ],
      },
    };
    const resolved = await app.inject({
      method: 'POST',
      url: `/api/v1/sync/links/${linkId}/resolve`,
      payload: merged,
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({ state: 'synced', id: linkId });
    // The merge became a version carrying the reviewer's own label, and the remote was pushed.
    const versions = await db.pool.query(
      'select label from document_versions where document_id=$1 order by version desc limit 1',
      [docId],
    );
    expect(versions.rows[0].label).toBe('מיזוג ידני לאחר בדיקה');
    expect(stub.puts.at(-1)).toMatchObject({ id: post.id });
    expect((await app.inject({ method: 'GET', url: '/api/v1/sync/links' })).json().counts.conflict).toBe(0);
    // (The trail itself is written through L3's `app.audit`, which this L6 harness
    // deliberately does not decorate; `wiring.test.ts` covers the real-app path.)
  });

  it('a merged resolution without a merge is a 400', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/sync/links/${linkId}/resolve`,
      payload: { resolution: 'merged' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('MERGE_REQUIRED');
  });

  it('run now answers with what the run did', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/connectors/${connectorId}/run` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ conflicts: 0, errors: [] });
    expect(typeof r.json().imported).toBe('number');
  });
});
