import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeEvent } from '@wecom/shared';
import { startTestDb, integration } from '../helpers/db.js';
import { buildTestApp } from '../helpers/app.js';
import { makeUser, auth } from '../helpers/fixtures.js';
import { withTransaction } from '../../src/lib/sql.js';

const run = integration ? describe : describe.skip;

const FIELD = 'גלישה בארץ';
/** The string the whole file is about: it must appear in no response the scoped user gets. */
const SECRET = 'סודי לחיובים בלבד';

/**
 * One test for the whole boundary rather than one per route.
 *
 * Wave 3 added five separate ways around category scope (the graph, the impact view, the field
 * page, the block page, the comment-by-id routes) and a sixth on the SSE stream. Asserting
 * per route is what let each new read model ship with the check missing, so this walks the
 * route table with one scoped user and one out-of-scope document and asserts that document's
 * id, title and step text appear in **no** body — which is the property that actually matters
 * and the one the next cross-cutting read model will also have to satisfy.
 */
run('category scope: an out-of-scope document leaks through no route', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  /** Unrestricted: builds the fixture through the real write paths. */
  let admin: Awaited<ReturnType<typeof makeUser>>;
  /** `categoryScopes: ['tech']` — the user every assertion below is about. */
  let scoped: Awaited<ReturnType<typeof makeUser>>;
  let techDoc: string;
  let billingDoc: string;
  let blockId: string;
  let billingComment: string;

  const post = (url: string, payload: unknown, u = admin) =>
    app.inject({ method: 'POST', url, headers: auth(u), payload });
  const get = (url: string, u = scoped) => app.inject({ method: 'GET', url, headers: auth(u) });

  /**
   * Two steps: `s1` embeds the shared block, `s2` carries free text. They are separate because
   * `stepText` takes a block-backed step's actions *from the block* (`format/links.ts:9`), so a
   * step that embeds a block cannot also contribute its own field reference or `[[doc:…]]` link.
   */
  const putStructure = async (id: string, title: string, actionText: string, block?: string) => {
    const etag = (await app.inject({ method: 'GET', url: `/api/v1/documents/${id}`, headers: auth(admin) }))
      .headers.etag as string;
    const r = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${id}/structure`,
      headers: { ...auth(admin), 'if-match': etag },
      payload: {
        phases: [
          {
            id: 'p1',
            label: 'שלב 1',
            steps: [
              {
                key: 's1',
                num: '1',
                title,
                blockId: block ?? blockId,
                blockRefs: [],
                deps: [],
                actions: [],
                outcomes: [{ kind: 'ok', text: '✓ סיום' }],
              },
              {
                key: 's2',
                num: '2',
                title: 'המשך',
                blockRefs: [],
                deps: [],
                actions: [{ id: 'a1', text: actionText }],
                outcomes: [{ kind: 'ok', text: '✓ סיום' }],
              },
            ],
          },
        ],
      },
    });
    if (r.statusCode !== 200) throw new Error(`structure ${id}: ${r.statusCode} ${r.body}`);
  };

  const makeDoc = async (title: string, category: string) =>
    (
      await post('/api/v1/documents', {
        title,
        description: '',
        category,
        wave: 1,
        priority: 'm',
        kind: 'steps',
      })
    ).json().id as string;

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    admin = await makeUser(db.pool, { name: 'מנהלת' });
    scoped = await makeUser(db.pool, { name: 'מוגבל', scopes: ['tech'] });

    await app.inject({
      method: 'PUT',
      url: `/api/v1/fields/${encodeURIComponent(FIELD)}`,
      headers: auth(admin),
      payload: { name: FIELD, status: 'ok', path: 'CRM > לקוח' },
    });
    blockId = (
      await post('/api/v1/blocks', {
        title: 'בלוק משותף',
        kind: 'step',
        actions: [{ id: 'a1', text: 'פתח CRM' }],
        outcomes: [{ kind: 'ok', text: '✓ תקין' }],
      })
    ).json().id;

    techDoc = await makeDoc('מסמך טכני', 'tech');
    billingDoc = await makeDoc(SECRET, 'billing');
    // Both documents use the same block and the same CRM field, and the billing one links at
    // the tech one — so every join the graph makes has an out-of-scope row to offer.
    await putStructure(techDoc, 'בדיקה', `בדוק את ${FIELD}`);
    await putStructure(billingDoc, 'בדיקת חיוב', `בדוק את ${FIELD} וראה [[doc:${techDoc}]]`);

    billingComment = (
      await post(`/api/v1/documents/${billingDoc}/comments`, { stepKey: 's2', text: SECRET })
    ).json().id;
  }, 180000);

  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  const routes = () => [
    `/api/v1/graph?limit=2000`,
    `/api/v1/graph?limit=2000&category=billing`,
    `/api/v1/graph?focus=field:${encodeURIComponent(FIELD)}&depth=3&limit=2000`,
    `/api/v1/graph/impact/field:${encodeURIComponent(FIELD)}`,
    `/api/v1/graph/impact/block:${blockId}`,
    `/api/v1/graph/impact/doc:${techDoc}`,
    `/api/v1/fields/${encodeURIComponent(FIELD)}/page`,
    `/api/v1/fields/${encodeURIComponent(FIELD)}/usage`,
    `/api/v1/blocks/${blockId}/page`,
    `/api/v1/documents/${techDoc}/backlinks`,
    `/api/v1/documents?limit=200`,
    // M1: `coverage.byCategory`/`freshness.byCategory` enumerated categories the caller cannot
    // read and `usage.topDocuments` returned titles from them.
    `/api/v1/dashboards`,
  ];

  // One `it` rather than `it.each`: the urls are built from ids `beforeAll` assigns, and
  // `it.each` evaluates its table while the describe body runs, before any of them exist.
  it('names neither the out-of-scope document nor its text, on any route', async () => {
    for (const url of routes()) {
      const r = await get(url);
      expect(r.statusCode, `${url} -> ${r.body}`).toBe(200);
      expect(r.body, url).not.toContain(billingDoc);
      expect(r.body, url).not.toContain(SECRET);
    }
  });

  it('still shows the unrestricted user everything, so the filter is a filter and not a break', async () => {
    for (const url of routes()) {
      const r = await app.inject({ method: 'GET', url, headers: auth(admin) });
      expect(r.statusCode, url).toBe(200);
    }
    const g = (
      await app.inject({ method: 'GET', url: '/api/v1/graph?limit=2000', headers: auth(admin) })
    ).json();
    expect(g.nodes.map((n: { id: string }) => n.id)).toContain(`doc:${billingDoc}`);
    const impact = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/graph/impact/field:${encodeURIComponent(FIELD)}`,
        headers: auth(admin),
      })
    ).json();
    expect(impact.inbound.map((x: { documentId: string }) => x.documentId)).toContain(billingDoc);
    expect(impact.affectedDocuments).toBe(2);
  });

  it('keeps the in-scope half of every shared node visible to the scoped user', async () => {
    // The point is a filter, not a blanket denial: the tech document still reaches the block
    // and the field, and the impact view still counts it.
    const g = (await get(`/api/v1/graph?focus=doc:${techDoc}&depth=1&limit=2000`)).json();
    const ids = g.nodes.map((n: { id: string }) => n.id);
    expect(ids).toContain(`block:${blockId}`);
    expect(ids).toContain(`field:${FIELD}`);
    const impact = (await get(`/api/v1/graph/impact/field:${encodeURIComponent(FIELD)}`)).json();
    expect(impact.inbound.map((x: { documentId: string }) => x.documentId)).toEqual([techDoc]);
    expect(impact.affectedDocuments).toBe(1);
    const page = (await get(`/api/v1/fields/${encodeURIComponent(FIELD)}/page`)).json();
    expect(page.documents).toBe(1);
    expect(page.usage.map((x: { documentId: string }) => x.documentId)).toEqual([techDoc]);
  });

  it('404s a graph node that only out-of-scope documents reach, rather than confirming it', async () => {
    const onlyBilling = await makeDoc('עוד חיוב', 'billing');
    const lonely = (
      await post('/api/v1/blocks', {
        title: 'בלוק של חיובים',
        kind: 'step',
        actions: [{ id: 'a1', text: 'פתח חיובים' }],
        outcomes: [{ kind: 'ok', text: '✓' }],
      })
    ).json().id;
    await putStructure(onlyBilling, 'צעד', 'טקסט', lonely);

    const r = await get(`/api/v1/graph/impact/block:${lonely}`);
    expect(r.statusCode).toBe(404);
    // …and the unrestricted user does see it, so 404 is scope and not a broken fixture.
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/graph/impact/block:${lonely}`, headers: auth(admin) }))
        .statusCode,
    ).toBe(200);
  });

  it('C2: the comment-by-id routes 404 for a comment on an out-of-scope document', async () => {
    for (const [method, url] of [
      ['POST', `/api/v1/comments/${billingComment}/resolve`],
      ['POST', `/api/v1/comments/${billingComment}/like`],
      ['DELETE', `/api/v1/comments/${billingComment}`],
    ] as const) {
      const r = await app.inject({ method, url, headers: auth(scoped) });
      // 404, not 403: `resolve` returns the comment body on success, so a 403 would still
      // confirm that a guessed id exists.
      expect(r.statusCode, `${method} ${url}`).toBe(404);
      expect(r.body).not.toContain(SECRET);
    }
    // The comment is untouched and the author can still act on it.
    const mine = await app.inject({
      method: 'POST',
      url: `/api/v1/comments/${billingComment}/resolve`,
      headers: auth(admin),
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().resolvedAt).not.toBeNull();
  });

  /**
   * I4(a): the read leak has a write counterpart. `POST /fields/:name/rename` required only
   * `fields.edit` and never consulted `categoryScopes`, so a narrowly scoped editor rewrote step
   * text in every category. Left last in the file because it mutates the catalogue.
   */
  it('I4: a scoped rename rewrites only the documents the caller can open', async () => {
    const field = 'קוד תעריף';
    await app.inject({
      method: 'PUT',
      url: `/api/v1/fields/${encodeURIComponent(field)}`,
      headers: auth(admin),
      payload: { name: field, status: 'ok', path: 'CRM > תעריף' },
    });
    const tech = await makeDoc('תעריף טכני', 'tech');
    const billing = await makeDoc('תעריף חיוב', 'billing');
    await putStructure(tech, 'צעד', `בדוק את ${field} בכרטיס`);
    await putStructure(billing, 'צעד', `בדוק את ${field} בכרטיס`);

    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/fields/${encodeURIComponent(field)}/rename`,
      headers: auth(scoped),
      payload: { newName: 'קוד מסלול', updateReferences: true, label: 'שינוי שם' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().updatedDocuments).toBe(1);

    const textOf = async (id: string) =>
      (await app.inject({ method: 'GET', url: `/api/v1/documents/${id}`, headers: auth(admin) })).json()
        .phases[0].steps[1].actions[0].text as string;
    expect(await textOf(tech)).toContain('קוד מסלול');
    // Untouched: the scoped editor may not read this document, so they may not rewrite it either.
    // The old name survives as a `renamed` tombstone, which is what tells its owners to update.
    expect(await textOf(billing)).toContain(field);
  });

  it('C3: notification.created reaches the target user only', async () => {
    const addr = await app.listen({ port: 0, host: '127.0.0.1' });
    const open = async (u: typeof admin) => {
      const res = await fetch(addr + '/api/v1/events', { headers: auth(u) });
      return { reader: res.body!.getReader(), dec: new TextDecoder() };
    };
    const target = await open(admin);
    const bystander = await open(scoped);

    await withTransaction(db.pool, (tx) =>
      app.events.publish(
        tx,
        makeEvent('notification.created', {
          notificationId: techDoc,
          userId: admin.id,
          kind: 'mention',
          title: SECRET,
        }),
      ),
    );
    // A second, document-scoped event both users may see — it is the fence that proves the
    // bystander's stream is alive and simply did not receive the notification.
    await withTransaction(db.pool, (tx) =>
      app.events.publish(tx, makeEvent('document.updated', { documentId: techDoc, actorId: null })),
    );

    const readUntil = async (s: { reader: ReadableStreamDefaultReader<Uint8Array>; dec: TextDecoder }) => {
      let buf = '';
      while (!buf.includes('event: document.updated')) buf += s.dec.decode((await s.reader.read()).value);
      return buf;
    };
    const forTarget = await readUntil(target);
    const forBystander = await readUntil(bystander);

    expect(forTarget).toContain('event: notification.created');
    expect(forTarget).toContain(SECRET);
    expect(forBystander).not.toContain('event: notification.created');
    expect(forBystander).not.toContain(SECRET);

    await target.reader.cancel();
    await bystander.reader.cancel();
  });
});
