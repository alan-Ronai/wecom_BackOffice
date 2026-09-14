import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import FormData from 'form-data';
import type { NotifyInput } from '@wecom/shared';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth, minimalStructure } from './helpers/fixtures.js';
import { markSourceReviewNeeded, documentsForSource } from '../src/modules/documents/sourceReview.js';
import { withTransaction } from '../src/lib/sql.js';

const run = integration ? describe : describe.skip;

run('source review flag', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let editor: Awaited<ReturnType<typeof makeUser>>;
  const sent: NotifyInput[] = [];

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    // W0's holder delegates, so swapping the implementation is seen by every module.
    app.notifier.swap({
      notify: async (n) => {
        sent.push(n);
      },
    });
    editor = await makeUser(db.pool, { name: 'עורך' });
  }, 180000);
  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  /**
   * Ingests through the real HTTP path, so the `onIngested` hook wired in
   * `modules/sources/index.ts` is what raises the flag — not a hand-built service.
   */
  const upload = async (filename: string, text: string, sourceId?: string) => {
    const fd = new FormData();
    fd.append('file', Buffer.from(text, 'utf8'), { filename, contentType: 'text/markdown' });
    if (sourceId) fd.append('sourceId', sourceId);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/sources/upload',
      payload: fd.getBuffer(),
      headers: { ...fd.getHeaders(), ...auth(editor) },
    });
    expect(r.statusCode).toBe(200);
    return r.json() as { sourceId: string; revisionId: string; duplicate: boolean };
  };

  const createLinked = async (sourceId: string, ownerId: string) => {
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(editor),
        payload: { title: 'מקושר למקור', category: 'tech', wave: 1, priority: 'h', kind: 'steps' },
      })
    ).json() as { id: string };
    await db.pool.query('update documents set source_id=$2, owner_id=$3, editor_id=$4 where id=$1', [
      c.id,
      sourceId,
      ownerId,
      editor.id,
    ]);
    return c.id;
  };

  it('ingest raises the flag on every linked document and notifies owner + editor once', async () => {
    const owner = await makeUser(db.pool, { name: 'בעלת תוכן' });
    const { sourceId } = await upload('נהלים.md', '4.7 גרסה ראשונה של הנוהל. בדוק את המסלול.');
    const docId = await createLinked(sourceId, owner.id);
    expect(await documentsForSource(db.pool, sourceId)).toEqual([docId]);

    await upload('נהלים.md', '4.8 בדיקת מהירות גלישה. בקש מהלקוח להריץ Speedtest.', sourceId);
    const d = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}`, headers: auth(editor) })
    ).json();
    expect(d.sourceReviewNeeded).toBe(true);
    expect(d.sourceReviewReason).toMatch(/נהלים/);
    const n = sent.find((x) => x.entityId === docId)!;
    expect(n.kind).toBe('source');
    expect(new Set(n.userIds)).toEqual(new Set([owner.id, editor.id]));
  });

  it('publish clears the flag and records the source version', async () => {
    const { sourceId } = await upload('נהלים-ב.md', '5.1 נוהל שני. אסוף פרטי לקוח לפני המשך.');
    const docId = await createLinked(sourceId, editor.id);
    await withTransaction(db.pool, (tx) => markSourceReviewNeeded(tx, app.notifier, docId, 'בדיקה'));
    const g = await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}`, headers: auth(editor) });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/structure`,
      headers: { ...auth(editor), 'if-match': g.headers.etag as string },
      payload: minimalStructure,
    });
    const p = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/publish`,
      headers: auth(editor),
      payload: { label: 'v1' },
    });
    expect(p.json().document.sourceReviewNeeded).toBe(false);
  });

  it('an editor can clear the flag with a note, audited', async () => {
    const { sourceId } = await upload('נהלים-ג.md', '6.2 נוהל שלישי. ודא שהחשבון פעיל לפני המשך.');
    const docId = await createLinked(sourceId, editor.id);
    await withTransaction(db.pool, (tx) => markSourceReviewNeeded(tx, app.notifier, docId, 'בדיקה'));
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/source-review/clear`,
      headers: auth(editor),
      payload: { note: 'השינוי במקור אינו משפיע על המסלול' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().sourceReviewNeeded).toBe(false);
    const a = await db.pool.query(
      "select after from audit_log where action='docs.source_review_cleared' and entity_id=$1",
      [docId],
    );
    expect(a.rows[0].after).toEqual({ note: 'השינוי במקור אינו משפיע על המסלול' });
  });
});
