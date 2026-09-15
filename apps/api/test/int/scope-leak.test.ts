import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeEvent } from '@wecom/shared';
import { startTestDb, integration } from '../helpers/db.js';
import { buildTestApp } from '../helpers/app.js';
import { makeUser, auth } from '../helpers/fixtures.js';
import { seedQuiz } from '../helpers/v2/learningStub.js';
import { chatResult, fakeChat } from '../helpers/ai/fakeChat.js';
import { withTransaction } from '../../src/lib/sql.js';
import { aiChatHolder } from '../../src/modules/ai/chatModel.js';
import { parseSseFrames } from '../../src/modules/ai/sse.js';

const run = integration ? describe : describe.skip;

const FIELD = 'גלישה בארץ';
/** The string the whole file is about: it must appear in no response the scoped user gets. */
const SECRET = 'סודי לחיובים בלבד';
/** Same idea for the tag vocabulary: a tag name is content, and the counts are an oracle. */
const SECRET_TAG = 'לקוח-סודי';

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
  let billingScript: string;
  let techTopic: string;
  let trashedBilling: string;
  let billingSource: string;
  let billingRevision: string;
  /** A-I6: a suggestion on the billing document — the queue is world-scoped like every reader. */
  let billingSuggestion: string;
  /** A-I2: a suggestion with **no** target document, scoped only through its source's worlds. */
  let billingNullSuggestion: string;

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

    /**
     * Wave 4's five new read routes. A-I9: the wave that added them added no rows here, and
     * A-C2 (`/scripts` served every world's type-T documents, drafts included) and A-I2
     * (`/tags` served every world's tag vocabulary and counts) are exactly what these catch.
     */
    // A type-T "script" in billing, so `?docType=T` has something to leak.
    billingScript = (
      await post('/api/v1/documents', {
        title: SECRET + ' — תסריט',
        description: '',
        category: 'billing',
        wave: 1,
        priority: 'm',
        kind: 'text',
        docType: 'T',
        bodyHtml: `<p>${SECRET}</p>`,
      })
    ).json().id;
    // A tag that exists only on billing documents, so /tags has something to leak.
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${billingDoc}`,
      headers: auth(admin),
      payload: { tags: [SECRET_TAG] },
    });
    // A topic in a world the scoped user *can* see, with an out-of-scope document in it: the
    // sharper case, because the route answers 200 and the filter has to do the work.
    techTopic = (
      await post('/api/v1/worlds/tech/topics', { slug: 'boundary', name: 'גבול', description: '' })
    ).json().id;
    await db.pool.query('insert into document_topics(document_id, topic_id) values ($1,$2), ($3,$2)', [
      techDoc,
      techTopic,
      billingDoc,
    ]);
    // A deleted billing document, so /trash has something to leak (A-M12).
    trashedBilling = await makeDoc(SECRET + ' — נמחק', 'billing');
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${trashedBilling}`,
      headers: auth(admin),
    });
    // A source document on the billing item — the fullest representation of an item, and the
    // thing B-C1 served to anyone.
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${billingDoc}/source`,
      headers: auth(admin),
      payload: { html: `<p>${SECRET}</p>`, label: 'מקור' },
    });
    billingSource = (await db.pool.query('select source_id from documents where id=$1', [billingDoc])).rows[0]
      .source_id as string;
    // A gap on the billing document, so `/gaps` has something to leak (V3). Inserted directly:
    // the heuristics run nightly, and what is under test is the read filter, not the detector.
    await db.pool.query(
      `insert into knowledge_gaps(kind, key, title, suggested_action, world_slug, document_id)
       values ('feedback_cluster', $1, $2, 'update', 'billing', $3)`,
      [billingDoc, `דיווחים חוזרים על חוסר מידע: ${SECRET}`, billingDoc],
    );
    billingRevision = (
      await db.pool.query(
        'select id from source_revisions where source_id=$1 order by imported_at desc limit 1',
        [billingSource],
      )
    ).rows[0].id as string;
    /**
     * Wave 6 fix wave. Two suggestions on the billing revision: one targeting the billing
     * document (A-I6 — the review queue had no scope at all), and one with a **null** target
     * (A-I2 — `list_suggestions` and `refine_suggestion` skipped their check entirely for these,
     * and `new-card`/`field-alert` are exactly the types that have no target). Inserted directly:
     * what is under test is the read filter, not the proposal pipeline.
     */
    billingSuggestion = (
      await db.pool.query(
        `insert into suggestions(source_revision_id, anchor, type, title, target_document_id, target_step_key, payload, confidence, rationale)
         values ($1, '§1', 'deprecate-step', $2, $3, 's2', $4, 0.8, $2) returning id`,
        [billingRevision, SECRET, billingDoc, JSON.stringify({ type: 'deprecate-step', reason: SECRET })],
      )
    ).rows[0].id as string;
    billingNullSuggestion = (
      await db.pool.query(
        `insert into suggestions(source_revision_id, anchor, type, title, payload, confidence, rationale)
         values ($1, '§2', 'field-alert', $2, $3, 0.8, $2) returning id`,
        [
          billingRevision,
          SECRET,
          JSON.stringify({ type: 'field-alert', fieldName: SECRET, issue: 'unknown' }),
        ],
      )
    ).rows[0].id as string;
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
    // A-I9: the five wave-4 read routes, plus the feedback queue W3 added (B-I1).
    `/api/v1/topics/${techTopic}/items`,
    `/api/v1/tags?limit=100`,
    `/api/v1/documents?docType=T&pageSize=200`,
    `/api/v1/worlds`,
    `/api/v1/trash`,
    `/api/v1/feedback?pageSize=100`,
    `/api/v1/feedback/analytics`,
    // Wave 5 V3: a knowledge gap names the document it is about, in its key and in its title.
    `/api/v1/gaps?pageSize=100`,
    // A-I6: the review queue. Both the targeted and the null-target suggestion carry the secret
    // in their title and payload, and `SuggestionService.list` had no scope handling at all.
    `/api/v1/suggestions?pageSize=100`,
  ];

  // One `it` rather than `it.each`: the urls are built from ids `beforeAll` assigns, and
  // `it.each` evaluates its table while the describe body runs, before any of them exist.
  it('names neither the out-of-scope document nor its text, on any route', async () => {
    for (const url of routes()) {
      const r = await get(url);
      expect(r.statusCode, `${url} -> ${r.body}`).toBe(200);
      expect(r.body, url).not.toContain(billingDoc);
      expect(r.body, url).not.toContain(SECRET);
      expect(r.body, url).not.toContain(billingScript);
      // A tag name is content in its own right, and its count is an oracle for "how much does
      // that team have about X" (A-I2).
      expect(r.body, url).not.toContain(SECRET_TAG);
      expect(r.body, url).not.toContain(trashedBilling);
    }
  });

  /**
   * B-C1 — the source-document surface. `config.scope: 'document'` answers 403 for the four
   * routes hung off a document id; `/sources/:id/revisions/:rev/raw` has no `:id` document for
   * the plugin to resolve, so it resolves its owners itself and 404s. Either way the body must
   * not carry the source text.
   */
  it('B-C1: the source routes of an out-of-scope document give the scoped user nothing', async () => {
    for (const url of [
      `/api/v1/documents/${billingDoc}/source`,
      `/api/v1/documents/${billingDoc}/source/versions`,
      `/api/v1/documents/${billingDoc}/source/versions/1`,
      `/api/v1/documents/${billingDoc}/source/export.docx`,
      `/api/v1/sources/${billingSource}/revisions/${billingRevision}/raw`,
    ]) {
      const r = await get(url);
      expect([403, 404], `${url} -> ${r.statusCode} ${r.body}`).toContain(r.statusCode);
      expect(r.body, url).not.toContain(SECRET);
    }
    // …and the unrestricted user still gets all five, so this is a filter and not a break.
    for (const url of [
      `/api/v1/documents/${billingDoc}/source`,
      `/api/v1/documents/${billingDoc}/source/versions`,
      `/api/v1/documents/${billingDoc}/source/versions/1`,
      `/api/v1/documents/${billingDoc}/source/export.docx`,
      `/api/v1/sources/${billingSource}/revisions/${billingRevision}/raw`,
    ]) {
      const r = await app.inject({ method: 'GET', url, headers: auth(admin) });
      expect(r.statusCode, `${url} -> ${r.body}`).toBe(200);
    }
  });

  /**
   * A-C2's successor. `/scripts` served every world's type-T documents, drafts included; the
   * adapter is gone and its three readers moved to `GET /documents?docType=T`, so the boundary
   * that matters now is the documents list's — including the fact that `bodyHtml` rides on a
   * `kind: 'text'` card, which makes that list the fullest representation of a script there is.
   */
  it('A-C2: ?docType=T is scoped, body and all, and the row cannot be rewritten either', async () => {
    const list = await get('/api/v1/documents?docType=T&pageSize=200');
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((x: { id: string }) => x.id)).not.toContain(billingScript);
    expect(list.body).not.toContain(SECRET);
    // The same row the scoped user cannot read, they cannot rewrite or delete either.
    for (const [method, payload] of [
      ['PATCH', { title: 'חטיפה' }],
      ['DELETE', undefined],
    ] as const) {
      const r = await app.inject({
        method,
        url: `/api/v1/documents/${billingScript}`,
        headers: auth(scoped),
        payload,
      });
      expect([403, 404], `${method} -> ${r.statusCode}`).toContain(r.statusCode);
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
   * Wave 6 (X2): the copilot is a new read surface over every other one, and a model is an
   * unusually persuasive way to ask for something. Three things have to hold: a conversation
   * cannot be opened on an out-of-scope document, a tool call the model makes on one returns
   * nothing (not a 403 body, not a title — "לא נמצא"), and the transcript the admin exports
   * still carries what the admin was allowed to see, so this is a filter and not a break.
   */
  it('X2: the chat opens on no out-of-scope document and its tools leak none of one', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/ai/conversations',
          headers: auth(scoped),
          payload: { kind: 'article', documentId: billingDoc },
        })
      ).statusCode,
    ).toBe(404);

    // The model asks for the out-of-scope document by id and searches for its title.
    aiChatHolder.swap(
      fakeChat(({ messages }) =>
        messages.some((m) => m.role === 'tool')
          ? chatResult('לא מצאתי.')
          : chatResult('', [
              { id: 't1', name: 'read_document', args: { documentId: billingDoc } },
              { id: 't2', name: 'search_kb', args: { q: 'סודי' } },
            ]),
      ),
    );
    const turn = async (u: typeof scoped) => {
      const c = await app.inject({
        method: 'POST',
        url: '/api/v1/ai/conversations',
        headers: auth(u),
        payload: { kind: 'editor', documentId: techDoc },
      });
      expect(c.statusCode, c.body).toBe(201);
      const r = await app.inject({
        method: 'POST',
        url: `/api/v1/ai/conversations/${c.json().id}/messages`,
        headers: auth(u),
        payload: { content: 'ספר לי על המסמך השני' },
      });
      return { body: r.body, frames: parseSseFrames(r.body) };
    };

    const mine = await turn(scoped);
    expect(mine.body).not.toContain(SECRET);
    expect(mine.body).not.toContain(SECRET_TAG);
    expect(mine.frames.filter((e) => e.type === 'tool_result' && e.name === 'read_document')).toMatchObject([
      { ok: false },
    ]);

    // The unrestricted user does get it, so the filter is a filter.
    const theirs = await turn(admin);
    expect(theirs.body).toContain(SECRET);

    const exported = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/ai/conversations/export.jsonl',
      headers: auth(admin),
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.body).toContain(SECRET);
  });

  /**
   * Wave 6 fix wave. Four holes the X2 row above did not reach, all in the same shape: a read
   * that narrowed by the *target document* and therefore did nothing at all when there was no
   * target, or did not narrow by world in the first place.
   *
   * - **A-I1** `read_impact` scoped only the inbound-link walk; the embedding-neighbour query
   *   filtered on status and nothing else.
   * - **A-I2** `list_suggestions` / `refine_suggestion` let every null-target row through, and
   *   `list_suggestions` with no arguments was the 30 most recent suggestions on the instance.
   * - **A-I6** `GET /suggestions/:id` (the X6 seam route) and `GET /suggestions` applied no scope.
   */
  it('A-I1/A-I2/A-I6: the wave 6 impact tool, suggestion tools and review queue are all scoped', async () => {
    // The queue: both suggestions are the billing document's, one by target and one by source.
    for (const id of [billingSuggestion, billingNullSuggestion]) {
      const mine = await get(`/api/v1/suggestions/${id}`);
      expect(mine.statusCode, mine.body).toBe(404);
      const theirs = await get(`/api/v1/suggestions/${id}`, admin);
      expect(theirs.statusCode, theirs.body).toBe(200);
      expect(theirs.body).toContain(SECRET);
    }
    // And a decision route resolves the same way, so the write half cannot reach past the read.
    const reject = await app.inject({
      method: 'POST',
      url: `/api/v1/suggestions/${billingSuggestion}/reject`,
      headers: auth(scoped),
    });
    expect(reject.statusCode, reject.body).toBe(404);

    // The tools. One turn asks for all four at once; none of them may name the secret.
    aiChatHolder.swap(
      fakeChat(({ messages }) =>
        messages.some((m) => m.role === 'tool')
          ? chatResult('לא מצאתי.')
          : chatResult('', [
              { id: 'i1', name: 'read_impact', args: { documentId: techDoc } },
              { id: 'l1', name: 'list_suggestions', args: { sourceRevisionId: billingRevision } },
              { id: 'l2', name: 'list_suggestions', args: {} },
              {
                id: 'r1',
                name: 'refine_suggestion',
                args: { suggestionId: billingNullSuggestion, instruction: 'שפר' },
              },
            ]),
      ),
    );
    const c = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/conversations',
      headers: auth(scoped),
      payload: { kind: 'editor', documentId: techDoc },
    });
    expect(c.statusCode, c.body).toBe(201);
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/ai/conversations/${c.json().id}/messages`,
      headers: auth(scoped),
      payload: { content: 'מה ההצעות ומה ההשפעה?' },
    });
    expect(r.body).not.toContain(SECRET);
    const frames = parseSseFrames(r.body);
    const result = (id: string) =>
      frames.find((e) => e.type === 'tool_result' && e.id === id) as
        { ok: boolean; payload?: { items?: unknown[]; documents?: { id: string }[] } } | undefined;
    // `read_impact` answers — the tech document is the caller's — but names no billing neighbour.
    expect(result('i1')).toMatchObject({ ok: true });
    expect(result('i1')?.payload?.documents?.some((d) => d.id === billingDoc)).toBe(false);
    // The revision is the billing source's, so the list is empty rather than a leak.
    expect(result('l1')).toMatchObject({ ok: true });
    expect(result('l1')?.payload?.items).toEqual([]);
    // A-I2: no document and no revision is no longer "everything".
    expect(result('l2')).toMatchObject({ ok: false });
    // A-I2: a null-target suggestion is not refinable by someone who cannot see its source.
    expect(result('r1')).toMatchObject({ ok: false });
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

  /**
   * W2 §10, the *other* boundary the same read models have to respect: a reader without
   * `docs.read_unpublished` sees published items only. Same shape as the scope test above — one
   * unpublished document, one route table, and its id and title in no body — because the reason
   * per-route assertions kept missing a route has not changed.
   */
  it('W2: an unpublished document leaks through no route to a read-only reader', async () => {
    const DRAFT = 'טיוטה סודית לנציגים';
    const reader = await makeUser(db.pool, {
      name: 'נציג',
      perms: ['docs.read', 'notes.write'],
    });
    const draft = await makeDoc(DRAFT, 'tech');
    await putStructure(draft, 'צעד טיוטה', `בדוק את ${FIELD} וראה [[doc:${techDoc}]]`);
    // `techDoc` has to be *visible* for the assertions below to be about the draft rather than
    // about an empty graph: everything `makeDoc` creates starts as a draft.
    await post(`/api/v1/documents/${techDoc}/publish`, { label: 'פרסום לבדיקה' });

    // The draft gets a source document, so the B-C1 routes have something to leak.
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${draft}/source`,
      headers: auth(admin),
      payload: { html: `<p>${DRAFT}</p>`, label: 'מקור טיוטה' },
    });
    const draftSource = (await db.pool.query('select source_id from documents where id=$1', [draft])).rows[0]
      .source_id as string;
    const draftRevision = (
      await db.pool.query(
        'select id from source_revisions where source_id=$1 order by imported_at desc limit 1',
        [draftSource],
      )
    ).rows[0].id as string;

    const urls = [
      `/api/v1/graph?limit=2000`,
      `/api/v1/graph/impact/field:${encodeURIComponent(FIELD)}`,
      `/api/v1/graph/impact/doc:${techDoc}`,
      `/api/v1/documents/${techDoc}/backlinks`,
      `/api/v1/documents?limit=200`,
      `/api/v1/search?q=${encodeURIComponent('טיוטה')}`,
      `/api/v1/dashboards`,
      `/api/v1/data/files`,
      // A-I9: the wave-4 read routes.
      `/api/v1/topics/${techTopic}/items`,
      `/api/v1/tags?limit=100`,
      `/api/v1/documents?docType=T&pageSize=200`,
      `/api/v1/worlds`,
      `/api/v1/trash`,
    ];
    for (const url of urls) {
      const r = await app.inject({ method: 'GET', url, headers: auth(reader) });
      expect(r.statusCode, `${url} -> ${r.body}`).toBe(200);
      expect(r.body, url).not.toContain(draft);
      expect(r.body, url).not.toContain(DRAFT);
    }

    // The document itself, and everything keyed by its id, answers 404 NOT_PUBLISHED — not 403,
    // which would confirm that the id names something.
    for (const url of [
      `/api/v1/documents/${draft}`,
      `/api/v1/documents/${draft}/comments`,
      `/api/v1/documents/${draft}/notes`,
      `/api/v1/documents/${draft}/draft`,
      // B-C1: the source surface is the fullest representation of an item, and it carried the
      // world half of the boundary and not the status half.
      `/api/v1/documents/${draft}/source`,
      `/api/v1/documents/${draft}/source/versions`,
      `/api/v1/documents/${draft}/source/versions/1`,
      `/api/v1/documents/${draft}/source/export.docx`,
    ]) {
      const r = await app.inject({ method: 'GET', url, headers: auth(reader) });
      expect(r.statusCode, url).toBe(404);
      expect(r.json().code, url).toBe('NOT_PUBLISHED');
      expect(r.body, url).not.toContain(DRAFT);
    }

    /**
     * B-C1's worst case: `/sources/:id/revisions/:rev/raw` had neither `scope: 'document'` nor
     * a visibility check, so it served the original uploaded bytes of any source in any world.
     */
    const raw = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${draftSource}/revisions/${draftRevision}/raw`,
      headers: auth(reader),
    });
    expect(raw.statusCode).toBe(404);
    expect(raw.body).not.toContain(DRAFT);

    /**
     * B-I5: filing feedback against a draft both puts a report into the editors' queue for an
     * item the reporter could not read, and answers 201-vs-404 — the oracle
     * `assertVisibleDocument` exists to close.
     */
    const fb = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${draft}/feedback`,
      headers: auth(reader),
      payload: { kind: 'unclear', text: 'לא ברור' },
    });
    expect(fb.statusCode).toBe(404);
    expect(fb.json().code).toBe('NOT_PUBLISHED');

    // …and an editor still sees all of it, so this is a filter and not a break.
    const asAdmin = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?limit=200',
      headers: auth(admin),
    });
    expect(asAdmin.body).toContain(draft);
  });

  /**
   * Wave 5 fix wave: the *write* side of the same boundary.
   *
   * A-I1 — V1's learning routes carry `assertScope`; V2's manager routes (audiences, assign,
   * completion) gated on `learning.manage` and nothing else, so a manager scoped to one world
   * could assign another world's item to arbitrary users, delete its audiences, and read its
   * card. A-I5 — `POST …/generate` read any published document id it was handed and rendered its
   * steps, actions, outcomes and CRM field names back as questions. A-I6 — gap reads were scoped
   * and gap mutations were not, and `resolve` read the row back afterwards, which put the
   * out-of-scope gap's title in the response.
   */
  it('A-I1/A-I5/A-I6: the wave 5 write surfaces refuse an out-of-scope item, document and gap', async () => {
    const billingQuiz = await seedQuiz(db.pool, {
      documentId: billingDoc,
      title: `שאלון ${SECRET}`,
      worldSlug: 'billing',
      passMark: 80,
      maxAttempts: null,
      questions: [{ stem: 'שאלה', kind: 'single', options: [{ id: 'a', text: 'נכון', correct: true }] }],
    });
    const audience = await db.pool.query(
      `insert into learning_audiences(item_id, role_names, world_slugs, user_ids, due_days)
       values ($1, '{}', '{}', '{}', 14) returning id`,
      [billingQuiz],
    );
    const billingGap = (
      await db.pool.query(`select id from knowledge_gaps where world_slug='billing' limit 1`)
    ).rows[0].id as string;
    // A tech item, so the generate call is refused for the *document* rather than the item.
    const techItem = (
      await post('/api/v1/learning/items', { kind: 'quiz', title: 'בוחן טכני', worldSlug: 'tech' }, scoped)
    ).json().id as string;

    const attempts: [string, string, unknown][] = [
      [
        'POST',
        `/api/v1/learning/items/${billingQuiz}/audiences`,
        { roleNames: ['agent'], worldSlugs: [], userIds: [], dueDays: 14 },
      ],
      ['DELETE', `/api/v1/learning/audiences/${audience.rows[0].id}`, undefined],
      ['POST', `/api/v1/learning/items/${billingQuiz}/assign`, { userIds: [admin.id], dueDays: 14 }],
      ['GET', `/api/v1/learning/items/${billingQuiz}/completion`, undefined],
      ['POST', `/api/v1/learning/items/${techItem}/generate`, { documentIds: [billingDoc], perDocument: 3 }],
      ['POST', `/api/v1/gaps/${billingGap}/dismiss`, { reason: 'לא רלוונטי' }],
      ['POST', `/api/v1/gaps/${billingGap}/resolve`, { documentId: billingDoc }],
    ];
    for (const [method, url, payload] of attempts) {
      const r = await app.inject({
        method: method as 'GET' | 'POST' | 'DELETE',
        url,
        headers: auth(scoped),
        payload: payload as never,
      });
      expect([403, 404], `${method} ${url} -> ${r.statusCode} ${r.body}`).toContain(r.statusCode);
      expect(r.body, url).not.toContain(SECRET);
    }
    // The gap is still open and the audience still there: a refused write wrote nothing.
    expect(
      (await db.pool.query(`select status from knowledge_gaps where id=$1`, [billingGap])).rows[0].status,
    ).toBe('open');
    expect(
      (await db.pool.query(`select 1 from learning_audiences where id=$1`, [audience.rows[0].id])).rowCount,
    ).toBe(1);
    // …and the unrestricted user can still do every one of them, so this is a filter.
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/learning/items/${billingQuiz}/completion`,
          headers: auth(admin),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/gaps/${billingGap}/dismiss`,
          headers: auth(admin),
          payload: { reason: 'טופל' },
        })
      ).statusCode,
    ).toBe(200);
  });
});
