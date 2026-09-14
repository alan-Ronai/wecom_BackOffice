import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth, minimalStructure } from './helpers/fixtures.js';

const run = integration ? describe : describe.skip;
const READER = ['docs.read'];

run('governance', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let editor: Awaited<ReturnType<typeof makeUser>>;
  let reader: Awaited<ReturnType<typeof makeUser>>;
  let draftId: string;
  let publishedId: string;

  const create = async (title: string) =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(editor),
        payload: { title, description: 'd', category: 'tech', wave: 1, priority: 'h', kind: 'steps' },
      })
    ).json() as { id: string; etag: string };

  const publish = async (id: string) => {
    const g = await app.inject({ method: 'GET', url: `/api/v1/documents/${id}`, headers: auth(editor) });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${id}/structure`,
      headers: { ...auth(editor), 'if-match': g.headers.etag as string },
      payload: minimalStructure,
    });
    const p = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${id}/publish`,
      headers: auth(editor),
      payload: { label: 'v1' },
    });
    expect(p.statusCode).toBe(200);
    return p.json();
  };

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    editor = await makeUser(db.pool);
    reader = await makeUser(db.pool, { perms: READER });
    draftId = (await create('טיוטה סודית')).id;
    publishedId = (await create('מסמך מפורסם')).id;
    await publish(publishedId);
    // published → related to the draft through an explicit related entry
    const g = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${publishedId}`,
      headers: auth(editor),
    });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${publishedId}/structure`,
      headers: { ...auth(editor), 'if-match': g.headers.etag as string },
      payload: { ...minimalStructure, related: [{ documentId: draftId, why: 'בדיקה' }] },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${publishedId}/publish`,
      headers: auth(editor),
      payload: { label: 'v2' },
    });
  }, 180000);
  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  describe('visibility', () => {
    it('list: reader gets published/partial only, editor gets all', async () => {
      const r = await app.inject({ method: 'GET', url: '/api/v1/documents', headers: auth(reader) });
      expect(r.json().items.map((c: { id: string }) => c.id)).toEqual([publishedId]);
      const e = await app.inject({ method: 'GET', url: '/api/v1/documents', headers: auth(editor) });
      expect(e.json().total).toBe(2);
    });
    it('get: reader receives 404 NOT_PUBLISHED on a draft', async () => {
      const r = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${draftId}`,
        headers: auth(reader),
      });
      expect(r.statusCode).toBe(404);
      expect(r.json().code).toBe('NOT_PUBLISHED');
      const ok = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${publishedId}`,
        headers: auth(reader),
      });
      expect(ok.statusCode).toBe(200);
    });
    it('related and links hide the draft from the reader', async () => {
      const rel = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${publishedId}/related`,
        headers: auth(reader),
      });
      expect(rel.json().items.some((x: { documentId: string }) => x.documentId === draftId)).toBe(false);
      const relE = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${publishedId}/related`,
        headers: auth(editor),
      });
      expect(relE.json().items.some((x: { documentId: string }) => x.documentId === draftId)).toBe(true);
      const links = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${publishedId}/links`,
        headers: auth(reader),
      });
      expect(links.json().out.some((l: { toDocumentId: string | null }) => l.toDocumentId === draftId)).toBe(
        false,
      );
    });
    it('search hides draft documents and their steps from the reader', async () => {
      const r = await app.inject({ method: 'GET', url: '/api/v1/search?q=סודית', headers: auth(reader) });
      expect(r.json().total).toBe(0);
      const e = await app.inject({ method: 'GET', url: '/api/v1/search?q=סודית', headers: auth(editor) });
      expect(e.json().total).toBeGreaterThan(0);
    });
    it('backlinks of a hidden document are hidden too', async () => {
      const r = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${draftId}/backlinks`,
        headers: auth(reader),
      });
      expect(r.statusCode).toBe(404);
    });
  });

  describe('status and deletion', () => {
    it('marks a published document invalid with a reason and audits it', async () => {
      const id = (await create('נוהל ישן')).id;
      await publish(id);
      const denied = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${id}/status`,
        headers: auth(reader),
        payload: { status: 'invalid', reason: 'x' },
      });
      expect(denied.statusCode).toBe(403);
      const r = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${id}/status`,
        headers: auth(editor),
        payload: { status: 'invalid', reason: 'הוחלף בנוהל חדש' },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().status).toBe('invalid');
      const a = await db.pool.query("select after from audit_log where action='docs.status' and entity_id=$1", [
        id,
      ]);
      expect(a.rows[0].after).toEqual({ status: 'invalid', reason: 'הוחלף בנוהל חדש' });
      // hidden from readers now
      const g = await app.inject({ method: 'GET', url: `/api/v1/documents/${id}`, headers: auth(reader) });
      expect(g.json().code).toBe('NOT_PUBLISHED');
      // and back to draft is allowed
      const back = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${id}/status`,
        headers: auth(editor),
        payload: { status: 'draft', reason: 'עריכה מחדש' },
      });
      expect(back.json().status).toBe('draft');
    });

    it('refuses to delete a once-published document', async () => {
      const id = (await create('פורסם פעם')).id;
      await publish(id);
      const d = await app.inject({
        method: 'DELETE',
        url: `/api/v1/documents/${id}`,
        headers: auth(editor),
      });
      expect(d.statusCode).toBe(409);
      expect(d.json().code).toBe('ONCE_PUBLISHED');
      expect(d.json().details).toEqual({ allowed: ['invalid', 'archived'] });
      const still = await db.pool.query('select deleted_at from documents where id=$1', [id]);
      expect(still.rows[0].deleted_at).toBeNull();
    });

    it('still deletes a never-published draft', async () => {
      const id = (await create('טיוטה למחיקה')).id;
      const d = await app.inject({
        method: 'DELETE',
        url: `/api/v1/documents/${id}`,
        headers: auth(editor),
      });
      expect(d.statusCode).toBe(200);
    });
  });

  describe('ownership', () => {
    it('patches owner and editor, and publish stamps approver and publishedAt', async () => {
      const owner = await makeUser(db.pool, { name: 'רונית מ.' });
      const id = (await create('עם בעלים')).id;
      const p = await app.inject({
        method: 'PATCH',
        url: `/api/v1/documents/${id}`,
        headers: auth(editor),
        payload: { ownerId: owner.id, editorId: editor.id },
      });
      expect(p.statusCode).toBe(200);
      expect(p.json().ownerId).toBe(owner.id);
      expect(p.json().ownerName).toBe('רונית מ.');
      expect(p.json().editorId).toBe(editor.id);
      expect(p.json().approverId).toBeNull();
      expect(p.json().publishedAt).toBeNull();
      await publish(id);
      const g = (
        await app.inject({ method: 'GET', url: `/api/v1/documents/${id}`, headers: auth(editor) })
      ).json();
      expect(g.approverId).toBe(editor.id);
      expect(g.approverName).toBe(editor.name);
      expect(typeof g.publishedAt).toBe('string');
      const card = (
        await app.inject({ method: 'GET', url: '/api/v1/documents?q=בעלים', headers: auth(editor) })
      ).json().items[0];
      expect(card.ownerName).toBe('רונית מ.');
      expect(card.sourceReviewNeeded).toBe(false);
    });
    it('rejects an unknown owner id with 400', async () => {
      const id = (await create('בעלים שגוי')).id;
      const p = await app.inject({
        method: 'PATCH',
        url: `/api/v1/documents/${id}`,
        headers: auth(editor),
        payload: { ownerId: '00000000-0000-4000-8000-000000000000' },
      });
      expect(p.statusCode).toBe(400);
      expect(p.json().code).toBe('UNKNOWN_USER');
    });
  });
});
