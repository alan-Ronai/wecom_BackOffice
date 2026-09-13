import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth } from './helpers/fixtures.js';

const run = integration ? describe : describe.skip;
run('fields and scripts', () => {
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

  it('upserts a field, reports usage, renames', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/v1/fields/' + encodeURIComponent('שירות נדידה'),
      headers: auth(u),
      payload: { name: 'שירות נדידה', status: 'ok', path: 'CRM ↗ שירותים' },
    });
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'x', category: 'intl', wave: 1, priority: 'm', kind: 'steps' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${c.id}/structure`,
      headers: auth(u),
      payload: {
        phases: [
          {
            id: 'p1',
            label: '',
            steps: [
              { key: 's1', num: '1', title: 'x', actions: [{ id: 'a', text: 'ודא "שירות נדידה" פעיל' }] },
            ],
          },
        ],
      },
    });
    const usage = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/fields/' + encodeURIComponent('שירות נדידה') + '/usage',
        headers: auth(u),
      })
    ).json();
    expect(usage.items).toEqual([{ documentId: c.id, title: 'x', stepKeys: ['s1'] }]);
    const r = await app.inject({
      method: 'PUT',
      url: '/api/v1/fields/' + encodeURIComponent('שירות נדידה'),
      headers: auth(u),
      payload: {
        name: 'שירות נדידה',
        status: 'renamed',
        renamedTo: 'שירותי נדידה',
        path: 'CRM ↗ שירותים',
      },
    });
    expect(r.json().status).toBe('renamed');
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/fields', headers: auth(u) })).json().items[0].usedIn,
    ).toBe(1);
  });

  it('requires fields.edit to write', async () => {
    const reader = await makeUser(db.pool, { perms: ['docs.read'] });
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/fields/' + encodeURIComponent('שדה חדש'),
          headers: auth(reader),
          payload: { name: 'שדה חדש', status: 'new', path: '' },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('scripts CRUD', async () => {
    const s = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/scripts',
        headers: auth(u),
        payload: { title: 'סימון רשת', text: '"איזה סימון מופיע?"', tags: ['tech'] },
      })
    ).json();
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/v1/scripts/${s.id}`,
          headers: auth(u),
          payload: { title: 'סימון רשת', text: 'עודכן', tags: [] },
        })
      ).json().text,
    ).toBe('עודכן');
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/scripts/${s.id}`, headers: auth(u) })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/scripts', headers: auth(u) })).json().items,
    ).toHaveLength(0);
  });
});
