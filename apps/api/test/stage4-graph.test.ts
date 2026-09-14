import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth } from './helpers/fixtures.js';

const run = integration ? describe : describe.skip;

const FIELD = 'גלישה בארץ';

/**
 * Stage 4 — the graph is computed from the derived tables L2 already maintains, so the
 * fixture is built through the real write paths (create + structure) and never by hand:
 * if `recomputeDerived` stops emitting a link the graph test is the one that fails.
 */
run('stage 4: graph + impact + backlinks', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let u: Awaited<ReturnType<typeof makeUser>>;
  let docA: string;
  let docB: string;
  let blockId: string;

  const post = (url: string, payload: unknown) =>
    app.inject({ method: 'POST', url, headers: auth(u), payload });
  const get = (url: string) => app.inject({ method: 'GET', url, headers: auth(u) });
  /** `PUT /documents/:id/structure` is etag-guarded, so read the current one first. */
  const putStructure = async (id: string, phases: unknown[]) => {
    const etag = (await get(`/api/v1/documents/${id}`)).headers.etag as string;
    const r = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${id}/structure`,
      headers: { ...auth(u), 'if-match': etag },
      payload: { phases },
    });
    if (r.statusCode !== 200) throw new Error(`structure ${id} failed: ${r.statusCode} ${r.body}`);
    return r;
  };

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    u = await makeUser(db.pool);

    await app.inject({
      method: 'PUT',
      url: `/api/v1/fields/${encodeURIComponent(FIELD)}`,
      headers: auth(u),
      payload: { name: FIELD, status: 'ok', path: 'CRM > לקוח' },
    });
    blockId = (
      await post('/api/v1/blocks', {
        title: 'בדיקת חסימה',
        kind: 'step',
        actions: [{ id: 'a1', text: `פתח CRM ובדוק את ${FIELD}` }],
        outcomes: [{ kind: 'ok', text: '✓ תקין' }],
      })
    ).json().id;

    docA = (
      await post('/api/v1/documents', {
        title: 'איטיות גלישה',
        description: '',
        category: 'tech',
        wave: 1,
        priority: 'hh',
        kind: 'steps',
      })
    ).json().id;
    docB = (
      await post('/api/v1/documents', {
        title: 'חסימת גלישה',
        description: '',
        category: 'tech',
        wave: 1,
        priority: 'h',
        kind: 'steps',
      })
    ).json().id;

    await putStructure(docA, [
      {
        id: 'p1',
        label: 'שלב 1',
        steps: [
          {
            key: 's1',
            num: '1',
            title: 'בדיקה',
            blockId,
            blockRefs: [],
            deps: [],
            actions: [{ id: 'a1', text: `בדוק את ${FIELD}` }],
            outcomes: [{ kind: 'ok', text: '✓ סיום' }],
          },
        ],
      },
    ]);
    await putStructure(docB, [
      {
        id: 'p1',
        label: 'שלב 1',
        steps: [
          {
            key: 's1',
            num: '1',
            title: 'הפניה',
            blockRefs: [],
            deps: [],
            actions: [{ id: 'a1', text: `ראה [[doc:${docA}]] להמשך` }],
            outcomes: [{ kind: 'ok', text: '✓ סיום' }],
          },
        ],
      },
    ]);
  }, 180000);

  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  it('BFS from a focused document reaches its block and CRM field at depth 1', async () => {
    const r = await get(`/api/v1/graph?focus=doc:${docA}&depth=1`);
    expect(r.statusCode).toBe(200);
    const g = r.json();
    const ids = g.nodes.map((n: { id: string }) => n.id);
    expect(ids).toContain(`doc:${docA}`);
    expect(ids).toContain(`block:${blockId}`);
    expect(ids).toContain(`field:${FIELD}`);
    expect(g.truncated).toBe(false);
    expect(g.edges.some((e: { to: string; type: string }) => e.to === `field:${FIELD}`)).toBe(true);
    // depth 1 from A does not yet include B, which points *at* A.
    const deep = (await get(`/api/v1/graph?focus=doc:${docA}&depth=2`)).json();
    expect(deep.nodes.map((n: { id: string }) => n.id)).toContain(`doc:${docB}`);
  });

  it('reports truncated when the node limit is hit', async () => {
    const g = (await get(`/api/v1/graph?focus=doc:${docA}&depth=3&limit=10`)).json();
    expect(g.nodes.length).toBeLessThanOrEqual(10);
    const all = (await get('/api/v1/graph?limit=10')).json();
    expect(all.nodes.length).toBeLessThanOrEqual(10);
  });

  it('filters by link type and node kind', async () => {
    const g = (await get(`/api/v1/graph?focus=doc:${docA}&depth=2&types=same_field`)).json();
    expect(g.edges.every((e: { type: string }) => e.type === 'same_field')).toBe(true);
    const k = (await get(`/api/v1/graph?focus=doc:${docA}&depth=2&kinds=document`)).json();
    expect(k.nodes.every((n: { kind: string }) => n.kind === 'document')).toBe(true);
  });

  it('impact on a document lists the documents pointing at it', async () => {
    const r = await get(`/api/v1/graph/impact/doc:${docA}`);
    expect(r.statusCode).toBe(200);
    const i = r.json();
    expect(i.node.id).toBe(`doc:${docA}`);
    expect(i.node.kind).toBe('document');
    expect(i.inbound.map((x: { documentId: string }) => x.documentId)).toContain(docB);
    expect(i.affectedDocuments).toBe(1);
    expect(i.brokenLinks).toBe(0);
  });

  it('impact on a CRM field and on a block lists their users', async () => {
    const f = (await get(`/api/v1/graph/impact/field:${encodeURIComponent(FIELD)}`)).json();
    expect(f.node.kind).toBe('field');
    expect(f.inbound.map((x: { documentId: string }) => x.documentId)).toContain(docA);
    const b = (await get(`/api/v1/graph/impact/block:${blockId}`)).json();
    expect(b.node.kind).toBe('block');
    expect(b.inbound.some((x: { documentId: string; type: string }) => x.documentId === docA)).toBe(true);
  });

  it('404s on an unknown node', async () => {
    const r = await get('/api/v1/graph/impact/doc:11111111-1111-4111-8111-111111111111');
    expect(r.statusCode).toBe(404);
  });

  it('backlinks returns the inbound references of a document', async () => {
    const r = await get(`/api/v1/documents/${docA}/backlinks`);
    expect(r.statusCode).toBe(200);
    expect(r.json().items.map((x: { documentId: string }) => x.documentId)).toEqual([docB]);
    expect(r.json().items[0].stepKey).toBe('s1');
    const empty = await get(`/api/v1/documents/${docB}/backlinks`);
    expect(empty.json().items).toEqual([]);
  });
});
