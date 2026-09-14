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
    // B-C1: the source routes now apply the §2.2 visibility rule as well as world scope, so a
    // `docs.read`-only reader may only see the source of a *published* item. The refusal on an
    // unpublished one is asserted in `test/int/scope-leak.test.ts`; here the document is
    // published so these cases stay about the source surface itself.
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/publish`,
      headers: auth(editor),
      payload: { label: 'v1' },
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
    // B-I3: `If-Match` is required once a source document exists, so an omitted header is a
    // 428 rather than a silent overwrite of whatever is there.
    const noPrecondition = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/source`,
      headers: auth(editor),
      payload: { html: '<p>גרסה 3</p>' },
    });
    expect(noPrecondition.statusCode).toBe(428);
    expect(noPrecondition.json().code).toBe('IF_MATCH_REQUIRED');
    const cur = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${docId}/source`,
      headers: auth(editor),
    });
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/source`,
      headers: { ...auth(editor), 'if-match': cur.json().etag as string },
      payload: { html: '<p>גרסה 3</p>' },
    });
    expect(saved.statusCode).toBe(200);
    // A stale etag is still a 412, not a lost update.
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/v1/documents/${docId}/source`,
          headers: { ...auth(editor), 'if-match': cur.json().etag as string },
          payload: { html: '<p>גרסה 4</p>' },
        })
      ).statusCode,
    ).toBe(412);
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

    /**
     * B-M14 — the allowlist above only ever checked the *declared* mime. `imageSize` then parsed
     * the bytes as if the label were true, so a PDF called `image/png` was stored with garbage
     * dimensions and the docx exporter sized a broken box around them.
     */
    const mislabelled = await post(Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n'), 'image/png');
    expect(mislabelled.statusCode, mislabelled.body).toBe(415);
    expect(mislabelled.json().code).toBe('ASSET_MIME_MISMATCH');
    // An image of an allowed type, called another allowed type, is a mismatch too — that is the
    // pair that reaches `imageSize` and reads real bytes with the wrong parser.
    const swapped = await post(png, 'image/jpeg');
    expect(swapped.statusCode, swapped.body).toBe(415);
    expect(swapped.json().code).toBe('ASSET_MIME_MISMATCH');
    // Nothing was stored for either.
    expect(
      (await db.pool.query(`select count(*)::int n from assets where mime='image/jpeg'`)).rows[0].n,
    ).toBe(0);
  });

  it('B-M14: every allowed format is recognised from its header, and nothing else is', async () => {
    const { sniffImageMime } = await import('../src/modules/sourcedocs/assets.js');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const webp = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.alloc(4),
      Buffer.from('WEBPVP8L', 'ascii'),
    ]);
    expect(sniffImageMime(png)).toBe('image/png');
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageMime(Buffer.from('GIF89a....', 'ascii'))).toBe('image/gif');
    expect(sniffImageMime(Buffer.from('GIF87a....', 'ascii'))).toBe('image/gif');
    expect(sniffImageMime(webp)).toBe('image/webp');
    // SVG is the one the allowlist names explicitly, and it has no magic bytes at all.
    expect(sniffImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImageMime(Buffer.from('PK'))).toBeNull();
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
    // A truncated header is not a match: `starts` is length-checked, not read past the end.
    expect(sniffImageMime(png.subarray(0, 4))).toBeNull();
    expect(sniffImageMime(Buffer.from('RIFF', 'ascii'))).toBeNull();
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

  /**
   * B-M10 — a historical version used to be served with the *live* etag, so the history pane's
   * edit path could save on top of a newer version and pass `If-Match`. Each version now carries
   * the etag that was current while it was.
   */
  it('a version is served with its own etag, and saving against an old one is a 412', async () => {
    const at = async (v: number) =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/documents/${docId}/source/versions/${v}`,
          headers: auth(editor),
        })
      ).json();
    const live = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/source`, headers: auth(editor) })
    ).json();
    const current = await at(live.version);
    const first = await at(1);

    // The current version and the live document are the same thing, so they share an etag…
    expect(current.etag).toBe(live.etag);
    // …and every earlier version has one of its own.
    expect(first.etag).not.toBe(live.etag);
    expect(typeof first.etag).toBe('string');
    expect(first.etag.length).toBeGreaterThan(0);
    const all = (
      await db.pool.query<{ etag: string }>(
        `select v.etag from source_document_versions v join source_documents s on s.id=v.source_document_id
          where s.document_id=$1`,
        [docId],
      )
    ).rows.map((x) => x.etag);
    expect(new Set(all).size).toBe(all.length);

    const stale = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/source`,
      headers: { ...auth(editor), 'if-match': first.etag as string },
      payload: { html: '<p>עריכה על גרסה ישנה</p>' },
    });
    expect(stale.statusCode, stale.body).toBe(412);
    expect(stale.json().code).toBe('ETAG_MISMATCH');
    // Nothing was written: the newer text is still there.
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/documents/${docId}/source`,
          headers: auth(editor),
        })
      ).json(),
    ).toMatchObject({ html: live.html, version: live.version, etag: live.etag });

    // The current version's etag still saves, which is what keeps the history pane usable.
    const ok = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/source`,
      headers: { ...auth(editor), 'if-match': current.etag as string },
      payload: { html: '<p>עריכה על הגרסה הנוכחית</p>' },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().version).toBe(live.version + 1);
    expect(ok.json().etag).not.toBe(live.etag);
    // The version that was current keeps the etag it had; the new one takes the live value.
    expect((await at(live.version)).etag).toBe(live.etag);
    expect((await at(live.version + 1)).etag).toBe(ok.json().etag);
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

  /**
   * B-I2 — §5.1 autosaves in-progress source HTML into `drafts` every 3 s, and images are
   * uploaded the moment they are pasted, long before "שמור גרסה" writes a version. The gc was
   * guarded against versions and `body_html` but not against drafts, so an editor who pasted
   * screenshots and saved the version a week later lost them to the Sunday run — permanently,
   * since `assets` is the only copy.
   */
  it('B-I2: gc keeps an asset that only an autosave draft references', async () => {
    const { gcUnreferencedAssets } = await import('../src/modules/sourcedocs/assets.js');
    const a = await db.pool.query(
      `insert into assets(mime, bytes, sha256, size, created_at)
       values ('image/png', '\\x00', 'in-a-draft', 1, now() - interval '2 days') returning id`,
    );
    const assetId = a.rows[0].id as string;
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/source/draft`,
      headers: auth(editor),
      payload: { html: `<p><img src="/api/v1/assets/${assetId}"></p>` },
    });
    expect(put.statusCode).toBe(204);
    await gcUnreferencedAssets(db.pool);
    expect((await db.pool.query('select 1 from assets where id=$1', [assetId])).rowCount).toBe(1);

    // …and once the draft is gone it is collectable again, so this is a reference and not a
    // blanket exemption.
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${docId}/source/draft`,
      headers: auth(editor),
    });
    await gcUnreferencedAssets(db.pool);
    expect((await db.pool.query('select 1 from assets where id=$1', [assetId])).rowCount).toBe(0);
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

  /**
   * B-M10's backfill, run against rows that predate the column: the version that is current
   * inherits the live etag (so an editor mid-edit is not bounced), and every older row gets a
   * value derived from its own version and body — distinct even when a restore made two versions
   * share their html.
   */
  it('backfill: the current version inherits the live etag, older ones get a per-version hash', async () => {
    const { readFileSync } = await import('node:fs');
    const backfill = [...readFileSync('migrations/0037_source_version_etag.js', 'utf8').matchAll(
      /pgm\.sql\(`([\s\S]*?)`\)/g,
    )].map((m) => m[1]);
    expect(backfill).toHaveLength(2);

    const sd = await db.pool.query<{ id: string; etag: string; current_version: number }>(
      'select id, etag, current_version from source_documents where document_id=$1',
      [docId],
    );
    const { id, etag: live, current_version: current } = sd.rows[0];
    // Put the table back in the state the migration finds it in: the column present but empty.
    await db.pool.query('alter table source_document_versions alter column etag drop not null');
    await db.pool.query('update source_document_versions set etag=null where source_document_id=$1', [id]);
    for (const sql of backfill) await db.pool.query(sql);
    await db.pool.query('alter table source_document_versions alter column etag set not null');

    const rows = (
      await db.pool.query<{ version: number; etag: string; expected: string }>(
        `select version, etag, md5(version::text || ':' || html) expected
           from source_document_versions where source_document_id=$1 order by version`,
        [id],
      )
    ).rows;
    expect(rows.length).toBeGreaterThan(1);
    for (const v of rows) expect(v.etag, `v${v.version}`).toBe(v.version === current ? live : v.expected);
    expect(new Set(rows.map((v) => v.etag)).size).toBe(rows.length);
  });
});
