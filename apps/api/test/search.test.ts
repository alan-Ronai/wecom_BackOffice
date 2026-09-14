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
});
