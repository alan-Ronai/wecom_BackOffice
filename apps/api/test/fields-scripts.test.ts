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
      headers: { ...auth(u), 'if-match': c.etag },
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

  /**
   * `/scripts*` is gone: the adapter routes over `doc_type='T'` were removed once the web's three
   * readers moved to `GET /documents?docType=T`. What replaced them is asserted here — a type-T
   * document is created, read and listed through the ordinary documents surface, and its card
   * carries the body the step-level phrasing picker reads out.
   */
  it('a script is a type-T text document, created and listed through /documents', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: auth(u),
      payload: {
        title: 'סימון רשת',
        description: '',
        category: 'ops',
        wave: 3,
        priority: 'm',
        kind: 'text',
        docType: 'T',
        tags: ['a'],
        bodyHtml: '<p>טקסט<br>שורה</p>',
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;

    const doc = await app.inject({ method: 'GET', url: `/api/v1/documents/${id}`, headers: auth(u) });
    expect(doc.json()).toMatchObject({
      docType: 'T',
      kind: 'text',
      bodyHtml: '<p>טקסט<br>שורה</p>',
      tags: ['a'],
      worlds: ['ops'],
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?docType=T&pageSize=200',
      headers: auth(u),
    });
    const card = list.json().items.find((x: { id: string }) => x.id === id);
    // A `kind: 'text'` card carries `bodyHtml`: that body *is* the item's content, and the picker
    // reads it out to a customer mid-call.
    expect(card).toMatchObject({ docType: 'T', kind: 'text', bodyHtml: '<p>טקסט<br>שורה</p>' });

    // A `steps` card still carries none of its own body — its content is its steps.
    const steps = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?docType=R&pageSize=200',
      headers: auth(u),
    });
    expect(steps.json().items.every((x: { bodyHtml?: string }) => x.bodyHtml === undefined)).toBe(true);
  });

  it('the /scripts adapter routes are gone', async () => {
    for (const url of ['/api/v1/scripts', '/api/v1/scripts/00000000-0000-4000-8000-000000000000'])
      expect((await app.inject({ method: 'GET', url, headers: auth(u) })).statusCode, url).toBe(404);
  });
});
