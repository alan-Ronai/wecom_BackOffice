import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth, minimalStructure } from './helpers/fixtures.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;

run('source documents', () => {
  let db: TestDb;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let editor: Awaited<ReturnType<typeof makeUser>>;
  let reader: Awaited<ReturnType<typeof makeUser>>;
  let docId: string;

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.ready();
    editor = await makeUser(db.pool, { name: 'עורכת' });
    reader = await makeUser(db.pool, { name: 'נציג', perms: ['docs.read'] });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: auth(editor),
      payload: {
        title: 'נוהל בדיקה',
        description: '',
        category: 'tech',
        wave: 1,
        priority: 'm',
        kind: 'steps',
      },
    });
    docId = created.json().id;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/structure`,
      headers: { ...auth(editor), 'if-match': created.json().etag },
      payload: minimalStructure,
    });
  }, 120000);
  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('answers 204 before any source exists', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${docId}/source`,
      headers: auth(reader),
    });
    expect(r.statusCode).toBe(204);
  });

  it('PUT sanitizes, versions, rotates the etag and ingests a revision', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/source`,
      headers: auth(editor),
      payload: {
        html: '<h2>שלב 1</h2><p onclick="x()">פתח CRM<script>1</script></p>',
        label: 'טיוטה ראשונה',
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.html).toBe('<h2>שלב 1</h2><p>פתח CRM</p>');
    expect(body.text).toBe('שלב 1\nפתח CRM');
    expect(body.version).toBe(1);
    expect(r.headers.etag).toBe(body.etag);
    const src = await db.pool.query('select source_id from documents where id=$1', [docId]);
    expect(src.rows[0].source_id).toBeTruthy();
    const kind = await db.pool.query('select kind, external_id from sources where id=$1', [
      src.rows[0].source_id,
    ]);
    expect(kind.rows[0]).toEqual({ kind: 'text', external_id: 'sourcedoc:' + docId });
    const revs = await db.pool.query(
      'select count(*)::int n from source_revisions where source_id=$1',
      [src.rows[0].source_id],
    );
    expect(revs.rows[0].n).toBe(1);
    const vers = await db.pool.query(
      'select version, label from source_document_versions v join source_documents s on s.id=v.source_document_id where s.document_id=$1',
      [docId],
    );
    expect(vers.rows).toEqual([{ version: 1, label: 'טיוטה ראשונה' }]);
  });

  it('412 on a stale If-Match, 200 on the current one', async () => {
    const cur = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${docId}/source`,
        headers: auth(editor),
      })
    ).json();
    const stale = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/source`,
      headers: { ...auth(editor), 'if-match': 'nope' },
      payload: { html: '<p>x</p>' },
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.json().code).toBe('ETAG_MISMATCH');
    const ok = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/source`,
      headers: { ...auth(editor), 'if-match': cur.etag },
      payload: { html: '<p>גרסה 2</p>' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().version).toBe(2);
    const reader403 = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/source`,
      headers: auth(reader),
      payload: { html: '<p>x</p>' },
    });
    expect(reader403.statusCode).toBe(403);
  });

  it('source draft: 204 when none, PUT stores per user under source:<id>, DELETE clears, and a version save clears it', async () => {
    const none = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${docId}/source/draft`,
      headers: auth(editor),
    });
    expect(none.statusCode).toBe(204);
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/source/draft`,
      headers: auth(editor),
      payload: { html: '<p>טיוטה</p>' },
    });
    expect(put.statusCode).toBe(204);
    const got = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${docId}/source/draft`,
      headers: auth(editor),
    });
    expect(got.statusCode).toBe(200);
    expect(got.json().html).toBe('<p>טיוטה</p>');
    expect(typeof got.json().updatedAt).toBe('string');
    const row = await db.pool.query(
      'select document_id, draft_key from drafts where user_id=$1 and draft_key=$2',
      [editor.id, 'source:' + docId],
    );
    expect(row.rows[0]).toEqual({ document_id: docId, draft_key: 'source:' + docId });
    // the step editor's own draft for the same document is untouched
    const stepDraft = await db.pool.query(
      'select count(*)::int n from drafts where user_id=$1 and draft_key=$2',
      [editor.id, docId],
    );
    expect(stepDraft.rows[0].n).toBe(0);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/documents/${docId}/source/draft`,
          headers: auth(reader),
        })
      ).statusCode,
    ).toBe(403);
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/source`,
      headers: auth(editor),
      payload: { html: '<p>גרסה 3</p>' },
    });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/documents/${docId}/source/draft`,
          headers: auth(editor),
        })
      ).statusCode,
    ).toBe(204);
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/source/draft`,
      headers: auth(editor),
      payload: { html: '<p>x</p>' },
    });
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/documents/${docId}/source/draft`,
          headers: auth(editor),
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/documents/${docId}/source/draft`,
          headers: auth(editor),
        })
      ).statusCode,
    ).toBe(204);
  });
});
