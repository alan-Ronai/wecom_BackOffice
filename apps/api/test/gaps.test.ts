import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth } from './helpers/fixtures.js';
import { withTransaction } from '../src/lib/sql.js';
import * as repo from '../src/modules/gaps/repo.js';
import * as heur from '../src/modules/gaps/heuristics.js';

const run = integration ? describe : describe.skip;

run('gaps', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let editor: Awaited<ReturnType<typeof makeUser>>;
  let lead: Awaited<ReturnType<typeof makeUser>>;
  let agent: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    editor = await makeUser(db.pool, { name: 'עורך', perms: ['docs.read', 'gaps.read'] });
    lead = await makeUser(db.pool, { name: 'מוביל', perms: ['docs.read', 'gaps.read', 'gaps.manage'] });
    agent = await makeUser(db.pool, { name: 'נציג', perms: ['docs.read'] });
    // `PgTaxonomy` resolves notification recipients from the *database* roles, not from the test
    // auth header, so the lead needs a real unscoped `lead` grant for `gaps.manage` to find them.
    await db.pool.query(
      `insert into user_roles(user_id, role_id) select $1, id from roles where name='lead'`,
      [lead.id],
    );
  }, 120000);

  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  const cand = (over: Partial<repo.GapCandidate> = {}): repo.GapCandidate => ({
    kind: 'zero_results',
    key: 'esim',
    title: 'חיפושים ללא תוצאה: esim',
    evidence: { count: 5, samples: ['eSIM', 'esim הפעלה'] },
    score: 5,
    suggestedAction: 'create',
    documentId: null,
    topicId: null,
    worldSlug: null,
    ...over,
  });

  describe('repo', () => {
    it('upserts idempotently on (kind,key), bumping last_seen_at and evidence on repeat', async () => {
      const first = await withTransaction(db.pool, (tx) => repo.upsertCandidates(tx, [cand()]));
      expect(first).toMatchObject({ detected: 1, updated: 0 });
      const before = await db.pool.query(
        "select last_seen_at, first_seen_at from knowledge_gaps where kind='zero_results' and key='esim'",
      );
      await new Promise((r) => setTimeout(r, 20));
      const second = await withTransaction(db.pool, (tx) =>
        repo.upsertCandidates(tx, [cand({ score: 7, evidence: { count: 7 } })]),
      );
      expect(second).toMatchObject({ detected: 0, updated: 1 });
      const after = await db.pool.query(
        "select last_seen_at, first_seen_at, score, evidence from knowledge_gaps where kind='zero_results' and key='esim'",
      );
      expect(after.rowCount).toBe(1);
      expect(new Date(after.rows[0].last_seen_at).getTime()).toBeGreaterThan(
        new Date(before.rows[0].last_seen_at).getTime(),
      );
      expect(after.rows[0].first_seen_at).toEqual(before.rows[0].first_seen_at);
      expect(Number(after.rows[0].score)).toBe(7);
      expect(after.rows[0].evidence).toEqual({ count: 7 });
    });

    it('does not reopen a dismissed gap on repeat, and lists by status', async () => {
      const g = (await repo.listGaps(db.pool, { page: 1, pageSize: 20, status: 'open' }, null)).items[0]!;
      const dismissed = await withTransaction(db.pool, (tx) =>
        repo.dismissGap(tx, g.id, 'לא רלוונטי', lead.id),
      );
      expect(dismissed?.status).toBe('dismissed');
      await withTransaction(db.pool, (tx) => repo.upsertCandidates(tx, [cand()]));
      const still = await repo.getGap(db.pool, g.id);
      expect(still?.status).toBe('dismissed');
      expect((await repo.listGaps(db.pool, { page: 1, pageSize: 20, status: 'open' }, null)).total).toBe(0);
      expect((await repo.listGaps(db.pool, { page: 1, pageSize: 20, status: 'dismissed' }, null)).total).toBe(
        1,
      );
      // Clear the fixture row: the heuristics below produce the real `zero_results` gap, and a
      // dismissed row with the same (kind,key) would swallow it.
      await db.pool.query(`delete from knowledge_gaps`);
    });
  });

  describe('heuristics', () => {
    const T = { zeroResultMin: 3, feedbackClusterMin: 2, staleDays: 180, failedQuestionRate: 0.5 };
    let docId: string;
    let topicId: string;

    beforeAll(async () => {
      const w = await db.pool.query(`select id from worlds where slug='tech'`);
      const t = await db.pool.query(
        `insert into topics(world_id, slug, name) values ($1,'apn-no-proc','APN בלי נוהל') returning id`,
        [w.rows[0].id],
      );
      topicId = t.rows[0].id;
      const d = await db.pool.query(
        `insert into documents(slug, title, description, category, wave, priority, kind, status, doc_type, current_version, updated_at)
         values ('stale-doc','מסמך ישן','', 'tech', 1, 'h', 'steps', 'published', 'I', 1, now() - interval '200 days') returning id`,
      );
      docId = d.rows[0].id;
      await db.pool.query(`insert into document_worlds(document_id, world_slug) values ($1,'tech')`, [docId]);
      await db.pool.query(`insert into document_topics(document_id, topic_id) values ($1,$2)`, [
        docId,
        topicId,
      ]);
      await db.pool.query(`insert into topic_views(user_id, topic_id, count) values ($1,$2,4)`, [
        agent.id,
        topicId,
      ]);
      // Views: this document is the only one with any, so it is the top of the distribution.
      await db.pool.query(`insert into recent_views(user_id, document_id, count) values ($1,$2,50)`, [
        agent.id,
        docId,
      ]);
      // Zero-result searches: three spellings of one stem, one unrelated.
      for (const q of ['eSIM', 'esim!', 'והesim', 'xyz']) {
        await db.pool.query(`insert into search_log(user_id, q, results) values ($1,$2,0)`, [agent.id, q]);
      }
      // Feedback cluster: two open "the answer is not here" reports on the same document.
      for (const k of ['no_answer', 'missing']) {
        await db.pool.query(
          `insert into feedback(document_id, document_version, world_slug, kind, text, status, user_id) values ($1,1,'tech',$2,'',$3,$4)`,
          [docId, k, 'new', agent.id],
        );
      }
    }, 60000);

    it('clusters zero-result searches by stem at the threshold', async () => {
      const out = await heur.zeroResultClusters(db.pool, T);
      const esim = out.find((c) => c.key === 'esim');
      expect(esim).toBeDefined();
      expect(esim!.evidence).toMatchObject({ count: 3 });
      expect((esim!.evidence.samples as string[]).length).toBeGreaterThan(0);
      expect(out.find((c) => c.key === 'xyz')).toBeUndefined();
      expect(esim!.suggestedAction).toBe('create');
    });

    it('clusters open no_answer/missing feedback per document', async () => {
      const out = await heur.feedbackClusters(db.pool, T);
      const g = out.find((c) => c.documentId === docId);
      expect(g).toMatchObject({
        kind: 'feedback_cluster',
        key: docId,
        worldSlug: 'tech',
        suggestedAction: 'update',
      });
      expect(g!.evidence).toMatchObject({ open: 2 });
    });

    it('flags top-decile traffic documents not updated within staleDays', async () => {
      const out = await heur.staleHighTraffic(db.pool, T);
      expect(out.find((c) => c.documentId === docId)).toMatchObject({
        kind: 'stale_high_traffic',
        suggestedAction: 'update',
      });
      expect(await heur.staleHighTraffic(db.pool, { ...T, staleDays: 400 })).toEqual([]);
    });

    it('flags viewed topics that have no published R/O item', async () => {
      const out = await heur.topicsWithoutProcedure(db.pool);
      const g = out.find((c) => c.title.includes('APN בלי נוהל'));
      expect(g).toMatchObject({
        kind: 'topic_without_procedure',
        worldSlug: 'tech',
        suggestedAction: 'create',
      });
      // Adding a published R item to the topic clears it.
      const r = await db.pool.query(
        `insert into documents(slug, title, description, category, wave, priority, kind, status, doc_type, current_version)
         values ('apn-route','מסלול APN','', 'tech', 1, 'h', 'steps', 'published', 'R', 1) returning id`,
      );
      await db.pool.query(`insert into document_topics(document_id, topic_id) values ($1,$2)`, [
        r.rows[0].id,
        g!.topicId,
      ]);
      expect(
        (await heur.topicsWithoutProcedure(db.pool)).find((c) => c.topicId === g!.topicId),
      ).toBeUndefined();
    });

    it('returns no failed-question gaps while the learning tables are absent', async () => {
      const has = await db.pool.query(`select to_regclass('public.learning_attempts') t`);
      if (has.rows[0].t) return; // V2 merged: covered by the cross-lane test in V6
      expect(await heur.failedQuestions(db.pool, T)).toEqual([]);
    });
  });

  describe('routes', () => {
    beforeAll(async () => {
      // A real run reads its thresholds from `WorkflowSettings`, where `feedbackClusterMin`
      // defaults to 3 — the heuristics fixture above is deliberately at the boundary with its
      // own threshold of 2, so one more report is what makes this cluster visible to the job.
      const d = await db.pool.query(`select id from documents where slug='stale-doc'`);
      await db.pool.query(
        `insert into feedback(document_id, document_version, world_slug, kind, text, status, user_id)
         values ($1,1,'tech','no_answer','','new',$2)`,
        [d.rows[0].id, agent.id],
      );
    });

    it('detect (gaps.manage) upserts, records the run and notifies once per new gap', async () => {
      const seen: { kind: string; title: string }[] = [];
      app.notifier.swap({
        notify: async (n) => {
          seen.push({ kind: n.kind, title: n.title });
        },
      });
      const r1 = await app.inject({ method: 'POST', url: '/api/v1/gaps/detect', headers: auth(lead) });
      expect(r1.statusCode).toBe(200);
      const body = r1.json();
      expect(body.detected).toBeGreaterThan(0);
      expect(seen.filter((s) => s.kind === 'gap').length).toBe(body.detected);
      const r2 = await app.inject({ method: 'POST', url: '/api/v1/gaps/detect', headers: auth(lead) });
      expect(r2.json().detected).toBe(0);
      expect(r2.json().updated).toBeGreaterThan(0);
      const runs = await db.pool.query('select count(*)::int n from gap_runs');
      expect(runs.rows[0].n).toBeGreaterThanOrEqual(2);
    });

    it('GET /gaps lists open gaps ranked, with lastRunAt; agents are refused', async () => {
      const r = await app.inject({ method: 'GET', url: '/api/v1/gaps', headers: auth(editor) });
      expect(r.statusCode).toBe(200);
      const j = r.json();
      expect(j.lastRunAt).not.toBeNull();
      expect(j.items.length).toBeGreaterThan(0);
      for (let i = 1; i < j.items.length; i++)
        expect(j.items[i - 1].score).toBeGreaterThanOrEqual(j.items[i].score);
      expect(
        (await app.inject({ method: 'GET', url: '/api/v1/gaps', headers: auth(agent) })).statusCode,
      ).toBe(403);
    });

    it('a world-scoped editor sees only their worlds plus world-less gaps', async () => {
      const scoped = await makeUser(db.pool, { perms: ['docs.read', 'gaps.read'], scopes: ['sim'] });
      const r = await app.inject({ method: 'GET', url: '/api/v1/gaps', headers: auth(scoped) });
      expect(r.statusCode).toBe(200);
      const items = r.json().items as { worldSlug: string | null }[];
      expect(items.length).toBeGreaterThan(0);
      for (const g of items) expect(g.worldSlug === null || g.worldSlug === 'sim').toBe(true);
      // …and the unrestricted lead does see the `tech` ones, so this is a filter and not a break.
      const all = (await app.inject({ method: 'GET', url: '/api/v1/gaps', headers: auth(lead) })).json()
        .items as { worldSlug: string | null }[];
      expect(all.some((g) => g.worldSlug === 'tech')).toBe(true);
    });

    it('dismiss needs gaps.manage and a reason; resolve links a document and resolves when it is published', async () => {
      const list = (
        await app.inject({ method: 'GET', url: '/api/v1/gaps?kind=feedback_cluster', headers: auth(lead) })
      ).json();
      const g = list.items[0];
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/v1/gaps/${g.id}/dismiss`,
            headers: auth(editor),
            payload: { reason: 'x' },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/v1/gaps/${g.id}/dismiss`,
            headers: auth(lead),
            payload: {},
          })
        ).statusCode,
      ).toBe(400);
      const zr = (
        await app.inject({ method: 'GET', url: '/api/v1/gaps?kind=zero_results', headers: auth(lead) })
      ).json().items[0];
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/gaps/${zr.id}/resolve`,
        headers: auth(lead),
        payload: { documentId: g.documentId },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('resolved'); // the linked document is already published
      const dis = await app.inject({
        method: 'POST',
        url: `/api/v1/gaps/${g.id}/dismiss`,
        headers: auth(lead),
        payload: { reason: 'כפילות' },
      });
      expect(dis.json()).toMatchObject({ status: 'dismissed', dismissedReason: 'כפילות' });
      const audit = await db.pool.query(
        `select action from audit_log where entity_type='gap' and entity_id=$1 order by at`,
        [g.id],
      );
      expect(audit.rows.map((r) => r.action)).toContain('gaps.dismiss');
    });
  });
});
