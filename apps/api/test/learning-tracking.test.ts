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
  let audienceId: string;

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

  it('an audience of agents in tech resolves to agent A only, assigns, and alerts', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/learning/items/${quizId}/audiences`,
      headers: auth(manager),
      payload: { roleNames: ['agent'], worldSlugs: ['tech'], userIds: [], dueDays: 5 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().resolvedUsers).toBe(1);
    audienceId = r.json().id as string;
    const mine = (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentA) })).json();
    expect(mine.open).toHaveLength(1);
    expect(mine.open[0]).toMatchObject({
      itemId: quizId,
      kind: 'quiz',
      title: 'חידון SIM',
      reason: 'audience',
      maxAttempts: null,
      passMark: 80,
    });
    const other = (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentB) })).json();
    expect(other.open).toHaveLength(0);
    const n = await db.pool.query(
      `select kind, href from notifications where user_id=$1 order by created_at desc limit 1`,
      [agentA.id],
    );
    expect(n.rows[0]?.kind).toBe('learning');
    expect(n.rows[0]?.href).toMatch(/^\/learning\//);
  });

  it('manual assign reaches users outside the audience and is idempotent', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/learning/items/${quizId}/assign`,
      headers: auth(manager),
      payload: { userIds: [agentA.id, agentB.id], dueDays: 3 },
    });
    // `reason` is part of the unique key, so agent A's audience row does not block a manual one.
    expect(r.json()).toEqual({ assigned: 2, skipped: 0 });
    const other = (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentB) })).json();
    expect(other.open[0]).toMatchObject({ itemId: quizId, reason: 'manual' });
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/learning/items/${quizId}/assign`,
      headers: auth(manager),
      payload: { userIds: [agentA.id, agentB.id], dueDays: 3 },
    });
    expect(again.json()).toEqual({ assigned: 0, skipped: 2 });
  });

  it('player payload hides correct flags and is visible to its owner only', async () => {
    const mine = (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentA) })).json();
    const aid = (mine.open as { itemId: string; reason: string; id: string }[]).find(
      (a) => a.itemId === quizId && a.reason === 'audience',
    )!.id;
    const p = (await app.inject({ method: 'GET', url: `/api/v1/learning/my/${aid}`, headers: auth(agentA) })).json();
    expect(p.item.kind).toBe('quiz');
    expect(p.questions).toHaveLength(2);
    expect(p.questions[0].options[0]).not.toHaveProperty('correct');
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/learning/my/${aid}`, headers: auth(agentB) })).statusCode,
    ).toBe(404);
  });

  it('quiz attempts: wrong then right; unlimited retakes; completion on pass', async () => {
    const mine = (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentA) })).json();
    const aid = (mine.open as { itemId: string; reason: string; id: string }[]).find(
      (a) => a.itemId === quizId && a.reason === 'audience',
    )!.id;
    const s1 = (
      await app.inject({ method: 'POST', url: `/api/v1/learning/my/${aid}/attempts`, headers: auth(agentA) })
    ).json();
    expect(s1).toEqual({ attemptId: expect.any(String), attemptNo: 1 });
    const r1 = (
      await app.inject({
        method: 'PUT',
        url: `/api/v1/learning/attempts/${s1.attemptId}`,
        headers: auth(agentA),
        payload: {
          answers: [
            { questionId: quizQuestionIds[0], optionIds: ['a'] },
            { questionId: quizQuestionIds[1], optionIds: ['z'] },
          ],
        },
      })
    ).json();
    expect(r1).toMatchObject({ score: 50, passed: false, attemptsLeft: null });
    expect(r1.perQuestion[1].correctOptionIds.sort()).toEqual(['x', 'y']);
    const s2 = (
      await app.inject({ method: 'POST', url: `/api/v1/learning/my/${aid}/attempts`, headers: auth(agentA) })
    ).json();
    expect(s2.attemptNo).toBe(2);
    const r2 = (
      await app.inject({
        method: 'PUT',
        url: `/api/v1/learning/attempts/${s2.attemptId}`,
        headers: auth(agentA),
        payload: {
          answers: [
            { questionId: quizQuestionIds[0], optionIds: ['a'] },
            { questionId: quizQuestionIds[1], optionIds: ['x', 'y'] },
          ],
        },
      })
    ).json();
    expect(r2).toMatchObject({ score: 100, passed: true });
    const after = (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentA) })).json();
    expect((after.completed as { id: string }[]).find((a) => a.id === aid)).toMatchObject({
      id: aid,
      status: 'completed',
      attemptsUsed: 2,
      lastScore: 100,
    });
    expect(
      (await app.inject({ method: 'POST', url: `/api/v1/learning/my/${aid}/attempts`, headers: auth(agentA) }))
        .statusCode,
    ).toBe(409);
  });

  it('a capped quiz refuses the attempt after the cap', async () => {
    const capped = await seedQuiz(db.pool, {
      documentId: docId,
      title: 'חידון מוגבל',
      worldSlug: 'tech',
      passMark: 100,
      maxAttempts: 1,
      questions: [
        {
          stem: 'ש',
          kind: 'single',
          options: [
            { id: 'a', text: 'A', correct: true },
            { id: 'b', text: 'B', correct: false },
          ],
        },
      ],
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/learning/items/${capped}/assign`,
      headers: auth(manager),
      payload: { userIds: [agentB.id] },
    });
    const mine = (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentB) })).json();
    const aid = (mine.open as { itemId: string; id: string }[]).find((a) => a.itemId === capped)!.id;
    const qid = (await db.pool.query(`select id from quiz_questions where item_id=$1`, [capped])).rows[0]
      .id as string;
    const start = await app.inject({
      method: 'POST',
      url: `/api/v1/learning/my/${aid}/attempts`,
      headers: auth(agentB),
    });
    expect(start.statusCode).toBe(201);
    const s = start.json();
    const r = (
      await app.inject({
        method: 'PUT',
        url: `/api/v1/learning/attempts/${s.attemptId}`,
        headers: auth(agentB),
        payload: { answers: [{ questionId: qid, optionIds: ['b'] }] },
      })
    ).json();
    expect(r).toMatchObject({ passed: false, attemptsLeft: 0 });
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/learning/my/${aid}/attempts`,
      headers: auth(agentB),
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('ATTEMPTS_EXHAUSTED');
  });

  it('briefings complete by acknowledgement; quizzes cannot be acknowledged', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/learning/items/${briefingId}/assign`,
      headers: auth(manager),
      payload: { userIds: [agentA.id] },
    });
    const mine = (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentA) })).json();
    const b = (mine.open as { itemId: string; id: string }[]).find((a) => a.itemId === briefingId)!;
    const p = (await app.inject({ method: 'GET', url: `/api/v1/learning/my/${b.id}`, headers: auth(agentA) })).json();
    expect(p.entries[0]).toMatchObject({ documentId: docId, changedSinceAssigned: false });
    expect(p.entries[0].phases.length).toBeGreaterThan(0);
    const ack = await app.inject({
      method: 'POST',
      url: `/api/v1/learning/my/${b.id}/acknowledge`,
      headers: auth(agentA),
    });
    expect(ack.json().status).toBe('completed');
    const quizAssignment = (mine.open as { itemId: string; id: string }[]).find((a) => a.itemId === quizId)!.id;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/learning/my/${quizAssignment}/acknowledge`,
          headers: auth(agentA),
        })
      ).statusCode,
    ).toBe(409);
  });

  it('deleting an audience leaves the assignments it already made', async () => {
    const before = (
      await db.pool.query(`select count(*)::int n from learning_assignments where audience_id=$1`, [audienceId])
    ).rows[0].n as number;
    expect(before).toBeGreaterThan(0);
    const d = await app.inject({
      method: 'DELETE',
      url: `/api/v1/learning/audiences/${audienceId}`,
      headers: auth(manager),
    });
    expect(d.statusCode).toBe(204);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/learning/audiences/${audienceId}`,
          headers: auth(manager),
        })
      ).statusCode,
    ).toBe(404);
    const kept = (
      await db.pool.query(`select count(*)::int n from learning_assignments where audience_id is null`)
    ).rows[0].n as number;
    expect(kept).toBeGreaterThan(0);
  });

  it('permission denials', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/learning/items/${quizId}/audiences`,
          headers: auth(agentA),
          payload: { roleNames: ['agent'], worldSlugs: [], userIds: [], dueDays: 3 },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/learning/dashboard', headers: auth(agentA) })).statusCode,
    ).toBe(403);
    const noLearning = await makeUser(db.pool, { perms: ['docs.read'] });
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(noLearning) })).statusCode,
    ).toBe(403);
  });
});
