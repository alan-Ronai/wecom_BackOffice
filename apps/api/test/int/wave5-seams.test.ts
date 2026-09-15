import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from '../helpers/db.js';
import { buildTestApp } from '../helpers/app.js';
import { makeUser, auth, minimalStructure } from '../helpers/fixtures.js';
import { seedQuiz } from '../helpers/v2/learningStub.js';

const run = integration ? describe : describe.skip;

/**
 * The joints between the wave 5 lanes, plus the wave-4 follow-up E-1 — each of them a link that
 * no single lane could test, because the two halves lived on different branches.
 *
 * V1 owns the learning items, V2 the assignments and the change detector, V3 the approver and the
 * gaps, and `documents/repo.ts` is wave 1's. What is asserted here is that they agree.
 */
run('wave 5 seams', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let lead: Awaited<ReturnType<typeof makeUser>>;
  let manager: Awaited<ReturnType<typeof makeUser>>;
  let agent: Awaited<ReturnType<typeof makeUser>>;

  /**
   * Five steps, not `minimalStructure`'s two: the detector's "more than 40% of the steps changed"
   * rule fires on any single-step edit of a two-step document, which makes "publish something
   * *not* significant" impossible to express.
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
            title: 'בדיקת כיסוי',
            actions: [{ id: 'a1', text: 'פתח מפת כיסוי' }],
            outcomes: [{ kind: 'ok', text: '✓ כיסוי תקין' }],
          },
          {
            key: 's4',
            num: '4',
            title: 'איפוס הגדרות רשת',
            actions: [{ id: 'a1', text: 'הנחה לאפס הגדרות' }],
            outcomes: [{ kind: 'ok', text: '✓ אופס' }],
          },
          {
            key: 's5',
            num: '5',
            title: 'פתיחת תקלה',
            actions: [{ id: 'a1', text: 'פתח תקלה' }],
            outcomes: [{ kind: 'ok', text: '✓ סיום' }],
          },
        ],
      },
    ],
  };

  /** A published document with the five-step structure above. */
  const makeDoc = async (title: string): Promise<string> => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: auth(lead),
      payload: { title, description: '', category: 'tech', wave: 1, priority: 'm', kind: 'steps' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${id}/structure`,
      headers: { ...auth(lead), 'if-match': created.json().etag as string },
      payload: structure,
    });
    expect(put.statusCode, put.body).toBe(200);
    const pub = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${id}/publish`,
      headers: auth(lead),
      payload: { label: 'v1' },
    });
    expect(pub.statusCode, pub.body).toBe(200);
    return id;
  };

  /** A connector plus one `sync_links` row in the requested state, the way a first run leaves it. */
  const linkToRemote = async (documentId: string, state: string): Promise<void> => {
    const c = await db.pool.query(
      `insert into connectors(type, name, config_encrypted) values ('wordpress','אתר תמיכה','\\x00'::bytea) returning id`,
    );
    await db.pool.query(
      `insert into sync_links(document_id, connector_id, external_id, state) values ($1,$2,$3,$4)`,
      [documentId, c.rows[0].id, 'posts:' + documentId.slice(0, 8), state],
    );
  };

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    lead = await makeUser(db.pool, { name: 'ראש צוות' });
    // Exactly `learning.manage` (plus the reads it implies) — the point of `audience-options`.
    manager = await makeUser(db.pool, {
      name: 'מנהלת למידה',
      perms: ['docs.read', 'learning.read', 'learning.manage'],
    });
    agent = await makeUser(db.pool, { name: 'נציג', perms: ['docs.read', 'learning.read'] });
  }, 180000);

  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  it('E-1: a human publish keeps the source-review flag while a sync link is in conflict', async () => {
    const id = await makeDoc('דגל סקירת מקור');
    await linkToRemote(id, 'conflict');
    await db.pool.query(
      `update documents set source_review_needed=true, source_review_reason='המקור עודכן', source_review_at=now() where id=$1`,
      [id],
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${id}/publish`,
      headers: auth(lead),
      payload: { label: 'v2' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const kept = await db.pool.query(
      'select source_review_needed, source_review_reason from documents where id=$1',
      [id],
    );
    expect(kept.rows[0].source_review_needed).toBe(true);
    // Restated from the live link state, not left as whatever raised it.
    expect(kept.rows[0].source_review_reason).toContain('קונפליקט בסנכרון');

    await db.pool.query(`update sync_links set state='synced' where document_id=$1`, [id]);
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${id}/publish`,
      headers: auth(lead),
      payload: { label: 'v3' },
    });
    expect(again.statusCode, again.body).toBe(200);
    const cleared = await db.pool.query(
      'select source_review_needed, source_review_reason from documents where id=$1',
      [id],
    );
    expect(cleared.rows[0].source_review_needed).toBe(false);
    expect(cleared.rows[0].source_review_reason).toBeNull();
  });

  it('E-1: pending_push keeps it too, and an unlinked document still clears', async () => {
    const linked = await makeDoc('ממתין לדחיפה');
    await linkToRemote(linked, 'pending_push');
    await db.pool.query(`update documents set source_review_needed=true where id=$1`, [linked]);
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${linked}/publish`,
      headers: auth(lead),
      payload: { label: 'v2' },
    });
    expect(
      (await db.pool.query('select source_review_needed from documents where id=$1', [linked])).rows[0]
        .source_review_needed,
    ).toBe(true);

    const solo = await makeDoc('ללא קישור');
    await db.pool.query(`update documents set source_review_needed=true where id=$1`, [solo]);
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${solo}/publish`,
      headers: auth(lead),
      payload: { label: 'v2' },
    });
    expect(
      (await db.pool.query('select source_review_needed from documents where id=$1', [solo])).rows[0]
        .source_review_needed,
    ).toBe(false);
  });

  it('tracking resolves items through V1 tables: GET /documents/:id/learning lists the quiz', async () => {
    const docId = await makeDoc('מסמך עם שאלון');
    const quizId = await seedQuiz(db.pool, {
      documentId: docId,
      title: 'שאלון הסמכה',
      worldSlug: 'tech',
      passMark: 80,
      maxAttempts: null,
      questions: [
        {
          stem: 'מה עושים קודם?',
          kind: 'single',
          options: [
            { id: 'a', text: 'בדיקת כיסוי', correct: true },
            { id: 'b', text: 'פתיחת תקלה', correct: false },
          ],
        },
      ],
    });
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${docId}/learning`,
      headers: auth(agent),
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().items.map((i: { id: string }) => i.id)).toContain(quizId);
    // V1 fills the card, V2 the two counters it left as placeholders.
    const card = r.json().items.find((i: { id: string }) => i.id === quizId);
    expect(card.questionCount).toBe(1);
    expect(card.assignedUsers).toBe(0);
    expect(r.json().refreshRequired).toBe(false);
  });

  it('a significant publish invalidates the completion and creates a refresh assignment', async () => {
    const docId = await makeDoc('מסמך שמשתנה מהותית');
    const quizId = await seedQuiz(db.pool, {
      documentId: docId,
      title: 'שאלון שדורש רענון',
      worldSlug: 'tech',
      passMark: 50,
      maxAttempts: null,
      questions: [
        {
          stem: 'מה הסף החדש?',
          kind: 'single',
          options: [
            { id: 'a', text: 'נכון', correct: true },
            { id: 'b', text: 'לא נכון', correct: false },
          ],
        },
      ],
    });
    const assign = await app.inject({
      method: 'POST',
      url: `/api/v1/learning/items/${quizId}/assign`,
      headers: auth(lead),
      payload: { userIds: [agent.id], dueDays: 14 },
    });
    expect(assign.statusCode, assign.body).toBe(200);

    const mine = await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agent) });
    const open = mine.json().open.find((a: { itemId: string }) => a.itemId === quizId);
    expect(open, mine.body).toBeTruthy();
    const player = await app.inject({
      method: 'GET',
      url: `/api/v1/learning/my/${open.id}`,
      headers: auth(agent),
    });
    expect(player.statusCode, player.body).toBe(200);
    const questionId = player.json().questions[0].id as string;
    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/learning/my/${open.id}/attempts`,
      headers: auth(agent),
    });
    expect(started.statusCode, started.body).toBe(201);
    const submitted = await app.inject({
      method: 'PUT',
      url: `/api/v1/learning/attempts/${started.json().attemptId}`,
      headers: auth(agent),
      // Option `a` is the one `seedQuiz` marked correct, so the pass is deterministic.
      payload: { answers: [{ questionId, optionIds: ['a'] }] },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(submitted.json().passed).toBe(true);

    const pub = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/publish`,
      headers: auth(lead),
      payload: { label: 'v2', significantChange: true },
    });
    expect(pub.statusCode, pub.body).toBe(200);
    expect(pub.json().changeFlag.significant).toBe(true);
    expect(pub.json().changeFlag.affectedItems).toBe(1);
    expect(pub.json().changeFlag.refreshAssignments).toBe(1);

    const after = await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agent) });
    expect(after.json().completed.some((a: { itemId: string }) => a.itemId === quizId)).toBe(false);
    expect(after.json().invalidated.some((a: { itemId: string }) => a.itemId === quizId)).toBe(true);
    const refresh = after
      .json()
      .open.find((a: { itemId: string; reason: string }) => a.itemId === quizId && a.reason === 'refresh');
    expect(refresh, after.body).toBeTruthy();

    // …and the article banner the learner sees points at exactly that assignment.
    const dl = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${docId}/learning`,
      headers: auth(agent),
    });
    expect(dl.json().refreshRequired).toBe(true);
    expect(dl.json().refreshAssignmentId).toBe(refresh.id);
    expect(dl.json().lastSignificantChange.version).toBe(2);
  });

  /**
   * A-C2. `applyChangeFlag` was wired to exactly one of the five callers of `publishDocument` —
   * `POST /documents/:id/publish`. The test above proves that one. These two prove the other two
   * editorial paths, which is where the finding actually bites: with `workflow.requireApprover`
   * on, *every* editorial publish is a review decision, so §1.5 recorded nothing at all in the
   * one configuration §1.6 exists to enable.
   */
  const seedAssignedQuiz = async (docId: string, title: string): Promise<{ quizId: string }> => {
    const quizId = await seedQuiz(db.pool, {
      documentId: docId,
      title,
      worldSlug: 'tech',
      passMark: 50,
      maxAttempts: null,
      questions: [
        {
          stem: 'מה עושים?',
          kind: 'single',
          options: [
            { id: 'a', text: 'נכון', correct: true },
            { id: 'b', text: 'לא נכון', correct: false },
          ],
        },
      ],
    });
    const assign = await app.inject({
      method: 'POST',
      url: `/api/v1/learning/items/${quizId}/assign`,
      headers: auth(lead),
      payload: { userIds: [agent.id], dueDays: 14 },
    });
    expect(assign.statusCode, assign.body).toBe(200);
    return { quizId };
  };

  /** One outcome text rewritten — the detector's own "what an agent must do changed" rule. */
  const editOutcome = async (docId: string, text: string): Promise<void> => {
    const changed = structuredClone(structure) as typeof structure;
    changed.phases[0].steps[2].outcomes = [{ kind: 'ok', text }];
    const cur = await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}`, headers: auth(lead) });
    const edit = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/structure`,
      headers: { ...auth(lead), 'if-match': cur.json().etag as string },
      payload: changed,
    });
    expect(edit.statusCode, edit.body).toBe(200);
  };

  it('A-C2: the review-approval publish also records the flag and hands out the refresh', async () => {
    const docId = await makeDoc('מסמך שמאושר בבדיקה');
    const { quizId } = await seedAssignedQuiz(docId, 'שאלון בנתיב אישור');
    await editOutcome(docId, '✓ כיסוי תקין מעל 4 מגה');

    const asked = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/request-review`,
      headers: auth(lead),
      payload: {},
    });
    expect(asked.statusCode, asked.body).toBe(201);
    // SELF_APPROVAL: the approver has to be someone else, which is the §1.6 configuration.
    const approver = await makeUser(db.pool, {
      name: 'מאשר',
      perms: ['docs.read', 'docs.read_unpublished', 'docs.publish'],
    });
    const decided = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/review-decision`,
      headers: auth(approver),
      payload: { decision: 'approve' },
    });
    expect(decided.statusCode, decided.body).toBe(200);

    const flags = await db.pool.query(
      'select version, significant from document_change_flags where document_id=$1 order by version',
      [docId],
    );
    expect(flags.rows.map((r) => r.version)).toEqual([1, 2]);
    expect(flags.rows[1].significant).toBe(true);
    const mine = await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agent) });
    expect(
      mine.json().invalidated.some((a: { itemId: string }) => a.itemId === quizId),
      mine.body,
    ).toBe(true);
    expect(
      mine
        .json()
        .open.some((a: { itemId: string; reason: string }) => a.itemId === quizId && a.reason === 'refresh'),
    ).toBe(true);
  });

  it('A-C2: applying an accepted suggestion records the flag too', async () => {
    const docId = await makeDoc('מסמך שהצעה משנה');
    const { quizId } = await seedAssignedQuiz(docId, 'שאלון בנתיב הצעה');

    const src = await db.pool.query(
      `insert into sources(kind, title) values ('docx','מסמך מקור') returning id`,
    );
    const rev = await db.pool.query(
      `insert into source_revisions(source_id, hash, paragraphs) values ($1,'h1','[]'::jsonb) returning id`,
      [src.rows[0].id],
    );
    // `update-step` replacing an outcome: the same rule the editor path fires on.
    await db.pool.query(
      `insert into suggestions(source_revision_id, anchor, type, title, target_document_id, target_step_key, payload, confidence, rationale, status)
       values ($1,'§2','update-step','עדכון תוצאה',$2,'s3',$3,0.9,'המקור עודכן','accepted')`,
      [
        rev.rows[0].id,
        docId,
        JSON.stringify({
          type: 'update-step',
          addActions: [],
          outcomes: [{ kind: 'ok', text: '✓ כיסוי תקין מעל 8 מגה' }],
          patch: {},
        }),
      ],
    );

    const applied = await app.inject({
      method: 'POST',
      url: '/api/v1/suggestions/publish',
      headers: auth(lead),
      payload: { sourceId: src.rows[0].id },
    });
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json().applied).toBe(1);

    const flags = await db.pool.query(
      'select version, significant from document_change_flags where document_id=$1 order by version',
      [docId],
    );
    expect(flags.rows.map((r) => r.version)).toEqual([1, 2]);
    expect(flags.rows[1].significant).toBe(true);
    const mine = await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agent) });
    expect(
      mine.json().invalidated.some((a: { itemId: string }) => a.itemId === quizId),
      mine.body,
    ).toBe(true);
  });

  it('A-I3: a learner who completed the refresh is told again by the next significant publish', async () => {
    const docId = await makeDoc('מסמך שמשתנה פעמיים');
    const { quizId } = await seedAssignedQuiz(docId, 'שאלון שני רענונים');
    /** Finds the agent's open assignment for this quiz, passes it, and returns its id. */
    const passIt = async (): Promise<string> => {
      const mine = await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agent) });
      const open = mine.json().open.find((a: { itemId: string }) => a.itemId === quizId);
      expect(open, mine.body).toBeTruthy();
      const player = await app.inject({
        method: 'GET',
        url: `/api/v1/learning/my/${open.id}`,
        headers: auth(agent),
      });
      expect(player.statusCode, player.body).toBe(200);
      const started = await app.inject({
        method: 'POST',
        url: `/api/v1/learning/my/${open.id}/attempts`,
        headers: auth(agent),
      });
      expect(started.statusCode, started.body).toBe(201);
      const submitted = await app.inject({
        method: 'PUT',
        url: `/api/v1/learning/attempts/${started.json().attemptId}`,
        headers: auth(agent),
        payload: {
          answers: [{ questionId: player.json().questions[0].id as string, optionIds: ['a'] }],
        },
      });
      expect(submitted.statusCode, submitted.body).toBe(200);
      expect(submitted.json().passed).toBe(true);
      return open.id as string;
    };
    const republish = async (label: string) => {
      const r = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${docId}/publish`,
        headers: auth(lead),
        payload: { label, significantChange: true },
      });
      expect(r.statusCode, r.body).toBe(200);
      return r.json().changeFlag as { refreshAssignments: number };
    };

    await passIt(); // the original assignment
    expect((await republish('v2')).refreshAssignments).toBe(1);
    const refreshId = await passIt(); // …and the refresh it created

    // Publish #2. The old behaviour found no `audience`/`manual` row left to invalidate and no
    // *standing* refresh (this one is completed), so the prompt learner heard nothing.
    expect((await republish('v3')).refreshAssignments).toBe(1);
    const after = await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agent) });
    const reopened = after
      .json()
      .open.find((a: { itemId: string; reason: string }) => a.itemId === quizId && a.reason === 'refresh');
    expect(reopened, after.body).toBeTruthy();
    // The same row, re-pointed at the newer reason rather than a second one stacked on it.
    expect(reopened.id).toBe(refreshId);
    expect(reopened.refreshReason).toContain('גרסה 3');
    // Its attempt budget starts over, so a capped quiz's refresh would still be takeable.
    expect(reopened.attemptsUsed).toBe(0);
    expect(
      (await db.pool.query(`select count(*)::int n from learning_assignments where item_id=$1`, [quizId]))
        .rows[0].n,
    ).toBe(2); // the original (invalidated) and the one refresh
  });

  it('A-I4: a flagged item is hidden from new assignments, and archiving withdraws the open ones', async () => {
    const docId = await makeDoc('מסמך שיהפוך ללא תקין');
    const { quizId } = await seedAssignedQuiz(docId, 'שאלון שיוצא משימוש');
    // §1.8: the referenced document becomes invalid, so the item is "דורש עדכון".
    await db.pool.query(`update documents set status='invalid' where id=$1`, [docId]);
    const refused = await app.inject({
      method: 'POST',
      url: `/api/v1/learning/items/${quizId}/assign`,
      headers: auth(lead),
      payload: { userIds: [manager.id], dueDays: 14 },
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().code).toBe('ITEM_NEEDS_UPDATE');
    const audience = await app.inject({
      method: 'POST',
      url: `/api/v1/learning/items/${quizId}/audiences`,
      headers: auth(lead),
      payload: { roleNames: ['agent'], worldSlugs: [], userIds: [], dueDays: 14 },
    });
    expect(audience.statusCode, audience.body).toBe(409);

    // …and archiving the item withdraws what is still owed instead of leaving learners on the hook.
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/learning/items/${quizId}`,
          headers: auth(lead),
        })
      ).statusCode,
    ).toBe(204);
    const rows = await db.pool.query(
      `select status, invalidated_reason from learning_assignments where item_id=$1`,
      [quizId],
    );
    expect(rows.rows.every((r) => r.status === 'invalidated')).toBe(true);
    expect(rows.rows[0].invalidated_reason).toContain('ארכיון');
  });

  it('GET /documents/:id/change-preview states the verdict a publish would record, and writes nothing', async () => {
    const docId = await makeDoc('תצוגה מקדימה של שינוי');
    const quiet = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${docId}/change-preview`,
      headers: auth(lead),
    });
    expect(quiet.statusCode, quiet.body).toBe(200);
    expect(quiet.json()).toEqual({ significant: false, reasons: [], affectedItems: 0 });

    await seedQuiz(db.pool, {
      documentId: docId,
      title: 'שאלון לתצוגה מקדימה',
      worldSlug: 'tech',
      passMark: 80,
      maxAttempts: null,
      questions: [{ stem: 'שאלה', kind: 'single', options: [{ id: 'a', text: 'נכון', correct: true }] }],
    });
    // One outcome text — the detector's own "what an agent must do changed" rule.
    const changed = structuredClone(structure) as typeof structure;
    changed.phases[0].steps[2].outcomes = [{ kind: 'ok', text: '✓ כיסוי תקין מעל 4 מגה' }];
    const cur = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${docId}`,
      headers: auth(lead),
    });
    const edit = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/structure`,
      headers: { ...auth(lead), 'if-match': cur.json().etag as string },
      payload: changed,
    });
    expect(edit.statusCode, edit.body).toBe(200);

    const preview = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${docId}/change-preview`,
      headers: auth(lead),
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().significant).toBe(true);
    expect(preview.json().reasons.join(' ')).toContain('תוצאה השתנתה');
    expect(preview.json().affectedItems).toBe(1);
    // A preview decides nothing: the only flag row is the one v1's publish recorded.
    const flags = await db.pool.query(
      'select version, significant from document_change_flags where document_id=$1 order by version',
      [docId],
    );
    expect(flags.rows.map((r) => r.version)).toEqual([1]);
    expect(flags.rows[0].significant).toBe(false);
  });

  /**
   * A-I2. The player and the grader read the *live* `quiz_questions` rows, so an editor touching
   * a published quiz changed what learners mid-assignment saw and were graded on — and, because
   * `replaceQuestions` deleted and re-inserted, minted new uuids and orphaned every stored
   * `learning_attempts.answers` key, which is what the dashboard tile and the failed-question
   * heuristic join on.
   */
  it('A-I2: an edit to a published quiz does not reach a learner mid-assignment, and keeps the ids', async () => {
    const docId = await makeDoc('מסמך לשאלון גרסאות');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/learning/items',
      headers: auth(lead),
      payload: { kind: 'quiz', title: 'בוחן גרסאות', worldSlug: 'tech', passMark: 50 },
    });
    expect(created.statusCode, created.body).toBe(201);
    const itemId = created.json().id as string;
    const putQuestions = (questions: unknown[]) =>
      app.inject({
        method: 'PUT',
        url: `/api/v1/learning/items/${itemId}/questions`,
        headers: auth(lead),
        payload: { questions },
      });
    const first = await putQuestions([
      {
        documentId: docId,
        stepKey: 's3',
        stem: 'שאלת גרסה א',
        kind: 'single',
        options: [
          { id: 'o1', text: 'תשובת גרסה א', correct: true },
          { id: 'o2', text: 'מוטעה', correct: false },
        ],
      },
    ]);
    expect(first.statusCode, first.body).toBe(200);
    const questionId = first.json().questions[0].id as string;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/learning/items/${itemId}/publish`,
          headers: auth(lead),
          payload: { label: 'v1' },
        })
      ).statusCode,
    ).toBe(200);
    const assigned = await app.inject({
      method: 'POST',
      url: `/api/v1/learning/items/${itemId}/assign`,
      headers: auth(lead),
      payload: { userIds: [agent.id], dueDays: 14 },
    });
    expect(assigned.statusCode, assigned.body).toBe(200);
    const mine = await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agent) });
    const assignmentId = mine
      .json()
      .open.find((a: { itemId: string }) => a.itemId === itemId).id as string;

    // The editor now rewrites the question — same id, different stem, different correct option —
    // and does *not* republish the item.
    const second = await putQuestions([
      {
        id: questionId,
        documentId: docId,
        stepKey: 's3',
        stem: 'שאלת גרסה ב',
        kind: 'single',
        options: [
          { id: 'o1', text: 'תשובת גרסה א', correct: false },
          { id: 'o2', text: 'מוטעה', correct: true },
        ],
      },
    ]);
    expect(second.statusCode, second.body).toBe(200);
    // Preserved, so the stored attempt answers below still join.
    expect(second.json().questions[0].id).toBe(questionId);
    expect(
      (await db.pool.query('select id from quiz_questions where item_id=$1', [itemId])).rows.map(
        (r) => r.id,
      ),
    ).toEqual([questionId]);

    const player = await app.inject({
      method: 'GET',
      url: `/api/v1/learning/my/${assignmentId}`,
      headers: auth(agent),
    });
    expect(player.statusCode, player.body).toBe(200);
    expect(player.json().questions[0].stem).toBe('שאלת גרסה א');

    // …and the grader uses the pinned key too: `o1` was correct at v1 and is not any more.
    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/learning/my/${assignmentId}/attempts`,
      headers: auth(agent),
    });
    expect(started.statusCode, started.body).toBe(201);
    const graded = await app.inject({
      method: 'PUT',
      url: `/api/v1/learning/attempts/${started.json().attemptId}`,
      headers: auth(agent),
      payload: { answers: [{ questionId, optionIds: ['o1'] }] },
    });
    expect(graded.statusCode, graded.body).toBe(200);
    expect(graded.json().passed).toBe(true);
    // The stored answer key is the question that still exists, so the history survives the edit.
    const stored = await db.pool.query(
      `select answers from learning_attempts where id=$1`,
      [started.json().attemptId],
    );
    expect(Object.keys(stored.rows[0].answers as Record<string, unknown>)).toEqual([questionId]);
    expect(
      (
        await db.pool.query(
          `select 1 from learning_attempts t, jsonb_each(t.answers) kv
             join quiz_questions qq on qq.id::text = kv.key where t.id=$1`,
          [started.json().attemptId],
        )
      ).rowCount,
    ).toBe(1);
  });

  it('GET /learning/audience-options answers a manager who has no roles.manage', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/learning/audience-options',
      headers: auth(manager),
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().roles.map((x: { name: string }) => x.name)).toContain('agent');
    // The same manager may not read the admin role list, which is the reason this route exists.
    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/roles',
      headers: auth(manager),
    });
    expect(denied.statusCode).toBe(403);
  });
});
