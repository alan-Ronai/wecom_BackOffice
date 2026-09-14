import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth } from './helpers/fixtures.js';

const run = integration ? describe : describe.skip;
run('search', () => {
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

  it('finds documents by hebrew partial words and steps by action text, grouped', async () => {
    await db.pool.query("insert into crm_fields(name, path) values ('sim allow lbl','CRM')");
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: {
          title: 'איטיות גלישה / חוסר גלישה',
          category: 'tech',
          wave: 1,
          priority: 'hh',
          kind: 'steps',
        },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${c.id}/structure`,
      headers: { ...auth(u), 'if-match': c.etag },
      payload: {
        phases: [
          {
            id: 'p1',
            label: 'מסלול 2',
            steps: [
              {
                key: 's11',
                num: '11',
                title: 'ריענון SIM',
                actions: [{ id: 'a', text: 'שוב עריכה ← sim allow lbl ← שמור' }],
              },
            ],
          },
        ],
      },
    });
    const r = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/search?q=' + encodeURIComponent('ריענון sim'),
        headers: auth(u),
      })
    ).json();
    expect(r.groups.map((g: { type: string }) => g.type)).toEqual(['steps', 'fields']);
    expect(r.groups[0].hits[0]).toMatchObject({
      type: 'step',
      documentId: c.id,
      stepKey: 's11',
      num: '11',
    });
    expect(r.groups[0].hits[0].meta).toContain('topics.json');
    expect(r.groups[1].hits[0].title).toBe('sim allow lbl');
    const d = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/search?q=' + encodeURIComponent('איטיות') + '&types=documents',
        headers: auth(u),
      })
    ).json();
    expect(d.groups[0].hits[0].id).toBe(c.id);
    expect(d.files).toBe(1);
  });

  /**
   * Regression for the 0023 stopword split: the trigger `ts_delete`s "של" out of every
   * `search_vector`, so a `plainto_tsquery` that still demands it can never be satisfied.
   * The `or d.title ilike` arm hides that whenever the query is a title substring, so the
   * document deliberately carries the phrase in its *step text* and not in its title.
   */
  it('matches a Hebrew phrase containing a stopword, in the body and not only the title', async () => {
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: {
          title: 'בירור יתרה',
          description: '',
          category: 'billing',
          wave: 1,
          priority: 'm',
          kind: 'steps',
        },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${c.id}/structure`,
      headers: { ...auth(u), 'if-match': c.etag },
      payload: {
        phases: [
          {
            id: 'p1',
            label: 'שלב 1',
            steps: [
              {
                key: 's1',
                num: '1',
                title: 'בדיקת חוב',
                actions: [{ id: 'a', text: 'פתח את כרטיס חוב של לקוח ובדוק יתרה' }],
                outcomes: [{ kind: 'ok', text: '✓ סיום' }],
              },
            ],
          },
        ],
      },
    });

    const hits = async (q: string) =>
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/documents?q=' + encodeURIComponent(q),
          headers: auth(u),
        })
      ).json();

    // The phrase the reviewer reproduced with. Every word but the stopword is indexed, so
    // dropping "של" from the query is the only thing that makes the `@@` arm satisfiable.
    const withStopword = await hits('חוב של לקוח');
    expect(withStopword.items.map((x: { id: string }) => x.id)).toContain(c.id);
    // …and it is the same answer as the stopword-free phrasing, which never regressed.
    const without = await hits('חוב לקוח');
    expect(without.items.map((x: { id: string }) => x.id)).toEqual(
      withStopword.items.map((x: { id: string }) => x.id),
    );
    // The title arm is not what is carrying this: the phrase appears nowhere in the title.
    expect(withStopword.items.find((x: { id: string }) => x.id === c.id).title).toBe('בירור יתרה');
    // A word that is in no document still matches nothing — the fix widens nothing else.
    expect((await hits('חוב של צוללת')).items.map((x: { id: string }) => x.id)).not.toContain(c.id);
  });

  it('returns nothing for an empty query and reindexes', async () => {
    const empty = (await app.inject({ method: 'GET', url: '/api/v1/search?q=', headers: auth(u) })).json();
    expect(empty.groups).toEqual([]);
    expect(empty.total).toBe(0);
    const { reindexAll } = await import('../src/modules/search/repo.js');
    expect(await reindexAll(db.pool)).toBeGreaterThan(0);
  });

  it('filters by docType/world/tag and returns a tags group', async () => {
    const d = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: {
          title: 'איפוס נתב',
          category: 'tech',
          wave: 1,
          priority: 'h',
          kind: 'steps',
          docType: 'O',
          tags: ['router', 'reset'],
        },
      })
    ).json();
    const byTag = await app.inject({ method: 'GET', url: '/api/v1/search?q=router', headers: auth(u) });
    const tags = byTag.json().groups.find((g: { type: string }) => g.type === 'tags');
    expect(tags.hits.map((h: { documentId: string }) => h.documentId)).toEqual([d.id]);
    expect(tags.hits[0].meta).toContain('תגית');
    const typed = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=נתב&docType=R',
      headers: auth(u),
    });
    expect(JSON.stringify(typed.json())).not.toContain(d.id);
    const world = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=נתב&world=tech',
      headers: auth(u),
    });
    expect(JSON.stringify(world.json())).toContain(d.id);
  });

  it('serves the scripts group from type-T documents', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/scripts',
      headers: auth(u),
      payload: { title: 'סיווג תקלה', text: 'אתה לא גולש בכלל?', tags: [] },
    });
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=גולש&types=scripts',
      headers: auth(u),
    });
    const g = r.json().groups.find((x: { type: string }) => x.type === 'scripts');
    expect(g.hits[0]).toMatchObject({ type: 'script', title: 'סיווג תקלה', snippet: 'אתה לא גולש בכלל?' });
  });

  it('logs each search with its result count without delaying the response', async () => {
    await db.pool.query('delete from search_log');
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=' + encodeURIComponent('אין-כזה-מונח') + '&types=documents',
      headers: auth(u),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(0);
    // fire-and-forget: give the insert a tick
    await new Promise((res) => setTimeout(res, 50));
    // Scoped to this query: earlier cases in this file search too, and every search is logged.
    const rows = await db.pool.query('select user_id, q, filters, results from search_log where q=$1', [
      'אין-כזה-מונח',
    ]);
    expect(rows.rows).toEqual([
      { user_id: u.id, q: 'אין-כזה-מונח', filters: { types: 'documents' }, results: 0 },
    ]);
  });

  it('still answers when the search log cannot be written', async () => {
    await db.pool.query('alter table search_log rename to search_log_off');
    try {
      const r = await app.inject({ method: 'GET', url: '/api/v1/search?q=sim', headers: auth(u) });
      expect(r.statusCode).toBe(200);
    } finally {
      await db.pool.query('alter table search_log_off rename to search_log');
    }
  });
});
