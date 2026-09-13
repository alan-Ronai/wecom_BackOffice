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
});
