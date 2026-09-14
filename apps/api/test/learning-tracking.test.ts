import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth, minimalStructure } from './helpers/fixtures.js';
import { ensureLearningTables, seedQuiz, seedBriefing } from './helpers/v2/learningStub.js';
import * as port from '../src/modules/learning/tracking/itemsPort.js';

const run = integration ? describe : describe.skip;

run('learning tracking', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let manager: Awaited<ReturnType<typeof makeUser>>;
  let agentA: Awaited<ReturnType<typeof makeUser>>;
  let agentB: Awaited<ReturnType<typeof makeUser>>;
  let docId: string;
  let quizId: string;
  let briefingId: string;
  let quizQuestionIds: string[] = [];

  const createDoc = async (title = 'מסמך למידה') => {
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(manager),
        payload: { title, category: 'tech', wave: 1, priority: 'm', kind: 'steps' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${c.id}/structure`,
      headers: { ...auth(manager), 'if-match': c.etag },
      payload: minimalStructure,
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${c.id}/publish`,
      headers: auth(manager),
      payload: { label: 'v1' },
    });
    return c.id as string;
  };

  /** Gives a user the named system role scoped to worlds (null = all). */
  const grantRole = async (userId: string, role: string, worlds: string[] | null) => {
    await db.pool.query(
      `insert into user_roles(user_id, role_id, world_scope) select $1, id, $3 from roles where name=$2
         on conflict (user_id, role_id) do update set world_scope = excluded.world_scope`,
      [userId, role, worlds],
    );
  };

  beforeAll(async () => {
    db = await startTestDb();
    await ensureLearningTables(db.pool);
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    manager = await makeUser(db.pool, { name: 'מנהלת' });
    agentA = await makeUser(db.pool, {
      perms: ['docs.read', 'learning.read'],
      scopes: ['tech'],
      name: 'נציג א',
    });
    agentB = await makeUser(db.pool, {
      perms: ['docs.read', 'learning.read'],
      scopes: ['billing'],
      name: 'נציג ב',
    });
    await grantRole(agentA.id, 'agent', ['tech']);
    await grantRole(agentB.id, 'agent', ['billing']);
    docId = await createDoc();
    quizId = await seedQuiz(db.pool, {
      documentId: docId,
      title: 'חידון SIM',
      worldSlug: 'tech',
      passMark: 80,
      maxAttempts: null,
      questions: [
        {
          stem: 'מה עושים קודם?',
          kind: 'single',
          options: [
            { id: 'a', text: 'מאפסים', correct: true },
            { id: 'b', text: 'מנתקים', correct: false },
          ],
          explanation: 'איפוס תחילה',
        },
        {
          stem: 'אילו שדות נבדקים?',
          kind: 'multi',
          options: [
            { id: 'x', text: 'IMSI', correct: true },
            { id: 'y', text: 'APN', correct: true },
            { id: 'z', text: 'PUK', correct: false },
          ],
          explanation: '',
        },
      ],
    });
    quizQuestionIds = (
      await db.pool.query('select id from quiz_questions where item_id=$1 order by position', [quizId])
    ).rows.map((r) => r.id as string);
    briefingId = await seedBriefing(db.pool, {
      documentIds: [docId],
      title: 'תדריך SIM',
      worldSlug: 'tech',
    });
  }, 120000);

  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  it('port reads published items, their questions and pinned source versions', async () => {
    const got = await port.getPublishedItem(db.pool, quizId);
    expect(got?.item.kind).toBe('quiz');
    expect(got?.version).toBe(1);
    expect(got?.sourceVersions).toEqual([{ documentId: docId, version: 1 }]);
    const qs = await port.itemQuestions(db.pool, quizId);
    expect(qs).toHaveLength(2);
    expect(qs[0].options.find((o) => o.id === 'a')?.correct).toBe(true);
    const pins = await port.itemSourceVersions(db.pool, quizId, 1);
    expect(pins).toEqual([{ documentId: docId, version: 1 }]);
    expect(await port.listItemsReferencing(db.pool, docId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemId: quizId, kind: 'quiz', status: 'published', currentVersion: 1 }),
        expect.objectContaining({ itemId: briefingId, kind: 'briefing' }),
      ]),
    );
    expect(await port.needsUpdate(db.pool, [quizId])).toEqual(new Map([[quizId, false]]));
    expect((await port.documentSnapshotFor(db.pool, briefingId, 1))[0]).toMatchObject({
      documentId: docId,
      changedSinceAssigned: false,
    });
  });
});
