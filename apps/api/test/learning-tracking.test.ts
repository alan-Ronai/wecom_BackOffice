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

  /**
   * The document the learning items point at. Five steps, not `minimalStructure`'s two: the
   * detector's "more than 40% of the steps changed" rule would otherwise fire on every
   * single-step edit, and a non-significant publish would be impossible to express.
   */
  const structure = {
    phases: [
      {
        ...minimalStructure.phases[0],
        steps: [
          ...minimalStructure.phases[0].steps,
          {
            key: 's3',
            num: '3',
            title: 'בדיקת כיסוי באזור',
            actions: [{ id: 'a1', text: 'מפת כיסוי ↗ הזן כתובת' }],
            outcomes: [{ kind: 'ok', text: '✓ כיסוי תקין' }],
          },
          {
            key: 's4',
            num: '4',
            title: 'איפוס הגדרות רשת',
            actions: [{ id: 'a1', text: 'הנחה את הלקוח לאפס הגדרות רשת' }],
            outcomes: [{ kind: 'ok', text: '✓ אופס' }],
          },
          {
            key: 's5',
            num: '5',
            title: 'פתיחת תקלה',
            actions: [{ id: 'a1', text: 'פתח תקלה במערכת' }],
            outcomes: [{ kind: 'ok', text: '✓ סיום' }],
          },
        ],
      },
    ],
  };

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
      payload: structure,
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
    const mine = (
      await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentA) })
    ).json();
    expect(mine.open).toHaveLength(1);
    expect(mine.open[0]).toMatchObject({
      itemId: quizId,
      kind: 'quiz',
      title: 'חידון SIM',
      reason: 'audience',
      maxAttempts: null,
      passMark: 80,
    });
    const other = (
      await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentB) })
    ).json();
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
    const other = (
      await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentB) })
    ).json();
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
    const mine = (
      await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentA) })
    ).json();
    const aid = (mine.open as { itemId: string; reason: string; id: string }[]).find(
      (a) => a.itemId === quizId && a.reason === 'audience',
    )!.id;
    const p = (
      await app.inject({ method: 'GET', url: `/api/v1/learning/my/${aid}`, headers: auth(agentA) })
    ).json();
    expect(p.item.kind).toBe('quiz');
    expect(p.questions).toHaveLength(2);
    expect(p.questions[0].options[0]).not.toHaveProperty('correct');
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/learning/my/${aid}`, headers: auth(agentB) }))
        .statusCode,
    ).toBe(404);
  });

  it('quiz attempts: wrong then right; unlimited retakes; completion on pass', async () => {
    const mine = (
      await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentA) })
    ).json();
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
    const after = (
      await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentA) })
    ).json();
    expect((after.completed as { id: string }[]).find((a) => a.id === aid)).toMatchObject({
      id: aid,
      status: 'completed',
      attemptsUsed: 2,
      lastScore: 100,
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/learning/my/${aid}/attempts`,
          headers: auth(agentA),
        })
      ).statusCode,
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
    const mine = (
      await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentB) })
    ).json();
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
    const mine = (
      await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentA) })
    ).json();
    const b = (mine.open as { itemId: string; id: string }[]).find((a) => a.itemId === briefingId)!;
    const p = (
      await app.inject({ method: 'GET', url: `/api/v1/learning/my/${b.id}`, headers: auth(agentA) })
    ).json();
    expect(p.entries[0]).toMatchObject({ documentId: docId, changedSinceAssigned: false });
    expect(p.entries[0].phases.length).toBeGreaterThan(0);
    const ack = await app.inject({
      method: 'POST',
      url: `/api/v1/learning/my/${b.id}/acknowledge`,
      headers: auth(agentA),
    });
    expect(ack.json().status).toBe('completed');
    const quizAssignment = (mine.open as { itemId: string; id: string }[]).find(
      (a) => a.itemId === quizId,
    )!.id;
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

  it('nightly re-resolution assigns a user who joined the audience later', async () => {
    const { resolveAllAudiences } = await import('../src/modules/learning/tracking/audiences.js');
    // Widened, not replaced: agent B stays a billing agent and becomes a tech one too.
    await grantRole(agentB.id, 'agent', ['billing', 'tech']);
    const r = await resolveAllAudiences({
      db: db.pool,
      notifier: app.notifier,
      events: app.events,
      log: app.log,
    });
    expect(r.assigned).toBeGreaterThanOrEqual(1);
    const mine = (
      await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentB) })
    ).json();
    expect(
      [...mine.open, ...mine.completed].some(
        (a: { itemId: string; reason: string }) => a.itemId === quizId && a.reason === 'audience',
      ),
    ).toBe(true);
  });

  it('reminders mark overdue and notify once', async () => {
    const { runReminders } = await import('../src/modules/learning/tracking/jobs.js');
    const { getWorkflowSettings } = await import('../src/lib/workflowSettings.js');
    const late = await seedBriefing(db.pool, {
      documentIds: [docId],
      title: 'תדריך באיחור',
      worldSlug: null,
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/learning/items/${late}/assign`,
      headers: auth(manager),
      payload: { userIds: [agentB.id], dueDays: 1 },
    });
    await db.pool.query(
      `update learning_assignments set due_at = now() - interval '2 days' where item_id=$1`,
      [late],
    );
    const before = (
      await db.pool.query(`select count(*)::int n from notifications where user_id=$1 and kind='learning'`, [
        agentB.id,
      ])
    ).rows[0].n as number;
    const settings = await getWorkflowSettings(db.pool);
    const deps = { db: db.pool, notifier: app.notifier, events: app.events, log: app.log };
    const r1 = await runReminders(deps, settings);
    expect(r1.overdue).toBeGreaterThanOrEqual(1);
    const r2 = await runReminders(deps, settings);
    expect(r2.reminded).toBe(0);
    const after = (
      await db.pool.query(`select count(*)::int n from notifications where user_id=$1 and kind='learning'`, [
        agentB.id,
      ])
    ).rows[0].n as number;
    expect(after - before).toBe(1);
    const mine = (
      await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentB) })
    ).json();
    expect(mine.overdue.some((a: { itemId: string }) => a.itemId === late)).toBe(true);
  });

  /** Re-publishes the document from the pristine structure plus one mutation. */
  const republish = async (mutate: (s: typeof structure) => unknown, body: Record<string, unknown> = {}) => {
    const cur = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}`, headers: auth(manager) })
    ).json();
    const s = JSON.parse(JSON.stringify(structure)) as typeof structure;
    const payload = mutate(s) ?? s;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/structure`,
      headers: { ...auth(manager), 'if-match': cur.etag },
      payload,
    });
    return (
      await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${docId}/publish`,
        headers: auth(manager),
        payload: { label: 'עדכון', ...body },
      })
    ).json();
  };

  it('a non-significant publish flags nothing and creates no refresh work', async () => {
    const r = await republish((s) => {
      s.phases[0].steps[0].title = 'כותרת חדשה';
    });
    expect(r.changeFlag).toMatchObject({ significant: false, refreshAssignments: 0 });
    const flags = await db.pool.query(
      `select significant from document_change_flags where document_id=$1 order by version desc limit 1`,
      [docId],
    );
    expect(flags.rows[0].significant).toBe(false);
  });

  it('a significant publish invalidates completions and assigns a refresh with a due date', async () => {
    const r = await republish((s) => {
      s.phases[0].steps[0].outcomes = [{ kind: 'alert', text: 'עצור והסלם' }];
    });
    expect(r.changeFlag.significant).toBe(true);
    expect(r.changeFlag.reasons.join(' ')).toMatch(/תוצאה/);
    expect(r.changeFlag.affectedItems).toBeGreaterThanOrEqual(2);
    const mine = (
      await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentA) })
    ).json();
    expect(mine.invalidated.some((a: { itemId: string }) => a.itemId === quizId)).toBe(true);
    const refresh = (
      mine.open as {
        id: string;
        itemId: string;
        reason: string;
        dueAt: string;
        refreshReason: string | null;
      }[]
    ).find((a) => a.itemId === quizId && a.reason === 'refresh');
    expect(refresh).toBeTruthy();
    expect(refresh!.refreshReason).toMatch(/שינוי מהותי/);
    const days = (new Date(refresh!.dueAt).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThanOrEqual(7.01);
    expect((await port.needsUpdate(db.pool, [quizId])).get(quizId)).toBe(true);
    const stored = await db.pool.query(
      `select answers from learning_attempts where finished_at is not null order by finished_at desc limit 1`,
    );
    expect(
      Object.values(stored.rows[0].answers as Record<string, { correct: boolean }>).every(
        (v) => typeof v.correct === 'boolean',
      ),
    ).toBe(true);
    const dl = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/learning`, headers: auth(agentA) })
    ).json();
    expect(dl.refreshRequired).toBe(true);
    expect(
      (mine.open as { id: string; reason: string }[]).filter((a) => a.reason === 'refresh').map((a) => a.id),
    ).toContain(dl.refreshAssignmentId);
    expect(dl.items.find((i: { id: string }) => i.id === quizId)?.needsUpdate).toBe(true);
    expect(dl.lastSignificantChange.reasons.length).toBeGreaterThan(0);
  });

  it('a second significant publish re-points the open refresh instead of stacking one', async () => {
    const openBefore = (
      await db.pool.query(
        `select count(*)::int n from learning_assignments where reason='refresh' and status in ('open','overdue')`,
      )
    ).rows[0].n as number;
    const r = await republish((s) => {
      s.phases[0].steps[1].outcomes = [{ kind: 'alert', text: 'עצור גם כאן' }];
    });
    expect(r.changeFlag.significant).toBe(true);
    const openAfter = (
      await db.pool.query(
        `select count(*)::int n from learning_assignments where reason='refresh' and status in ('open','overdue')`,
      )
    ).rows[0].n as number;
    expect(openAfter).toBe(openBefore);
    const mine = (
      await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentA) })
    ).json();
    const refresh = (mine.open as { itemId: string; reason: string; refreshReason: string }[]).find(
      (a) => a.itemId === quizId && a.reason === 'refresh',
    )!;
    expect(refresh.refreshReason).toContain(`גרסה ${r.version}`);
  });

  it('the publish dialog override wins in both directions', async () => {
    const forced = await republish(
      (s) => {
        s.phases[0].steps[0].title = 'שינוי קטן נוסף';
      },
      { significantChange: true },
    );
    expect(forced.changeFlag.significant).toBe(true);
    expect(forced.changeFlag.reasons).toContain('סומן כשינוי מהותי על ידי העורך');
    const suppressed = await republish(
      (s) => {
        s.phases[0].steps[0].outcomes = [{ kind: 'ok', text: 'סיום' }];
      },
      { significantChange: false },
    );
    expect(suppressed.changeFlag).toMatchObject({ significant: false, refreshAssignments: 0 });
  });

  it('completion and dashboard are world-scoped for managers', async () => {
    const billingLead = await makeUser(db.pool, { scopes: ['billing'], name: 'ראש צוות חיובים' });
    const c = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/learning/items/${quizId}/completion`,
        headers: auth(billingLead),
      })
    ).json();
    expect(c.rows.length).toBeGreaterThanOrEqual(1);
    expect(c.rows.every((r: { worldSlugs: string[] }) => r.worldSlugs.includes('billing'))).toBe(true);
    const d = (
      await app.inject({ method: 'GET', url: '/api/v1/learning/dashboard', headers: auth(billingLead) })
    ).json();
    expect(d.totals.assigned).toBeGreaterThanOrEqual(1);
    const all = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/learning/dashboard?world=tech',
        headers: auth(manager),
      })
    ).json();
    expect(all.totals.assigned).toBeGreaterThanOrEqual(1);
    const unscoped = (
      await app.inject({ method: 'GET', url: '/api/v1/learning/dashboard', headers: auth(manager) })
    ).json();
    expect(unscoped.totals.assigned).toBeGreaterThanOrEqual(d.totals.assigned);
  });

  it('deleting an audience leaves the assignments it already made', async () => {
    const before = (
      await db.pool.query(`select count(*)::int n from learning_assignments where audience_id=$1`, [
        audienceId,
      ])
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
      (await app.inject({ method: 'GET', url: '/api/v1/learning/dashboard', headers: auth(agentA) }))
        .statusCode,
    ).toBe(403);
    const noLearning = await makeUser(db.pool, { perms: ['docs.read'] });
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(noLearning) })).statusCode,
    ).toBe(403);
  });
});
