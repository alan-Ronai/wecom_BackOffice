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
});
