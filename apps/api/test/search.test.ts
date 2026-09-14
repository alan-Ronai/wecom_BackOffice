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

  it('returns nothing for an empty query and reindexes', async () => {
    const empty = (await app.inject({ method: 'GET', url: '/api/v1/search?q=', headers: auth(u) })).json();
    expect(empty.groups).toEqual([]);
    expect(empty.total).toBe(0);
    const { reindexAll } = await import('../src/modules/search/repo.js');
    expect(await reindexAll(db.pool)).toBeGreaterThan(0);
  });

  it('logs each search with its result count without delaying the response', async () => {
    await db.pool.query('delete from search_log');
    const r = await app.inject({ method: 'GET', url: '/api/v1/search?q=' + encodeURIComponent('אין-כזה-מונח') + '&types=documents', headers: auth(u) });
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(0);
    // fire-and-forget: give the insert a tick
    await new Promise((res) => setTimeout(res, 50));
    const rows = await db.pool.query('select user_id, q, filters, results from search_log');
    expect(rows.rows).toEqual([{ user_id: u.id, q: 'אין-כזה-מונח', filters: { types: 'documents' }, results: 0 }]);
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
