import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import fakeAuth from './helpers/fakeAuth.js';
import { makeUser, auth, minimalStructure } from './helpers/fixtures.js';

const run = integration ? describe : describe.skip;
const branchStructure = {
  phases: [
    {
      id: 'p1',
      label: 'סינון',
      steps: [
        {
          key: 's1',
          num: '1',
          title: 'בדיקת חסימה',
          actions: [{ id: 'a1', text: 'CRM ↗ שדה "גלישה בארץ"' }],
          outcomes: [{ kind: 'ok', text: 'לא חסום', goto: 's2' }],
        },
        {
          key: 's2',
          num: '2',
          title: 'סוג מכשיר',
          actions: [],
          outcomes: [],
          branch: {
            q: 'איזה מכשיר?',
            options: [
              { kind: 'if', label: 'אייפון', text: 'איפוס רשת', goto: 's3' },
              { kind: 'if', label: 'אנדרואיד', text: 'בדוק APN', goto: 's3' },
            ],
          },
        },
        {
          key: 's3',
          num: '3',
          title: 'סיום',
          actions: [{ id: 'a1', text: 'סכם שיחה' }],
          outcomes: [{ kind: 'ok', text: 'סיום' }],
        },
      ],
    },
  ],
};

run('learning content', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let lead: Awaited<ReturnType<typeof makeUser>>;
  let editor: Awaited<ReturnType<typeof makeUser>>;
  let agent: Awaited<ReturnType<typeof makeUser>>;
  let scopedEditor: Awaited<ReturnType<typeof makeUser>>;
  let pubDoc: string;
  let draftDoc: string;

  const createDoc = async (structure: unknown, publish: boolean, category = 'tech') => {
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(lead),
        payload: { title: 'מסמך ' + Math.random(), category, wave: 1, priority: 'm', kind: 'steps' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${c.id}/structure`,
      headers: { ...auth(lead), 'if-match': c.etag },
      payload: structure,
    });
    if (publish)
      await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${c.id}/publish`,
        headers: auth(lead),
        payload: { label: 'v1' },
      });
    return c.id as string;
  };
  const createItem = async (kind: 'briefing' | 'quiz', who = editor, extra: Record<string, unknown> = {}) =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/learning/items',
        headers: auth(who),
        payload: { kind, title: kind === 'quiz' ? 'בוחן' : 'תדריך', ...extra },
      })
    ).json();

  beforeAll(async () => {
    db = await startTestDb();
    // `MODEL_DISABLED` pins the rule-based client: without it the suite would reach for a local
    // Ollama, so the generation assertions would depend on whether one happens to be running.
    app = await buildApp({
      config: { DATABASE_URL: db.url, NODE_ENV: 'test', MODEL_DISABLED: true },
      pool: db.pool,
      boss: false,
      plugins: [fakeAuth],
    });
    await app.events.start(db.url);
    lead = await makeUser(db.pool, { name: 'ענבר' });
    editor = await makeUser(db.pool, {
      name: 'עורך',
      perms: ['docs.read', 'docs.read_unpublished', 'learning.read', 'learning.manage'],
    });
    agent = await makeUser(db.pool, { name: 'נציג', perms: ['docs.read', 'learning.read'] });
    scopedEditor = await makeUser(db.pool, {
      name: 'עורך סים',
      perms: ['docs.read', 'docs.read_unpublished', 'learning.read', 'learning.manage'],
      scopes: ['sim'],
    });
    pubDoc = await createDoc(branchStructure, true);
    draftDoc = await createDoc(minimalStructure, false);
  }, 120000);
  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it('creates, lists and reads a draft item for managers only', async () => {
    const item = await createItem('briefing');
    expect(item.status).toBe('draft');
    const forAgent = await app.inject({
      method: 'GET',
      url: `/api/v1/learning/items/${item.id}`,
      headers: auth(agent),
    });
    expect(forAgent.statusCode).toBe(404);
    const list = (
      await app.inject({ method: 'GET', url: '/api/v1/learning/items', headers: auth(agent) })
    ).json();
    expect(list.items.find((x: { id: string }) => x.id === item.id)).toBeUndefined();
    const listMgr = (
      await app.inject({ method: 'GET', url: '/api/v1/learning/items?kind=briefing', headers: auth(editor) })
    ).json();
    expect(listMgr.items.some((x: { id: string }) => x.id === item.id)).toBe(true);
  });
  it('patches an item and keeps the audit trail', async () => {
    const item = await createItem('quiz');
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/learning/items/${item.id}`,
      headers: auth(editor),
      payload: { title: 'בוחן ניתוק גלישה', passMark: 60, estimatedMinutes: 5 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ title: 'בוחן ניתוק גלישה', passMark: 60, estimatedMinutes: 5 });
    const a = await db.pool.query(
      `select action, after from audit_log where entity_type='learning_item' and entity_id=$1 and action='learning.patch'`,
      [item.id],
    );
    expect(a.rows[0].after).toMatchObject({ title: 'בוחן ניתוק גלישה', passMark: 60 });
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/learning/items/${item.id}`,
          headers: auth(agent),
          payload: { title: 'x' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('sanitizes the description on create and on patch', async () => {
    // `learning_items.description` is the one wave 5 HTML column: `ItemPreview.tsx` renders it
    // with `dangerouslySetInnerHTML`. Same ruling as wave 4's C-C2 — the repo cleans it, so no
    // route can forget. `<script>`'s whole subtree goes (it is in the sanitizer's DROP set) and
    // `onclick` is not in the `p` attribute allowlist, so both halves of this payload disappear.
    const dirty = '<p onclick="x()">a<script>alert(1)</script></p>';
    const created = await createItem('quiz', editor, { description: dirty });
    expect(created.description).toBe('<p>a</p>');

    const clean = await createItem('briefing');
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/learning/items/${clean.id}`,
      headers: auth(editor),
      payload: { description: dirty },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().description).toBe('<p>a</p>');

    // The column itself, not just the serialized response: a later reader of the row — the
    // publish snapshot among them — must not be the one that has to remember to clean.
    const stored = await db.pool.query('select id, description from learning_items where id = any($1)', [
      [created.id, clean.id],
    ]);
    for (const row of stored.rows) expect(row.description).toBe('<p>a</p>');
  });
  it('denies authoring without learning.manage and publishing without learning.publish', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/learning/items',
          headers: auth(agent),
          payload: { kind: 'quiz', title: 'x' },
        })
      ).statusCode,
    ).toBe(403);
    const item = await createItem('quiz');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/learning/items/${item.id}/publish`,
          headers: auth(editor),
          payload: { label: 'v1' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('rejects references to unpublished documents and unknown steps', async () => {
    const item = await createItem('briefing');
    const r1 = await app.inject({
      method: 'PUT',
      url: `/api/v1/learning/items/${item.id}/entries`,
      headers: auth(editor),
      payload: { entries: [{ documentId: draftDoc }] },
    });
    expect(r1.statusCode).toBe(400);
    expect(r1.json().code).toBe('DOCUMENT_NOT_PUBLISHED');
    expect(r1.json().details.documentId).toBe(draftDoc);
    const r2 = await app.inject({
      method: 'PUT',
      url: `/api/v1/learning/items/${item.id}/entries`,
      headers: auth(editor),
      payload: { entries: [{ documentId: pubDoc, stepKey: 'nope' }] },
    });
    expect(r2.json().code).toBe('UNKNOWN_STEP');
  });
  it('generates questions from rules when no model is available', async () => {
    const item = await createItem('quiz');
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/learning/items/${item.id}/generate`,
      headers: auth(editor),
      payload: { documentIds: [pubDoc], perDocument: 5 },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.source).toBe('rules');
    expect(body.questions.length).toBeGreaterThanOrEqual(3);
    expect(body.questions[0].stem).toContain('סוג מכשיר');
    expect(body.questions.every((q: { generated: boolean }) => q.generated)).toBe(true);
    const bad = await app.inject({
      method: 'POST',
      url: `/api/v1/learning/items/${item.id}/generate`,
      headers: auth(editor),
      payload: { documentIds: [draftDoc] },
    });
    expect(bad.json().code).toBe('DOCUMENT_NOT_PUBLISHED');
  });
  it('refuses an open question: `free` is in the schema and in no surface', async () => {
    const item = await createItem('quiz');
    const r = await app.inject({
      method: 'PUT',
      url: `/api/v1/learning/items/${item.id}/questions`,
      headers: auth(editor),
      payload: {
        questions: [{ documentId: pubDoc, stem: 'ספרו במילים שלכם', kind: 'free', options: [] }],
      },
    });
    expect(r.statusCode, r.body).toBe(400);
    expect(r.json().code).toBe('UNSUPPORTED_KIND');
    // Nothing was written: a refused save leaves the item as it was.
    expect(
      (await db.pool.query('select count(*)::int n from quiz_questions where item_id=$1', [item.id])).rows[0]
        .n,
    ).toBe(0);
  });

  it('validates quiz questions on save', async () => {
    const item = await createItem('quiz');
    const r = await app.inject({
      method: 'PUT',
      url: `/api/v1/learning/items/${item.id}/questions`,
      headers: auth(editor),
      payload: {
        questions: [
          {
            documentId: pubDoc,
            stepKey: 's1',
            stem: 'מה?',
            kind: 'single',
            options: [
              { id: 'o1', text: 'א', correct: false },
              { id: 'o2', text: 'ב', correct: false },
            ],
          },
        ],
      },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('INVALID_QUIZ');
  });
  it('publishes with a snapshot that pins document versions and defaults the pass mark', async () => {
    const item = await createItem('quiz');
    await app.inject({
      method: 'PUT',
      url: `/api/v1/learning/items/${item.id}/questions`,
      headers: auth(editor),
      payload: {
        questions: [
          {
            documentId: pubDoc,
            stepKey: 's1',
            stem: 'מה בודקים?',
            kind: 'single',
            options: [
              { id: 'o1', text: 'חסימה', correct: true },
              { id: 'o2', text: 'APN', correct: false },
            ],
            explanation: 'כי כן',
          },
        ],
      },
    });
    const pub = await app.inject({
      method: 'POST',
      url: `/api/v1/learning/items/${item.id}/publish`,
      headers: auth(lead),
      payload: { label: 'גרסה 1' },
    });
    expect(pub.statusCode).toBe(200);
    const { item: published, version } = pub.json();
    expect(version).toBe(1);
    expect(published.status).toBe('published');
    expect(published.passMark).toBe(80);
    expect(published.maxAttempts).toBeNull();
    expect(published.sourceVersions).toEqual([{ documentId: pubDoc, version: 1 }]);
    const versions = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/learning/items/${item.id}/versions`,
        headers: auth(agent),
      })
    ).json();
    expect(versions.items[0]).toMatchObject({
      version: 1,
      label: 'גרסה 1',
      sourceVersions: [{ documentId: pubDoc, version: 1 }],
    });
    // learners see the snapshot, without correct flags
    const prev = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/learning/items/${item.id}/preview`,
        headers: auth(agent),
      })
    ).json();
    expect(prev.item.id).toBe(item.id);
    expect(prev.questions[0].options[0]).toEqual({ id: 'o1', text: 'חסימה' });
    /**
     * A-C1: and the *authoring* view is not the escape hatch. `learning.read` is the agent role's
     * permission and a published item is visible to them, so `GET /learning/items/:id` used to
     * hand out `correct: true` — the whole answer key, one request before attempt #1.
     */
    const asAgent = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/learning/items/${item.id}`,
        headers: auth(agent),
      })
    ).json();
    expect(asAgent.questions[0].options.map((o: { correct: boolean }) => o.correct)).toEqual([false, false]);
    expect(asAgent.questions[0].explanation).toBe('');
    expect(asAgent.questions[0].generated).toBe(false);
    expect(asAgent.questions[0].modelConf).toBeNull();
    // The manager building it still sees everything.
    const asManager = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/learning/items/${item.id}`,
        headers: auth(editor),
      })
    ).json();
    expect(asManager.questions[0].options.map((o: { correct: boolean }) => o.correct)).toEqual([true, false]);
    expect(asManager.questions[0].explanation).toBe('כי כן');
    // republish after editing a document bumps the pinned version
    const doc = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${pubDoc}`, headers: auth(lead) })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${pubDoc}/structure`,
      headers: { ...auth(lead), 'if-match': doc.etag },
      payload: branchStructure,
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${pubDoc}/publish`,
      headers: auth(lead),
      payload: { label: 'v2' },
    });
    const pub2 = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/learning/items/${item.id}/publish`,
        headers: auth(lead),
        payload: { label: 'גרסה 2' },
      })
    ).json();
    expect(pub2.item.sourceVersions).toEqual([{ documentId: pubDoc, version: 2 }]);
  });
  it('refuses to publish an empty briefing and an archived item', async () => {
    const item = await createItem('briefing');
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/learning/items/${item.id}/publish`,
      headers: auth(lead),
      payload: { label: 'x' },
    });
    expect(r.json().code).toBe('EMPTY_BRIEFING');
    await app.inject({
      method: 'PUT',
      url: `/api/v1/learning/items/${item.id}/entries`,
      headers: auth(editor),
      payload: { entries: [{ documentId: pubDoc, note: 'קרא בעיון' }] },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/learning/items/${item.id}/publish`,
      headers: auth(lead),
      payload: { label: 'x' },
    });
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/learning/items/${item.id}`,
          headers: auth(editor),
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/learning/items/${item.id}`,
          headers: auth(editor),
        })
      ).json().status,
    ).toBe('archived');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/learning/items/${item.id}/publish`,
          headers: auth(lead),
          payload: { label: 'y' },
        })
      ).json().code,
    ).toBe('ITEM_ARCHIVED');
  });
  it('flags needsUpdate when a referenced document becomes invalid', async () => {
    const d = await createDoc(minimalStructure, true);
    const item = await createItem('briefing');
    await app.inject({
      method: 'PUT',
      url: `/api/v1/learning/items/${item.id}/entries`,
      headers: auth(editor),
      payload: { entries: [{ documentId: d }] },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${d}/status`,
      headers: auth(lead),
      payload: { status: 'invalid', reason: 'הוחלף' },
    });
    const got = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/learning/items/${item.id}`,
        headers: auth(editor),
      })
    ).json();
    expect(got.needsUpdate).toBe(true);
  });
  it('applies world scope to managers', async () => {
    const techItem = await createItem('briefing', editor, { worldSlug: 'tech' });
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/learning/items/${techItem.id}`,
      headers: auth(scopedEditor),
    });
    expect(r.statusCode).toBe(404);
    const c = await app.inject({
      method: 'POST',
      url: '/api/v1/learning/items',
      headers: auth(scopedEditor),
      payload: { kind: 'quiz', title: 'x', worldSlug: 'tech' },
    });
    expect(c.statusCode).toBe(403);
    const list = (
      await app.inject({ method: 'GET', url: '/api/v1/learning/items', headers: auth(scopedEditor) })
    ).json();
    expect(list.items.some((x: { id: string }) => x.id === techItem.id)).toBe(false);
  });
});
