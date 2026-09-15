import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth } from './helpers/fixtures.js';

const run = integration ? describe : describe.skip;

run('workflow settings and approver gate', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let admin: Awaited<ReturnType<typeof makeUser>>;
  let editor: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    admin = await makeUser(db.pool, { name: 'אדמין' });
    editor = await makeUser(db.pool, { name: 'עורך', perms: ['docs.read', 'docs.edit'] });
  }, 120000);

  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  describe('GET/PUT /admin/workflow', () => {
    it('returns defaults, accepts a deep partial, and audits', async () => {
      const g = await app.inject({ method: 'GET', url: '/api/v1/admin/workflow', headers: auth(admin) });
      expect(g.statusCode).toBe(200);
      expect(g.json()).toMatchObject({
        requireApprover: false,
        learning: { defaultPassMark: 80, defaultMaxAttempts: null },
        gaps: { staleDays: 180 },
      });
      const p = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/workflow',
        headers: auth(admin),
        payload: { requireApprover: true, gaps: { staleDays: 90 } },
      });
      expect(p.statusCode).toBe(200);
      // The patch is deep-merged: the learning block and the untouched gap thresholds survive.
      expect(p.json()).toMatchObject({
        requireApprover: true,
        learning: { defaultPassMark: 80 },
        gaps: { staleDays: 90, zeroResultMin: 3 },
      });
      expect(
        (await app.inject({ method: 'GET', url: '/api/v1/admin/workflow', headers: auth(admin) })).json().gaps
          .staleDays,
      ).toBe(90);
      // Reading is `docs.read` (the review queue needs to know whether the switch is on);
      // writing is `system.admin`.
      expect(
        (await app.inject({ method: 'GET', url: '/api/v1/admin/workflow', headers: auth(editor) }))
          .statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: '/api/v1/admin/workflow',
            headers: auth(editor),
            payload: { requireApprover: false },
          })
        ).statusCode,
      ).toBe(403);
      // `staleDays` has a floor of 30: an out-of-range patch is refused whole, not clamped.
      const bad = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/workflow',
        headers: auth(admin),
        payload: { gaps: { staleDays: 5 } },
      });
      expect(bad.statusCode).toBe(400);
      expect(
        (await app.inject({ method: 'GET', url: '/api/v1/admin/workflow', headers: auth(admin) })).json().gaps
          .staleDays,
      ).toBe(90);
      const a = await db.pool.query(`select action from audit_log where action='admin.workflow.update'`);
      expect(a.rowCount).toBe(1);
      // Leave the switch off for the gate tests below to turn on themselves.
      await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/workflow',
        headers: auth(admin),
        payload: { requireApprover: false },
      });
    });
  });

  describe('approver gate', () => {
    /** Same user, plus database roles. Header values are ByteStrings, so the Hebrew name is re-escaped. */
    const roleHeader = (u: { header: string }, roles: string[]) => {
      const parsed = JSON.parse(u.header) as Record<string, unknown>;
      return {
        'x-test-user': JSON.stringify({ ...parsed, roles }).replace(
          /[^\x20-\x7e]/g,
          (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
        ),
      };
    };
    let docId: string;
    let lead: Awaited<ReturnType<typeof makeUser>>;

    beforeAll(async () => {
      lead = await makeUser(db.pool, {
        name: 'מוביל',
        perms: ['docs.read', 'docs.read_unpublished', 'docs.create', 'docs.edit', 'docs.publish'],
      });
      const c = await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(lead),
        payload: { title: 'לבדיקה', description: '', category: 'sim', wave: 1, priority: 'h', kind: 'steps' },
      });
      if (c.statusCode !== 201) throw new Error(`create: ${c.statusCode} ${c.body}`);
      docId = c.json().id;
    });

    const requestReview = () =>
      app.inject({
        method: 'POST',
        url: `/api/v1/documents/${docId}/request-review`,
        headers: auth(lead),
        payload: {},
      });
    const decide = (h: Record<string, string>, decision: 'changes' | 'approve' = 'changes') =>
      app.inject({
        method: 'POST',
        url: `/api/v1/documents/${docId}/review-decision`,
        headers: h,
        payload: { decision, note: 'x' },
      });

    it('off: docs.publish alone decides', async () => {
      expect((await requestReview()).statusCode).toBe(201);
      expect((await decide(auth(lead))).statusCode).toBe(200);
      const q = await app.inject({ method: 'GET', url: '/api/v1/reviews', headers: auth(lead) });
      expect(q.json().items.length).toBeGreaterThan(0);
      expect(q.json().items.every((r: { canApprove: boolean }) => r.canApprove === true)).toBe(true);
    });

    it('on: a non-approver gets 403 APPROVER_REQUIRED, an approver-role holder decides, queue rows say who can', async () => {
      await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/workflow',
        headers: auth(admin),
        payload: { requireApprover: true },
      });
      expect((await requestReview()).statusCode).toBe(201);
      // A-M5: the gate is on the decision that publishes. `changes` is a withdrawal and is
      // checked in its own test below; this is the one the switch exists for.
      const denied = await decide(auth(lead), 'approve');
      expect(denied.statusCode).toBe(403);
      expect(denied.json().code).toBe('APPROVER_REQUIRED');
      const q1 = await app.inject({
        method: 'GET',
        url: '/api/v1/reviews?status=open',
        headers: auth(lead),
      });
      expect(q1.json().items[0].canApprove).toBe(false);
      const ok = await decide(roleHeader(lead, ['lead', 'approver']));
      expect(ok.statusCode).toBe(200);
      await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/workflow',
        headers: auth(admin),
        payload: { requireApprover: false },
      });
    });

    /**
     * A-M5. Every test above sends `decision: 'changes'`, so the gate was only ever exercised on
     * the one decision it should not apply to: sending your own document back to draft publishes
     * nothing and is a withdrawal. With the whole route gated, `requireApprover` took that away
     * from the author.
     */
    it('on: the author may still withdraw their own request with `changes`', async () => {
      await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/workflow',
        headers: auth(admin),
        payload: { requireApprover: true },
      });
      expect((await requestReview()).statusCode).toBe(201);
      const withdrawn = await decide(auth(lead), 'changes');
      expect(withdrawn.statusCode, withdrawn.body).toBe(200);
      expect(withdrawn.json().status).toBe('changes');
      // …and the same caller still cannot approve.
      expect((await requestReview()).statusCode).toBe(201);
      const denied = await decide(auth(lead), 'approve');
      expect(denied.statusCode).toBe(403);
      expect(denied.json().code).toBe('APPROVER_REQUIRED');
      await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/workflow',
        headers: auth(admin),
        payload: { requireApprover: false },
      });
    });

    /**
     * A-M5 second half: the approve path itself, which no test reached. SELF_APPROVAL refuses the
     * requester, a second holder publishes, and the publish is what makes the version.
     */
    it('approve: SELF_APPROVAL refuses the requester and a second holder publishes', async () => {
      const other = await makeUser(db.pool, {
        name: 'מאשרת',
        perms: ['docs.read', 'docs.read_unpublished', 'docs.publish'],
      });
      expect((await requestReview()).statusCode).toBe(201);
      const self = await decide(auth(lead), 'approve');
      expect(self.statusCode).toBe(403);
      expect(self.json().code).toBe('SELF_APPROVAL');
      const before = (await db.pool.query('select current_version from documents where id=$1', [docId]))
        .rows[0].current_version as number;
      const ok = await decide(auth(other), 'approve');
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json().status).toBe('approved');
      const after = await db.pool.query('select current_version, status from documents where id=$1', [docId]);
      expect(after.rows[0].current_version).toBe(before + 1);
      expect(after.rows[0].status).toBe('published');
      // A-C2: the approve publish records §1.5's change flag like any other editorial publish.
      const flag = await db.pool.query(
        'select version from document_change_flags where document_id=$1 and version=$2',
        [docId, before + 1],
      );
      expect(flag.rowCount).toBe(1);
    });
  });
});
