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
    const revs = await db.pool.query('select count(*)::int n from source_revisions where source_id=$1', [
      src.rows[0].source_id,
    ]);
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

  it('imports a docx and exports it back with the heading present', async () => {
    const { buildDocx } = await import('./sources/fixtures/docx-builder.js');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const docx = await buildDocx({
      paragraphs: [
        { style: 'Heading1', runs: [{ t: 'נוהל מיובא' }] },
        { table: [['א', 'ב']] },
        { image: { png } },
      ],
    });
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', docx, {
      filename: 'n.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const imp = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/source/import`,
      headers: { ...auth(editor), ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(imp.statusCode).toBe(200);
    expect(imp.json().html).toContain('<h1>נוהל מיובא</h1>');
    expect(imp.json().html).toMatch(/<img src="\/api\/v1\/assets\/[0-9a-f-]{36}"/);
    const exp = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${docId}/source/export.docx`,
      headers: auth(reader),
    });
    expect(exp.statusCode).toBe(200);
    expect(exp.headers['content-type']).toContain('wordprocessingml');
    const JSZip = (await import('jszip')).default;
    const xml = await (await JSZip.loadAsync(exp.rawPayload)).file('word/document.xml')!.async('string');
    expect(xml).toContain('נוהל מיובא');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:drawing>');
  });

  it('assets: 415 for a mime outside ASSET_MIMES, 413 oversize, dedupes by sha256, serves immutable bytes', async () => {
    const FormData = (await import('form-data')).default;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const post = async (buf: Buffer, type: string) => {
      const f = new FormData();
      f.append('file', buf, { filename: 'x', contentType: type });
      return app.inject({
        method: 'POST',
        url: '/api/v1/assets',
        headers: { ...auth(editor), ...f.getHeaders() },
        payload: f.getBuffer(),
      });
    };
    expect((await post(Buffer.from('<svg/>'), 'image/svg+xml')).statusCode).toBe(415);
    expect((await post(Buffer.alloc(10 * 1024 * 1024 + 1), 'image/png')).statusCode).toBe(413);
    const a = await post(png, 'image/png');
    const b = await post(png, 'image/png');
    expect(a.statusCode).toBe(200);
    expect(b.json().id).toBe(a.json().id);
    expect(a.json()).toMatchObject({ mime: 'image/png', width: 1, height: 1 });
    const get = await app.inject({ method: 'GET', url: a.json().url, headers: auth(reader) });
    expect(get.statusCode).toBe(200);
    expect(get.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(Buffer.from(get.rawPayload).equals(png)).toBe(true);
    expect(
      (
        await post(png, 'image/png').then(() =>
          app.inject({ method: 'POST', url: '/api/v1/assets', headers: auth(reader), payload: {} }),
        )
      ).statusCode,
    ).toBe(403);
  });

  it('serves the raw upload of a revision', async () => {
    const src = (await db.pool.query('select source_id from documents where id=$1', [docId])).rows[0]
      .source_id;
    const rev = (
      await db.pool.query(
        'select id from source_revisions where source_id=$1 order by imported_at desc limit 1',
        [src],
      )
    ).rows[0].id;
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${src}/revisions/${rev}/raw`,
      headers: auth(reader),
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-disposition']).toContain('attachment');
    expect(r.body).toContain('<h1>נוהל מיובא</h1>');
  });

  it('marks the document for source review when W2 is present', async () => {
    const col = await db.pool.query(
      "select 1 from information_schema.columns where table_name='documents' and column_name='source_review_needed'",
    );
    if (!col.rowCount) return; // W2 not merged yet
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/source`,
      headers: auth(editor),
      payload: { html: '<p>שינוי נוסף</p>' },
    });
    const r = await db.pool.query('select source_review_needed from documents where id=$1', [docId]);
    expect(r.rows[0].source_review_needed).toBe(true);
  });

  it('restores an older source version as a new version', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/source/restore/1`,
      headers: auth(editor),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().html).toBe('<h2>שלב 1</h2><p>פתח CRM</p>');
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${docId}/source/versions`,
      headers: auth(reader),
    });
    expect(list.json().items[0].label).toBe('שוחזר מגרסה 1');
  });

  it('gc deletes only unreferenced assets older than a day', async () => {
    const { gcUnreferencedAssets } = await import('../src/modules/sourcedocs/assets.js');
    await db.pool.query(
      `insert into assets(mime, bytes, sha256, size, created_at) values ('image/png', '\\x00', 'orphan', 1, now() - interval '2 days')`,
    );
    const before = (await db.pool.query('select count(*)::int n from assets')).rows[0].n;
    const n = await gcUnreferencedAssets(db.pool);
    expect(n).toBe(1);
    expect((await db.pool.query('select count(*)::int n from assets')).rows[0].n).toBe(before - 1);
  });

  it('backfill: a document with an accepted docx revision gets a source document on migration', async () => {
    const s = await db.pool.query(`insert into sources(kind, title) values ('docx','נוהל ישן') returning id`);
    const d = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: auth(editor),
      payload: {
        title: 'ישן',
        description: '',
        category: 'tech',
        wave: 1,
        priority: 'm',
        kind: 'steps',
      },
    });
    await db.pool.query('update documents set source_id=$2 where id=$1', [d.json().id, s.rows[0].id]);
    await db.pool.query(
      `insert into source_revisions(source_id, hash, paragraphs, accepted) values ($1,'h',$2,true)`,
      [
        s.rows[0].id,
        JSON.stringify([
          { ref: '1', heading: 'כותרת', level: 2, runs: [{ t: 'כותרת' }] },
          { ref: '1.1', runs: [{ t: 'גוף' }] },
        ]),
      ],
    );
    // Re-running the migration's up() through a pgm shim is heavier than it is worth; assert the
    // backfill SQL the migration ships produces the expected HTML for this row.
    const { readFileSync } = await import('node:fs');
    const sql = /pgm\.sql\(`([\s\S]*?)`\)/.exec(
      readFileSync('migrations/0033_source_documents.js', 'utf8'),
    )![1];
    await db.pool.query(sql.replace(/\\\\n/g, '\\n'));
    const r = await db.pool.query('select html from source_documents where document_id=$1', [d.json().id]);
    expect(r.rows[0].html).toBe('<h2>כותרת</h2><p>גוף</p>');
  });
});
