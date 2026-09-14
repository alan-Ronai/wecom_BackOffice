import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth } from './helpers/fixtures.js';

const run = integration ? describe : describe.skip;
run('taxonomy', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let admin: Awaited<ReturnType<typeof makeUser>>;
  let agent: Awaited<ReturnType<typeof makeUser>>;
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    admin = await makeUser(db.pool);
    agent = await makeUser(db.pool, { perms: ['docs.read'] });
  }, 120000);
  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  it('lists the six seeded worlds with counts', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/worlds', headers: auth(agent) });
    expect(r.statusCode).toBe(200);
    expect(r.json().items.map((w: { slug: string }) => w.slug)).toEqual([
      'sim',
      'tech',
      'billing',
      'plans',
      'intl',
      'ops',
    ]);
    expect(r.json().items[0]).toMatchObject({ topicCount: 0, itemCount: 0, active: true });
  });

  it('creates, patches, reorders and deactivates a world (admin only), auditing each', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/worlds',
          headers: auth(agent),
          payload: { slug: 'x', name: 'x' },
        })
      ).statusCode,
    ).toBe(403);
    const c = await app.inject({
      method: 'POST',
      url: '/api/v1/worlds',
      headers: auth(admin),
      payload: { slug: 'field', name: 'שטח', description: 'טכנאי שטח' },
    });
    expect(c.statusCode).toBe(201);
    expect(c.json()).toMatchObject({ slug: 'field', name: 'שטח', position: 6, active: true });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/worlds',
          headers: auth(admin),
          payload: { slug: 'field', name: 'dup' },
        })
      ).statusCode,
    ).toBe(409);
    const p = await app.inject({
      method: 'PATCH',
      url: '/api/v1/worlds/field',
      headers: auth(admin),
      payload: { name: 'שטח ומתקינים' },
    });
    expect(p.json().name).toBe('שטח ומתקינים');
    const ids = (await app.inject({ method: 'GET', url: '/api/v1/worlds', headers: auth(admin) }))
      .json()
      .items.map((w: { id: string }) => w.id);
    const re = await app.inject({
      method: 'PUT',
      url: '/api/v1/worlds/reorder',
      headers: auth(admin),
      payload: { ids: [...ids].reverse() },
    });
    expect(re.json().items[0].slug).toBe('field');
    const d = await app.inject({ method: 'DELETE', url: '/api/v1/worlds/field', headers: auth(admin) });
    expect(d.statusCode).toBe(204);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/worlds', headers: auth(admin) }))
        .json()
        .items.some((w: { slug: string }) => w.slug === 'field'),
    ).toBe(false);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/worlds?includeInactive=true', headers: auth(admin) }))
        .json()
        .items.some((w: { slug: string }) => w.slug === 'field'),
    ).toBe(true);
    const a = await db.pool.query(`select action from audit_log where entity_type='world' order by at`);
    expect(a.rows.map((x) => x.action)).toEqual([
      'taxonomy.world.create',
      'taxonomy.world.edit',
      'taxonomy.world.reorder',
      'taxonomy.world.deactivate',
    ]);
  });

  it('refuses to deactivate a world that still has items unless forced', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: auth(admin),
      payload: { title: 'a', category: 'billing', wave: 1, priority: 'l', kind: 'steps' },
    });
    const d = await app.inject({ method: 'DELETE', url: '/api/v1/worlds/billing', headers: auth(admin) });
    expect(d.statusCode).toBe(409);
    expect(d.json().code).toBe('WORLD_IN_USE');
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/v1/worlds/billing?force=true', headers: auth(admin) }))
        .statusCode,
    ).toBe(204);
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/worlds/billing',
      headers: auth(admin),
      payload: { active: true },
    });
  });

  it('manages topics under a world and can move one between worlds', async () => {
    const c = await app.inject({
      method: 'POST',
      url: '/api/v1/worlds/tech/topics',
      headers: auth(admin),
      payload: { slug: 'apn', name: 'APN', description: 'הגדרות גלישה' },
    });
    expect(c.statusCode).toBe(201);
    const t = c.json();
    expect(t).toMatchObject({ worldSlug: 'tech', slug: 'apn', position: 0, itemCount: 0 });
    const c2 = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/worlds/tech/topics',
        headers: auth(admin),
        payload: { slug: 'wifi', name: 'Wi-Fi' },
      })
    ).json();
    expect(c2.position).toBe(1);
    const l = await app.inject({ method: 'GET', url: '/api/v1/worlds/tech/topics', headers: auth(agent) });
    expect(l.json().items.map((x: { slug: string }) => x.slug)).toEqual(['apn', 'wifi']);
    const re = await app.inject({
      method: 'PUT',
      url: '/api/v1/worlds/tech/topics/reorder',
      headers: auth(admin),
      payload: { ids: [c2.id, t.id] },
    });
    expect(re.json().items.map((x: { slug: string }) => x.slug)).toEqual(['wifi', 'apn']);
    const mv = await app.inject({
      method: 'PATCH',
      url: `/api/v1/topics/${t.id}`,
      headers: auth(admin),
      payload: { worldSlug: 'sim', name: 'APN (SIM)' },
    });
    expect(mv.json()).toMatchObject({ worldSlug: 'sim', name: 'APN (SIM)' });
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/topics/${t.id}`, headers: auth(admin) }))
        .statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/worlds/sim/topics', headers: auth(agent) })).json()
        .items,
    ).toEqual([]);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/worlds/nope/topics',
          headers: auth(admin),
          payload: { slug: 'x', name: 'x' },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('exposes PgTaxonomy through app.taxonomy', async () => {
    const d = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(admin),
        payload: { title: 'w', category: 'ops', wave: 1, priority: 'l', kind: 'steps', worlds: ['sim'] },
      })
    ).json();
    expect(await app.taxonomy.worldsOf(d.id)).toEqual(['ops', 'sim']);
    expect(await app.taxonomy.worldsOf('00000000-0000-4000-8000-000000000000')).toEqual([]);
    const lead = await makeUser(db.pool, { perms: ['docs.publish'], scopes: ['sim'] });
    await db.pool.query(
      `insert into user_roles(user_id, role_id, world_scope) select $1, id, '{"sim"}' from roles where name='lead'`,
      [lead.id],
    );
    expect(await app.taxonomy.usersWithPermissionInWorld('docs.publish', 'sim')).toContain(lead.id);
    expect(await app.taxonomy.usersWithPermissionInWorld('docs.publish', 'tech')).not.toContain(lead.id);
  });

  it('groups a topic view by doc type in PRD order and applies visibility', async () => {
    const topic = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/worlds/intl/topics',
        headers: auth(admin),
        payload: { slug: 'roaming', name: 'נדידה' },
      })
    ).json();
    const mk = async (title: string, docType: string, status: string, tags: string[] = []) => {
      const d = (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents',
          headers: auth(admin),
          payload: {
            title,
            category: 'intl',
            wave: 1,
            priority: 'h',
            kind: 'steps',
            docType,
            tags,
            topics: [topic.id],
          },
        })
      ).json();
      await db.pool.query('update documents set status=$2 where id=$1', [d.id, status]);
      return d.id as string;
    };
    const o = await mk('הפעלת נדידה', 'O', 'published', ['roaming']);
    const m = await mk('אבחון נדידה', 'M', 'published');
    const draft = await mk('טיוטה', 'R', 'draft');
    const asAdmin = await app.inject({
      method: 'GET',
      url: `/api/v1/topics/${topic.id}/items`,
      headers: auth(admin),
    });
    expect(asAdmin.statusCode).toBe(200);
    expect(asAdmin.json().topic.slug).toBe('roaming');
    expect(asAdmin.json().world.slug).toBe('intl');
    expect(asAdmin.json().groups.map((g: { docType: string }) => g.docType)).toEqual(['M', 'R', 'O']);
    const asAgent = await app.inject({
      method: 'GET',
      url: `/api/v1/topics/${topic.id}/items`,
      headers: auth(agent),
    });
    expect(asAgent.json().groups.map((g: { docType: string }) => g.docType)).toEqual(['M', 'O']);
    expect(asAgent.json().groups[1].items[0]).toMatchObject({
      id: o,
      docType: 'O',
      worlds: ['intl'],
      tags: ['roaming'],
    });
    expect(JSON.stringify(asAgent.json())).not.toContain(draft);
    // A-M4: a topic in a world the caller cannot read is a 404, not an in-scope topic with an
    // empty list — otherwise `topic.name` and `world.name` leak across the scope boundary.
    const scoped = await makeUser(db.pool, { perms: ['docs.read'], scopes: ['sim'] });
    const outOfScope = await app.inject({
      method: 'GET',
      url: `/api/v1/topics/${topic.id}/items`,
      headers: auth(scoped),
    });
    expect(outOfScope.statusCode).toBe(404);
    expect(outOfScope.body).not.toContain('נדידה');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/topics/00000000-0000-4000-8000-000000000000/items`,
          headers: auth(agent),
        })
      ).statusCode,
    ).toBe(404);
    void m;
  });

  // A-M4, second half: a view is only a browse when the caller actually saw something. An
  // out-of-scope topic never reaches `recordTopicView` (it 404s above); an in-scope topic with
  // nothing visible in it must not climb the "נושאים נצפים" card either.
  it('records a topic view only for a non-empty result', async () => {
    const empty = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/worlds/ops/topics',
        headers: auth(admin),
        payload: { slug: 'empty-topic', name: 'ריק' },
      })
    ).json();
    const viewsOf = async (id: string) =>
      (await db.pool.query('select count(*)::int n from topic_views where topic_id = $1', [id])).rows[0].n;

    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/topics/${empty.id}/items`, headers: auth(agent) }))
        .statusCode,
    ).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(await viewsOf(empty.id)).toBe(0);

    const filled = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/worlds/ops/topics',
        headers: auth(admin),
        payload: { slug: 'filled-topic', name: 'מלא' },
      })
    ).json();
    const d = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(admin),
        payload: {
          title: 'פריט גלוי',
          category: 'ops',
          wave: 1,
          priority: 'h',
          kind: 'steps',
          docType: 'O',
          topics: [filled.id],
        },
      })
    ).json();
    await db.pool.query(`update documents set status='published' where id=$1`, [d.id]);
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/topics/${filled.id}/items`, headers: auth(agent) }))
        .statusCode,
    ).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(await viewsOf(filled.id)).toBe(1);
  });

  it('lists tags with counts and a prefix filter', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/tags?q=roam', headers: auth(agent) });
    expect(r.json().items).toEqual([{ tag: 'roaming', count: 1 }]);
    const all = await app.inject({ method: 'GET', url: '/api/v1/tags', headers: auth(agent) });
    expect(all.json().items.length).toBeGreaterThanOrEqual(1);
  });
});
