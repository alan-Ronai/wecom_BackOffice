import { DEFAULT_ROLES } from '@wecom/shared';
import { startTestDb, type TestDb } from '../db.js';
import { buildTestApp } from '../app.js';
import { auth, makeUser, type TestUser } from '../fixtures.js';

/**
 * The fixture every X2 integration test file shares: an app, four callers at the three AI
 * tiers, a published `tech` document with a source document, and a `billing` draft carrying a
 * string that must never appear in a chat answer.
 */
export const SECRET = 'סודי לחיובים בלבד';

export interface AiFixture {
  db: TestDb;
  app: Awaited<ReturnType<typeof buildTestApp>>;
  admin: TestUser;
  /** `ai.ask` only — the agent tier. */
  agent: TestUser;
  /** Editor perms + `ai.chat`, scoped to the `tech` world. */
  editor: TestUser;
  /** A second editor, so "someone else's conversation" is testable. */
  otherEditor: TestUser;
  techDoc: string;
  billingDraft: string;
  /** A pending suggestion on `techDoc`, type `update-step`. */
  suggestionId: string;
  post: (url: string, payload: unknown, u?: TestUser) => ReturnType<AiFixture['app']['inject']>;
  get: (url: string, u?: TestUser) => ReturnType<AiFixture['app']['inject']>;
  close: () => Promise<void>;
}

const SOURCE_HTML =
  '<h2>אין גלישה</h2><p>בדוק חסימת גלישה בכרטיס הלקוח.</p><p>אם החבילה נגמרה, הצע חבילה נוספת.</p>';

export async function makeAiFixture(): Promise<AiFixture> {
  const db = await startTestDb();
  const app = await buildTestApp(db.pool, db.url);
  await app.events.start(db.url);

  const admin = await makeUser(db.pool, { name: 'מנהלת' });
  const agent = await makeUser(db.pool, { name: 'נציג', perms: DEFAULT_ROLES.agent });
  const editor = await makeUser(db.pool, {
    name: 'עורכת',
    perms: DEFAULT_ROLES.editor,
    scopes: ['tech'],
  });
  const otherEditor = await makeUser(db.pool, {
    name: 'עורך אחר',
    perms: DEFAULT_ROLES.editor,
    scopes: ['tech'],
  });

  const post = (url: string, payload: unknown, u: TestUser = admin) =>
    app.inject({ method: 'POST', url, headers: auth(u), payload });
  const get = (url: string, u: TestUser = editor) =>
    app.inject({ method: 'GET', url, headers: auth(u) });

  const makeDoc = async (title: string, category: string) => {
    const r = await post('/api/v1/documents', {
      title,
      description: '',
      category,
      wave: 1,
      priority: 'm',
      kind: 'steps',
    });
    if (r.statusCode !== 201 && r.statusCode !== 200)
      throw new Error(`create ${title}: ${r.statusCode} ${r.body}`);
    return r.json().id as string;
  };

  const putStructure = async (id: string, stepTitle: string, actionText: string) => {
    const etag = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${id}`, headers: auth(admin) })
    ).headers.etag as string;
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
                title: stepTitle,
                blockRefs: [],
                deps: [],
                actions: [{ id: 'a1', text: actionText }],
                outcomes: [{ kind: 'ok', text: '✓ המשך לשלב 2', goto: 's2' }],
              },
              {
                key: 's2',
                num: '2',
                title: 'בדיקת חבילה',
                blockRefs: [],
                deps: [],
                actions: [{ id: 'a1', text: 'אפס APN' }],
                outcomes: [{ kind: 'ok', text: '✓ סיום' }],
              },
            ],
          },
        ],
      },
    });
    if (r.statusCode !== 200) throw new Error(`structure ${id}: ${r.statusCode} ${r.body}`);
  };

  const techDoc = await makeDoc('אין גלישה', 'tech');
  await putStructure(techDoc, 'בדיקת חסימה', 'פתח CRM ובדוק חסימת גלישה');
  const published = await post(`/api/v1/documents/${techDoc}/publish`, { label: 'פרסום ראשון' });
  if (published.statusCode !== 200) throw new Error(`publish: ${published.statusCode} ${published.body}`);

  const source = await app.inject({
    method: 'PUT',
    url: `/api/v1/documents/${techDoc}/source`,
    headers: auth(admin),
    payload: { html: SOURCE_HTML, label: 'מקור' },
  });
  if (source.statusCode !== 200) throw new Error(`source: ${source.statusCode} ${source.body}`);

  const billingDraft = await makeDoc(SECRET, 'billing');
  await putStructure(billingDraft, 'בדיקת חיוב', `בדוק ${SECRET}`);

  /**
   * A pending suggestion on `techDoc`. Inserted directly rather than produced by the pipeline:
   * what `refine_suggestion` is under test for is the second model call and its validation, not
   * the proposal engine that made the row.
   */
  const revision = (
    await db.pool.query(
      'select id from source_revisions order by imported_at desc limit 1',
    )
  ).rows[0].id as string;
  const suggestionId = (
    await db.pool.query(
      `insert into suggestions(source_revision_id, anchor, type, title, target_document_id, target_step_key, payload, confidence, rationale)
       values ($1, 'h2-1', 'update-step', 'עדכון שלב 1', $2, 's1', $3, 0.8, 'בדיקה') returning id`,
      [
        revision,
        techDoc,
        JSON.stringify({ type: 'update-step', addActions: ['בדוק גם את סוג החבילה'], patch: {} }),
      ],
    )
  ).rows[0].id as string;

  return {
    db,
    app,
    admin,
    agent,
    editor,
    otherEditor,
    techDoc,
    billingDraft,
    suggestionId,
    post,
    get,
    close: async () => {
      await app.close();
      await db.stop();
    },
  };
}
