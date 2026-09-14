import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth, minimalStructure } from './helpers/fixtures.js';
import { setTaxonomy } from '../src/plugins/wave4.js';

const run = integration ? describe : describe.skip;

run('feedback', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let lead: Awaited<ReturnType<typeof makeUser>>;
  let agent: Awaited<ReturnType<typeof makeUser>>;
  let docId: string;

  const createDoc = async (title = 'מסמך משוב') => {
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(lead),
        payload: { title, category: 'tech', wave: 1, priority: 'm', kind: 'steps' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${c.id}/structure`,
      headers: { ...auth(lead), 'if-match': c.etag },
      payload: minimalStructure,
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${c.id}/publish`,
      headers: auth(lead),
      payload: { label: 'v1' },
    });
    return c.id as string;
  };

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    // W1 may not be merged: a fake resolver stands in for PgTaxonomy. It answers the
    // document's real primary world first, so `world_slug` on a report is the document's world
    // and the B-I1 scoping case below is about scope rather than about the fake.
    setTaxonomy(app, {
      worldsOf: async (id: string) => {
        const r = await db.pool.query<{ category: string }>('select category from documents where id=$1', [
          id,
        ]);
        return [...new Set([r.rows[0]?.category ?? 'tech', 'tech', 'ops'])];
      },
      usersWithPermissionInWorld: async () => [],
    });
    lead = await makeUser(db.pool, { name: 'ענבר ל.' });
    agent = await makeUser(db.pool, { perms: ['docs.read'], name: 'דנה ר.' });
    docId = await createDoc();
  }, 120000);
  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  it('an agent with docs.read reports and the context is captured automatically', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/feedback`,
      headers: auth(agent),
      payload: { kind: 'error', text: 'הסף השתנה ל-6 מגה', stepKey: 's2' },
    });
    expect(r.statusCode).toBe(201);
    const f = r.json();
    expect(f).toMatchObject({
      documentId: docId,
      documentVersion: 1,
      worldSlug: 'tech',
      stepKey: 's2',
      kind: 'error',
      status: 'new',
      userId: agent.id,
      userName: 'דנה ר.',
      resolvedVersion: null,
    });
    expect(typeof f.createdAt).toBe('string');
  });

  it('kind is required; text max 1000; unknown document 404', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/documents/${docId}/feedback`,
          headers: auth(agent),
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/documents/${docId}/feedback`,
          headers: auth(agent),
          payload: { kind: 'other', text: 'x'.repeat(1001) },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/documents/11111111-1111-4111-8111-111111111111/feedback`,
          headers: auth(agent),
          payload: { kind: 'other' },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('the queue needs feedback.manage and returns rows with status counts', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/feedback', headers: auth(agent) })).statusCode,
    ).toBe(403);
    const r = await app.inject({ method: 'GET', url: '/api/v1/feedback', headers: auth(lead) });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({
      documentTitle: 'מסמך משוב',
      kind: 'error',
      assigneeName: null,
    });
    expect(body.counts).toEqual({ new: 1, in_review: 0, needs_update: 0, no_change: 0, done: 0 });
    const filtered = (
      await app.inject({ method: 'GET', url: '/api/v1/feedback?status=done', headers: auth(lead) })
    ).json();
    expect(filtered.total).toBe(0);
    expect(filtered.counts.new).toBe(1); // counts ignore the status filter (tab badges)
    const byKind = (
      await app.inject({ method: 'GET', url: '/api/v1/feedback?kind=missing', headers: auth(lead) })
    ).json();
    expect(byKind.total).toBe(0);
  });

  it('detail carries the deep link and the versions published after the report', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/v1/feedback', headers: auth(lead) })).json();
    const id = list.items[0].id as string;
    // publish v2 after the report
    const doc = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}`, headers: auth(lead) })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/structure`,
      headers: { ...auth(lead), 'if-match': doc.etag },
      payload: minimalStructure,
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/publish`,
      headers: auth(lead),
      payload: { label: 'תיקון סף' },
    });
    const d = (
      await app.inject({ method: 'GET', url: `/api/v1/feedback/${id}`, headers: auth(lead) })
    ).json();
    expect(d.href).toBe(`/doc/${docId}/s2`);
    expect(d.versionLabel).toBe('v1');
    expect(d.laterVersions.map((v: { version: number }) => v.version)).toEqual([2]);
  });

  it('patch moves status, assigns, records the decision; resolve links a version', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/v1/feedback', headers: auth(lead) })).json();
    const id = list.items[0].id as string;
    const p = await app.inject({
      method: 'PATCH',
      url: `/api/v1/feedback/${id}`,
      headers: auth(lead),
      payload: { status: 'in_review', assigneeId: lead.id, decisionNote: 'בודקת מול הנדסה' },
    });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({
      status: 'in_review',
      assigneeId: lead.id,
      assigneeName: 'ענבר ל.',
      decidedAt: null,
    });
    const bad = await app.inject({
      method: 'POST',
      url: `/api/v1/feedback/${id}/resolve`,
      headers: auth(lead),
      payload: { version: 99 },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('UNKNOWN_VERSION');
    const ok = await app.inject({
      method: 'POST',
      url: `/api/v1/feedback/${id}/resolve`,
      headers: auth(lead),
      payload: { version: 2, decisionNote: 'תוקן ב-v2' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      status: 'done',
      resolvedVersion: 2,
      decidedBy: lead.id,
      decisionNote: 'תוקן ב-v2',
    });
    expect(typeof ok.json().decidedAt).toBe('string');
    const audit = await db.pool.query(
      `select action from audit_log where entity_type='feedback' and entity_id=$1 order by at`,
      [id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'feedback.create',
      'feedback.update',
      'feedback.resolve',
    ]);
  });

  it('open feedback for a document needs docs.edit and excludes closed rows', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/feedback`,
      headers: auth(agent),
      payload: { kind: 'unclear' },
    });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/documents/${docId}/feedback`,
          headers: auth(agent),
        })
      ).statusCode,
    ).toBe(403);
    const r = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${docId}/feedback`,
        headers: auth(lead),
      })
    ).json();
    expect(r.items.map((f: { kind: string }) => f.kind)).toEqual(['unclear']);
  });

  it('analytics: counts, kinds, mean hours to close, change rate; recurringByTopic empty without W1 tables', async () => {
    const other = await createDoc('מסמך שני');
    for (const kind of ['error', 'error', 'missing'] as const)
      await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${other}/feedback`,
        headers: auth(agent),
        payload: { kind },
      });
    const l = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/feedback?documentId=${other}`,
        headers: auth(lead),
      })
    ).json();
    // close one without a version (no_change) and one with a version
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/feedback/${l.items[0].id}`,
      headers: auth(lead),
      payload: { status: 'no_change' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/feedback/${l.items[1].id}/resolve`,
      headers: auth(lead),
      payload: { version: 1 },
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/feedback/analytics',
      headers: auth(lead),
    });
    expect(r.statusCode).toBe(200);
    const a = r.json();
    expect(a.total).toBeGreaterThanOrEqual(5);
    const second = a.perItem.find((x: { documentId: string }) => x.documentId === other);
    expect(second).toMatchObject({ title: 'מסמך שני', count: 3, open: 1 });
    expect(a.byKind.find((x: { kind: string }) => x.kind === 'error').count).toBeGreaterThanOrEqual(3);
    expect(a.topItems[0].count).toBeGreaterThanOrEqual(2);
    expect(typeof a.meanHoursToClose).toBe('number');
    // closed so far across the suite: done(v2) + no_change + done(v1) → 2 of 3 carry a version
    expect(a.changeRate).toBeCloseTo(2 / 3, 5);
    expect(a.recurringByTopic).toEqual([]);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/feedback/analytics?world=tech',
          headers: auth(lead),
        })
      ).json().total,
    ).toBe(a.total);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/feedback/analytics?world=sim',
          headers: auth(lead),
        })
      ).json().total,
    ).toBe(0);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/feedback/analytics',
          headers: auth(agent),
        })
      ).statusCode,
    ).toBe(403);
  });

  it("publish with resolveFeedbackIds closes only that document's open reports with the new version", async () => {
    const third = await createDoc('מסמך שלישי');
    const a = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${third}/feedback`,
        headers: auth(agent),
        payload: { kind: 'outdated' },
      })
    ).json();
    const b = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${third}/feedback`,
        headers: auth(agent),
        payload: { kind: 'error' },
      })
    ).json();
    const foreign = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${docId}/feedback`,
        headers: auth(agent),
        payload: { kind: 'error' },
      })
    ).json();
    const doc = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${third}`, headers: auth(lead) })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${third}/structure`,
      headers: { ...auth(lead), 'if-match': doc.etag },
      payload: minimalStructure,
    });
    const p = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${third}/publish`,
      headers: auth(lead),
      payload: { label: 'סגירת משובים', resolveFeedbackIds: [a.id, foreign.id] },
    });
    expect(p.statusCode).toBe(200);
    expect(p.json().version).toBe(2);
    const fa = (
      await app.inject({ method: 'GET', url: `/api/v1/feedback/${a.id}`, headers: auth(lead) })
    ).json();
    const fb = (
      await app.inject({ method: 'GET', url: `/api/v1/feedback/${b.id}`, headers: auth(lead) })
    ).json();
    const ff = (
      await app.inject({ method: 'GET', url: `/api/v1/feedback/${foreign.id}`, headers: auth(lead) })
    ).json();
    expect(fa).toMatchObject({ status: 'done', resolvedVersion: 2, decidedBy: lead.id });
    expect(fb.status).toBe('new');
    expect(ff.status).toBe('new'); // belongs to another document → ignored
  });
  /**
   * B-I1 — `listFeedback`, `getFeedbackDetail` and `feedbackAnalytics` built their `where` from
   * caller-supplied *filters* only and never from `user.worldScopes`, while the rows carry the
   * document title, the reporter's display name and the free text of the report. Every other
   * read surface in this wave grew a scope term; feedback was the one that did not.
   */
  it('B-I1: the queue, detail and analytics are scoped to the caller worlds', async () => {
    const opsDoc = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(lead),
        payload: { title: 'סודי לתפעול', category: 'ops', wave: 1, priority: 'm', kind: 'steps' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${opsDoc.id}/structure`,
      headers: { ...auth(lead), 'if-match': opsDoc.etag },
      payload: minimalStructure,
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${opsDoc.id}/publish`,
      headers: auth(lead),
      payload: { label: 'v1' },
    });
    const opsFeedback = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${opsDoc.id}/feedback`,
        headers: auth(agent),
        payload: { kind: 'error', text: 'טקסט סודי לתפעול' },
      })
    ).json();

    const scopedLead = await makeUser(db.pool, { name: 'ראש טכני', scopes: ['tech'] });
    const queue = await app.inject({ method: 'GET', url: '/api/v1/feedback', headers: auth(scopedLead) });
    expect(queue.statusCode).toBe(200);
    expect(queue.body).not.toContain(opsFeedback.id);
    expect(queue.body).not.toContain('סודי לתפעול');
    expect(queue.body).not.toContain('טקסט סודי לתפעול');
    // The tab badges are built from the same base, so they must narrow too — otherwise the
    // count itself is the leak.
    const opsRows = queue
      .json()
      .items.filter((x: { documentTitle: string }) => x.documentTitle === 'סודי לתפעול');
    expect(opsRows).toEqual([]);
    expect(Object.values(queue.json().counts as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(
      queue.json().total,
    );

    // 404, not 403: the queue and the drawer must not disagree about whether a report exists.
    for (const [method, url, payload] of [
      ['GET', `/api/v1/feedback/${opsFeedback.id}`, undefined],
      ['PATCH', `/api/v1/feedback/${opsFeedback.id}`, { status: 'in_review' }],
      ['POST', `/api/v1/feedback/${opsFeedback.id}/resolve`, { version: 1 }],
    ] as const) {
      const r = await app.inject({ method, url, headers: auth(scopedLead), payload });
      expect(r.statusCode, `${method} ${url}`).toBe(404);
    }

    const analytics = await app.inject({
      method: 'GET',
      url: '/api/v1/feedback/analytics',
      headers: auth(scopedLead),
    });
    expect(analytics.statusCode).toBe(200);
    expect(analytics.body).not.toContain('סודי לתפעול');

    // …and the unscoped lead still sees everything, so this is a filter and not a break.
    const all = await app.inject({ method: 'GET', url: '/api/v1/feedback', headers: auth(lead) });
    expect(all.body).toContain(opsFeedback.id);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/feedback/analytics',
          headers: auth(lead),
        })
      ).body,
    ).toContain('סודי לתפעול');
  });
});
