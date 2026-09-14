import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth, minimalStructure } from './helpers/fixtures.js';

const run = integration ? describe : describe.skip;
run('documents', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let u: Awaited<ReturnType<typeof makeUser>>;
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    u = await makeUser(db.pool);
  }, 120000);
  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  it('creates, lists and gets a document', async () => {
    const c = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: auth(u),
      payload: {
        title: 'איטיות גלישה',
        description: 'x',
        category: 'tech',
        wave: 1,
        priority: 'hh',
        kind: 'steps',
      },
    });
    expect(c.statusCode).toBe(201);
    const doc = c.json();
    expect(doc.slug).toMatch(/^[a-z0-9-]+$/);
    expect(doc.status).toBe('draft');
    expect(doc.phases).toEqual([]);
    const l = await app.inject({ method: 'GET', url: '/api/v1/documents?category=tech', headers: auth(u) });
    expect(l.json().total).toBe(1);
    expect(l.json().items[0].stepCount).toBe(0);
    expect(l.json().items[0].pinned).toBe(false);
    const g = await app.inject({ method: 'GET', url: `/api/v1/documents/${doc.id}`, headers: auth(u) });
    expect(g.json().title).toBe('איטיות גלישה');
    expect(g.headers.etag).toBeDefined();
  });

  it('patches metadata and audits it', async () => {
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'a', category: 'intl', wave: 2, priority: 'm', kind: 'steps' },
      })
    ).json();
    const p = await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${c.id}`,
      headers: auth(u),
      payload: { title: 'b', wave: 3 },
    });
    expect(p.json().title).toBe('b');
    expect(p.json().wave).toBe(3);
    const a = await db.pool.query(
      "select count(*)::int n from audit_log where action='docs.edit' and entity_id=$1",
      [c.id],
    );
    expect(a.rows[0].n).toBe(1);
  });

  it('enforces category scope on patch', async () => {
    const scoped = await makeUser(db.pool, { scopes: ['sim'] });
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'a', category: 'intl', wave: 2, priority: 'm', kind: 'steps' },
      })
    ).json();
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/documents/${c.id}`,
          headers: auth(scoped),
          payload: { title: 'z' },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('saves structure, recomputes field refs, links and search text, and rotates etag', async () => {
    await db.pool.query(
      "insert into crm_fields(name, path) values ('גלישה בארץ','CRM'), ('השימושים שלי','אזור אישי')",
    );
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'איטיות', category: 'tech', wave: 1, priority: 'hh', kind: 'steps' },
      })
    ).json();
    const other = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: {
          title: 'אחר',
          category: 'tech',
          wave: 1,
          priority: 'm',
          kind: 'steps',
          slug: 'other-doc',
        },
      })
    ).json();
    const structure = JSON.parse(JSON.stringify(minimalStructure));
    structure.related = [{ documentId: other.id, why: 'קשור' }];
    structure.phases[0].steps[1].actions.push({ id: 'a2', text: 'ראה [[doc:' + other.id + ']]' });
    const s = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${c.id}/structure`,
      headers: { ...auth(u), 'if-match': c.etag },
      payload: structure,
    });
    expect(s.statusCode).toBe(200);
    expect(s.json().etag).not.toBe(c.etag);
    expect(s.json().phases[0].steps).toHaveLength(2);
    const refs = await db.pool.query(
      'select f.field_name from step_field_refs f join steps s on s.id=f.step_id where s.document_id=$1 order by 1',
      [c.id],
    );
    expect(refs.rows.map((r) => r.field_name)).toEqual(['גלישה בארץ', 'השימושים שלי']);
    const links = await db.pool.query(
      'select type, from_step_key from document_links where from_document_id=$1 order by 1',
      [c.id],
    );
    expect(links.rows).toEqual([
      { type: 'link', from_step_key: 's2' },
      { type: 'related', from_step_key: null },
    ]);
    expect(
      (await db.pool.query('select search_text from documents where id=$1', [c.id])).rows[0].search_text,
    ).toContain('השימושים שלי');
    const stale = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${c.id}/structure`,
      headers: { ...auth(u), 'if-match': c.etag },
      payload: minimalStructure,
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.json().code).toBe('ETAG_MISMATCH');
    // Optimistic concurrency is no longer opt-in: omitting If-Match used to
    // silently clobber a concurrent editor.
    const noHeader = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${c.id}/structure`,
      headers: auth(u),
      payload: minimalStructure,
    });
    expect(noHeader.statusCode).toBe(428);
    expect(noHeader.json().code).toBe('IF_MATCH_REQUIRED');
  });

  it('PATCH honours If-Match and 404s on a deleted document', async () => {
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'מקביליות', category: 'tech', wave: 1, priority: 'm', kind: 'steps' },
      })
    ).json();
    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${c.id}`,
      headers: { ...auth(u), 'if-match': 'not-the-etag' },
      payload: { title: 'לא יקרה' },
    });
    expect(stale.statusCode).toBe(412);
    const ok = await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${c.id}`,
      headers: { ...auth(u), 'if-match': c.etag },
      payload: { title: 'יקרה' },
    });
    expect(ok.statusCode).toBe(200);
    // A patch of a concurrently-deleted document used to 500 on getDocument(...)!
    await db.pool.query('update documents set deleted_at=now() where id=$1', [c.id]);
    const gone = await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${c.id}`,
      headers: auth(u),
      payload: { title: 'אחרי מחיקה' },
    });
    expect(gone.statusCode).toBe(404);
  });

  it('publishes a version, diffs, restores', async () => {
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'פרסום', category: 'tech', wave: 1, priority: 'hh', kind: 'steps' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${c.id}/structure`,
      headers: { ...auth(u), 'if-match': c.etag },
      payload: minimalStructure,
    });
    const p1 = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${c.id}/publish`,
      headers: auth(u),
      payload: { label: 'גרסה ראשונה' },
    });
    expect(p1.statusCode).toBe(200);
    expect(p1.json().version).toBe(1);
    expect(p1.json().document.status).toBe('published');
    expect(p1.json().auditId).toBeDefined();
    const s2 = JSON.parse(JSON.stringify(minimalStructure));
    s2.phases[0].steps[1].actions[0].text = 'אזור אישי ↗ "השימושים שלי" ← רענן';
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${c.id}/structure`,
      headers: { ...auth(u), 'if-match': p1.json().document.etag },
      payload: s2,
    });
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/documents/${c.id}`, headers: auth(u) })).json().status,
    ).toBe('review');
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${c.id}/publish`,
      headers: auth(u),
      payload: { label: 'תיקון' },
    });
    const vs = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${c.id}/versions`, headers: auth(u) })
    ).json();
    expect(vs.items.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    const d = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${c.id}/diff?from=1&to=2`,
        headers: auth(u),
      })
    ).json();
    expect(d.stats).toEqual({ changed: 1, added: 0, removed: 0 });
    expect(d.rows[1].blame).toEqual({ version: 2, author: u.name });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${c.id}/restore/1`,
      headers: auth(u),
    });
    expect(r.json().version).toBe(3);
    expect(
      (
        await app.inject({ method: 'GET', url: `/api/v1/documents/${c.id}/versions/3`, headers: auth(u) })
      ).json().phases[0].steps[1].actions[0].text,
    ).toBe(minimalStructure.phases[0].steps[1].actions[0].text);
  });

  it('marks empty steps as partial on publish', async () => {
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'חלקי', category: 'tech', wave: 2, priority: 'm', kind: 'steps' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${c.id}/structure`,
      headers: { ...auth(u), 'if-match': c.etag },
      payload: { phases: [{ id: 'p1', label: '', steps: [{ key: 's1', num: '1', title: 'ריק' }] }] },
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/documents/${c.id}/publish`,
          headers: auth(u),
          payload: { label: 'x' },
        })
      ).json().document.status,
    ).toBe('partial');
  });

  it('pins, records views and lists links/related', async () => {
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'p', category: 'ops', wave: 1, priority: 'm', kind: 'steps' },
      })
    ).json();
    expect(
      (await app.inject({ method: 'POST', url: `/api/v1/documents/${c.id}/pin`, headers: auth(u) }))
        .statusCode,
    ).toBe(204);
    await app.inject({ method: 'POST', url: `/api/v1/documents/${c.id}/view`, headers: auth(u) });
    await app.inject({ method: 'POST', url: `/api/v1/documents/${c.id}/view`, headers: auth(u) });
    const l = (
      await app.inject({ method: 'GET', url: '/api/v1/documents?pinned=true', headers: auth(u) })
    ).json();
    expect(l.items.map((x: { id: string }) => x.id)).toEqual([c.id]);
    expect(l.items[0].views).toBe(2);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/documents/${c.id}/pin`, headers: auth(u) }))
        .statusCode,
    ).toBe(204);
    const rel = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${c.id}/related`, headers: auth(u) })
    ).json();
    expect(Array.isArray(rel.items)).toBe(true);
    const links = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${c.id}/links`, headers: auth(u) })
    ).json();
    expect(links).toMatchObject({ out: [], in: [] });
  });

  it('soft deletes and hides from list/get; lead needs docs.delete', async () => {
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'del', category: 'tech', wave: 1, priority: 'm', kind: 'steps' },
      })
    ).json();
    const editor = await makeUser(db.pool, { perms: ['docs.read', 'docs.edit'] });
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/documents/${c.id}`, headers: auth(editor) }))
        .statusCode,
    ).toBe(403);
    const d = await app.inject({ method: 'DELETE', url: `/api/v1/documents/${c.id}`, headers: auth(u) });
    expect(d.statusCode).toBe(200);
    expect(d.json().auditId).toBeDefined();
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/documents/${c.id}`, headers: auth(u) })).statusCode,
    ).toBe(404);
  });

  it('creates with taxonomy, keeps the primary world first, filters by world/type/tag', async () => {
    const topic = (
      await db.pool.query(
        `insert into topics(world_id, slug, name) select id, 'apn', 'APN' from worlds where slug='tech' returning id`,
      )
    ).rows[0].id as string;
    const c = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: auth(u),
      payload: {
        title: 'הגדרת APN',
        category: 'tech',
        wave: 1,
        priority: 'h',
        kind: 'steps',
        docType: 'O',
        tags: ['apn', 'android'],
        worlds: ['sim', 'tech'],
        topics: [topic],
      },
    });
    expect(c.statusCode).toBe(201);
    const d = c.json();
    expect(d.docType).toBe('O');
    expect(d.worlds).toEqual(['tech', 'sim']);
    expect(d.topics).toEqual([topic]);
    expect(d.tags).toEqual(['apn', 'android']);
    const byWorld = await app.inject({ method: 'GET', url: '/api/v1/documents?world=sim', headers: auth(u) });
    expect(byWorld.json().items.map((x: { id: string }) => x.id)).toContain(d.id);
    const byType = await app.inject({ method: 'GET', url: '/api/v1/documents?docType=O', headers: auth(u) });
    expect(byType.json().items.every((x: { docType: string }) => x.docType === 'O')).toBe(true);
    const byTags = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?tag=apn&tag=android',
      headers: auth(u),
    });
    expect(byTags.json().items.map((x: { id: string }) => x.id)).toEqual([d.id]);
    const miss = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?tag=apn&tag=ios',
      headers: auth(u),
    });
    expect(miss.json().total).toBe(0);
    const byTopic = await app.inject({
      method: 'GET',
      url: `/api/v1/documents?topic=${topic}`,
      headers: auth(u),
    });
    expect(byTopic.json().items[0].topics).toEqual([topic]);
  });

  it('defaults docType, patches tags/worlds, and rejects unknown worlds with 400', async () => {
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'x', category: 'ops', wave: 3, priority: 'l', kind: 'steps' },
      })
    ).json();
    expect(c.docType).toBe('R');
    expect(c.worlds).toEqual(['ops']);
    const p = await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${c.id}`,
      headers: auth(u),
      payload: { tags: ['t1'], worlds: ['billing'], category: 'plans' },
    });
    expect(p.statusCode).toBe(200);
    expect(p.json().worlds).toEqual(['plans', 'billing']);
    expect(p.json().tags).toEqual(['t1']);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: auth(u),
      payload: { title: 'y', category: 'nope', wave: 1, priority: 'l', kind: 'steps' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('UNKNOWN_WORLD');
  });

  it('a scoped user reaches an item through any shared world', async () => {
    const scoped = await makeUser(db.pool, { scopes: ['billing'] });
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: {
          title: 'shared',
          category: 'plans',
          wave: 1,
          priority: 'l',
          kind: 'steps',
          worlds: ['billing'],
        },
      })
    ).json();
    const g = await app.inject({ method: 'GET', url: `/api/v1/documents/${c.id}`, headers: auth(scoped) });
    expect(g.statusCode).toBe(200);
    const l = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?world=plans',
      headers: auth(scoped),
    });
    expect(l.json().items.map((x: { id: string }) => x.id)).toContain(c.id);
    const only = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'plans only', category: 'plans', wave: 1, priority: 'l', kind: 'steps' },
      })
    ).json();
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/documents/${only.id}`, headers: auth(scoped) }))
        .statusCode,
    ).toBe(403);
  });
  it('sanitizes bodyHtml on create and on patch (C-C2)', async () => {
    // Spec §2.1: `documents.body_html` is *sanitized* HTML. It reached the column raw, and the
    // 0030 fold means every type-T document lives in it — a populated store of unsanitized
    // markup one `dangerouslySetInnerHTML` away from being a live stored-XSS.
    const dirty = '<p onclick="x()">a<script>alert(1)</script></p>';
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: {
          title: 'גוף מסוכן',
          category: 'tech',
          wave: 1,
          priority: 'm',
          kind: 'text',
          bodyHtml: dirty,
        },
      })
    ).json();
    expect(created.bodyHtml).toBe('<p>a</p>');

    const patched = (
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/documents/${created.id}`,
        headers: auth(u),
        payload: { bodyHtml: '<p><img src="javascript:1" onerror="y()">b</p>' },
      })
    ).json();
    expect(patched.bodyHtml).toBe('<p>b</p>');
    expect(patched.bodyHtml).not.toContain('onerror');

    // A-I7: and the body is now what makes a text document findable.
    const found = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?q=' + encodeURIComponent('b'),
      headers: auth(u),
    });
    expect(found.statusCode).toBe(200);
  });
  /**
   * A-I3's rule, and the over-restriction the first attempt at it introduced.
   *
   * `body.worlds` and `body.topics` are full replacements, so the check has to be on the
   * *difference* in both directions. Checking every world in the resulting set instead refuses
   * a scoped editor for memberships they are not touching — which `config.scope: 'document'`
   * and the route's own `hasScope(user, before.worlds)` intersection have already allowed.
   */
  describe('assertTaxonomyScope', () => {
    let scoped: Awaited<ReturnType<typeof makeUser>>;
    let simTopic: string;
    let billingTopic: string;
    /** Primary world `billing`, also shared into `sim`: the caller can edit it but owns one world. */
    let shared: string;

    const topicIn = async (world: string, slug: string) =>
      (
        await db.pool.query(
          `insert into topics(world_id, slug, name) select id, $2, $2 from worlds where slug=$1 returning id`,
          [world, slug],
        )
      ).rows[0].id as string;

    const patch = (id: string, payload: unknown, as = scoped) =>
      app.inject({ method: 'PATCH', url: `/api/v1/documents/${id}`, headers: auth(as), payload });

    beforeAll(async () => {
      scoped = await makeUser(db.pool, { name: 'עורך SIM', scopes: ['sim'] });
      simTopic = await topicIn('sim', 'ai3-sim');
      billingTopic = await topicIn('billing', 'ai3-billing');
      shared = (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents',
          headers: auth(u),
          payload: {
            title: 'משותף',
            category: 'billing',
            wave: 1,
            priority: 'm',
            kind: 'steps',
            worlds: ['sim'],
            topics: [billingTopic],
          },
        })
      ).json().id as string;
    });

    it('lets a scoped editor patch topics on a shared document without touching its other worlds', async () => {
      // The regression: `resulting` is {billing, sim} and `billing` is out of scope, but the
      // write changes no world at all, so there is nothing for the caller to justify.
      const r = await patch(shared, { topics: [billingTopic, simTopic] });
      expect(r.statusCode, r.body).toBe(200);
      expect(new Set(r.json().topics)).toEqual(new Set([billingTopic, simTopic]));
      // Same for a no-op re-send of the world set, and for naming the primary explicitly.
      expect((await patch(shared, { worlds: ['sim'] })).statusCode).toBe(200);
      expect((await patch(shared, { category: 'billing' })).statusCode).toBe(200);
      // …and an ordinary field patch is untouched by any of this.
      expect((await patch(shared, { title: 'משותף — עודכן' })).statusCode).toBe(200);
    });

    it('refuses adding a world the caller cannot see', async () => {
      const r = await patch(shared, { worlds: ['sim', 'tech'] });
      expect(r.statusCode).toBe(403);
      // The membership did not change.
      const after = (
        await app.inject({ method: 'GET', url: `/api/v1/documents/${shared}`, headers: auth(u) })
      ).json();
      expect(after.worlds).not.toContain('tech');
    });

    it('refuses removing a world the caller cannot see', async () => {
      // `worlds: []` with the primary still `billing` keeps billing; dropping it needs the
      // primary to move, which is the shape that actually strips the other team's access.
      const r = await patch(shared, { category: 'sim', worlds: [] });
      expect(r.statusCode).toBe(403);
      const after = (
        await app.inject({ method: 'GET', url: `/api/v1/documents/${shared}`, headers: auth(u) })
      ).json();
      expect(after.worlds).toContain('billing');
    });

    it('refuses removing a topic whose world the caller cannot see', async () => {
      const r = await patch(shared, { topics: [simTopic] });
      expect(r.statusCode).toBe(403);
      expect(
        (await app.inject({ method: 'GET', url: `/api/v1/documents/${shared}`, headers: auth(u) })).json()
          .topics,
      ).toContain(billingTopic);
    });

    it('400s a topic that belongs to a world the document is not in', async () => {
      const techTopic = await topicIn('tech', 'ai3-tech');
      const r = await patch(shared, { topics: [billingTopic, simTopic, techTopic] });
      expect(r.statusCode).toBe(400);
      expect(r.json().code).toBe('TOPIC_OUT_OF_WORLD');
      // An application 400's `details` survives the error handler now, so the client can say
      // *which* topic and *which* world rather than just "something was wrong".
      expect(r.json().details).toMatchObject({ worldSlug: 'tech' });
      // An id that names no topic at all is the other 400.
      const unknown = await patch(shared, {
        topics: ['00000000-0000-4000-8000-000000000000'],
      });
      expect(unknown.statusCode).toBe(400);
      expect(unknown.json().code).toBe('UNKNOWN_TOPIC');
    });

    it('still applies the rule on create, where every membership is an addition', async () => {
      const out = await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(scoped),
        payload: {
          title: 'חדש מחוץ לתחום',
          category: 'sim',
          wave: 1,
          priority: 'm',
          kind: 'steps',
          worlds: ['tech'],
        },
      });
      expect(out.statusCode).toBe(403);
      const ok = await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(scoped),
        payload: {
          title: 'חדש בתחום',
          category: 'sim',
          wave: 1,
          priority: 'm',
          kind: 'steps',
          topics: [simTopic],
        },
      });
      expect(ok.statusCode, ok.body).toBe(201);
    });
  });
});
