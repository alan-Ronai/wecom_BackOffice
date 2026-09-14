import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from '../helpers/db.js';
import { buildTestApp } from '../helpers/app.js';
import { makeUser, auth } from '../helpers/fixtures.js';

const run = integration ? describe : describe.skip;

/**
 * The joints between the wave 4 lanes — the things no single lane could test because each half
 * lived on a different branch.
 *
 * Every case here is a *link* rather than a feature: the published version knows which source
 * version it came from, the approval knows who approved it, an alert can name its own kind, and
 * the analytics that reads a topic's views is fed by the page that shows them.
 */
run('wave 4 seams', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let lead: Awaited<ReturnType<typeof makeUser>>;
  let editor: Awaited<ReturnType<typeof makeUser>>;

  const makeDoc = async (title: string) =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(lead),
        payload: { title, description: '', category: 'tech', wave: 1, priority: 'm', kind: 'steps' },
      })
    ).json().id as string;

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    lead = await makeUser(db.pool, { name: 'ראש צוות' });
    editor = await makeUser(db.pool, {
      name: 'עורך',
      perms: ['docs.read', 'docs.edit', 'docs.read_unpublished'],
    });
  }, 180000);

  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  it('W4→W2: publish records the source version the working view was derived from', async () => {
    const id = await makeDoc('קישור גרסת מקור');
    const save = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${id}/source`,
      headers: auth(lead),
      payload: { html: '<p>מקור ראשון</p>', label: 'ראשון' },
    });
    expect(save.statusCode, save.body).toBe(200);
    expect(save.json().version).toBe(1);

    const pub = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${id}/publish`,
      headers: auth(lead),
      payload: { label: 'v1' },
    });
    expect(pub.statusCode, pub.body).toBe(200);

    const r = await db.pool.query(
      'select source_version from document_versions where document_id=$1 order by version desc limit 1',
      [id],
    );
    // Nobody passed it: `publishDocument` reads it, so every publish path records the link.
    expect(r.rows[0].source_version).toBe(1);
  });

  it('W2: review approval stamps approver_id and publishes', async () => {
    const id = await makeDoc('מסמך לסקירה');
    const rq = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${id}/request-review`,
      headers: auth(editor),
      payload: { note: 'בבקשה' },
    });
    expect(rq.statusCode, rq.body).toBe(201);
    const dec = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${id}/review-decision`,
      headers: auth(lead),
      payload: { decision: 'approve', label: 'אושר' },
    });
    expect(dec.statusCode, dec.body).toBe(200);
    const r = await db.pool.query('select approver_id, status, published_at from documents where id=$1', [
      id,
    ]);
    expect(r.rows[0].approver_id).toBe(lead.id);
    expect(r.rows[0].status).toBe('published');
    expect(r.rows[0].published_at).not.toBeNull();
  });

  it('W3→wave 3: an alert row carries the wave 4 kind, not a wave 3 stand-in', async () => {
    const u = await makeUser(db.pool, { name: 'נמען' });
    await expect(
      db.pool.query(
        `insert into notifications(user_id, kind, title) values ($1,'feedback','x'),($1,'source','y')`,
        [u.id],
      ),
    ).resolves.toBeTruthy();
    const kinds = (
      await db.pool.query('select kind from notifications where user_id=$1 order by kind', [u.id])
    ).rows.map((r) => r.kind);
    expect(kinds).toEqual(['feedback', 'source']);
  });

  it('W1→W5: opening a topic feeds the usage analytics', async () => {
    const world = 'tech';
    const topicId = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/worlds/${world}/topics`,
        headers: auth(lead),
        payload: { slug: 'seam-topic', name: 'נושא תפר', description: '', active: true },
      })
    ).json().id as string;

    // A-M4: only a non-empty result counts as a browse, so the seam needs something visible in
    // the topic — an empty topic is opened but never recorded.
    const docId = await makeDoc('פריט בנושא התפר');
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${docId}`,
      headers: auth(lead),
      payload: { topics: [topicId] },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/publish`,
      headers: auth(lead),
      payload: { label: 'v1' },
    });

    const view = await app.inject({
      method: 'GET',
      url: `/api/v1/topics/${topicId}/items`,
      headers: auth(lead),
    });
    expect(view.json().groups.length, view.body).toBeGreaterThan(0);
    expect(view.statusCode, view.body).toBe(200);
    // `recordTopicView` is deliberately not awaited by the route, so give it a tick.
    await new Promise((r) => setTimeout(r, 100));

    const analytics = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/usage?limit=20',
      headers: auth(lead),
    });
    expect(analytics.statusCode, analytics.body).toBe(200);
    expect(analytics.json().topTopics.map((t: { topicId: string }) => t.topicId)).toContain(topicId);
  });

  it('W3→W2: publishing with resolveFeedbackIds closes the report against that version', async () => {
    const id = await makeDoc('משוב שנסגר בפרסום');
    const fb = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${id}/feedback`,
      headers: auth(lead),
      payload: { kind: 'error', text: 'טעות בשלב 1' },
    });
    expect(fb.statusCode, fb.body).toBe(201);
    const feedbackId = fb.json().id as string;

    const pub = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${id}/publish`,
      headers: auth(lead),
      payload: { label: 'תיקון', resolveFeedbackIds: [feedbackId] },
    });
    expect(pub.statusCode, pub.body).toBe(200);
    const version = pub.json().version as number;

    const row = await db.pool.query('select status, resolved_version from feedback where id=$1', [
      feedbackId,
    ]);
    expect(row.rows[0].status).toBe('done');
    expect(row.rows[0].resolved_version).toBe(version);
  });

  it('W1→W6: a freshly migrated database finds an item by its tag', async () => {
    const id = await makeDoc('פריט מתויג');
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${id}`,
      headers: auth(lead),
      payload: { tags: ['seamtag'] },
    });
    // 0035: the search vector carries tags *and* strips Hebrew stopwords, whichever order the
    // migrations ran in.
    const vec = (await db.pool.query('select search_vector::text v from documents where id=$1', [id])).rows[0]
      .v as string;
    expect(vec).toMatch(/'seamtag':/);
    const hits = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=seamtag&types=tags',
      headers: auth(lead),
    });
    expect(hits.statusCode, hits.body).toBe(200);
    expect(JSON.stringify(hits.json())).toContain(id);
  });
});
