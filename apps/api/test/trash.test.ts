import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth } from './helpers/fixtures.js';

const run = integration ? describe : describe.skip;
run('trash', () => {
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

  it('lists deleted docs with impact, restores, purges', async () => {
    const a = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: {
          title: 'A',
          category: 'tech',
          wave: 1,
          priority: 'm',
          kind: 'steps',
          slug: 'doc-a',
        },
      })
    ).json();
    const b = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'B', category: 'tech', wave: 1, priority: 'm', kind: 'steps' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${b.id}/structure`,
      headers: auth(u),
      payload: {
        phases: [
          {
            id: 'p1',
            label: '',
            steps: [
              { key: 's1', num: '1', title: 'x', actions: [{ id: 'a', text: 'ראה [[doc:' + a.id + ']]' }] },
            ],
          },
        ],
      },
    });
    await app.inject({ method: 'DELETE', url: `/api/v1/documents/${a.id}`, headers: auth(u) });
    const t = (await app.inject({ method: 'GET', url: '/api/v1/trash', headers: auth(u) })).json();
    expect(t.items[0]).toMatchObject({
      type: 'document',
      id: a.id,
      impact: { brokenLinks: 1, documents: [{ id: b.id, title: 'B' }] },
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/trash/document/${a.id}/restore`,
          headers: auth(u),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await db.pool.query(
          'select kind, label from document_versions where document_id=$1 order by created_at desc limit 1',
          [a.id],
        )
      ).rows[0],
    ).toEqual({ kind: 'system', label: 'שוחזר מסל מיחזור' });
    await app.inject({ method: 'DELETE', url: `/api/v1/documents/${a.id}`, headers: auth(u) });
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/trash/document/${a.id}`, headers: auth(u) }))
        .statusCode,
    ).toBe(204);
    expect((await db.pool.query('select count(*)::int n from documents where id=$1', [a.id])).rows[0].n).toBe(
      0,
    );
  });

  it('empties the trash only with the confirmation header', async () => {
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'לריקון', category: 'ops', wave: 1, priority: 'm', kind: 'steps' },
      })
    ).json();
    await app.inject({ method: 'DELETE', url: `/api/v1/documents/${c.id}`, headers: auth(u) });
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/trash', headers: auth(u) })).statusCode).toBe(
      428,
    );
    const e = await app.inject({
      method: 'DELETE',
      url: '/api/v1/trash',
      headers: { ...auth(u), 'x-confirm': 'empty' },
    });
    expect(e.json().purged).toBeGreaterThan(0);
    expect((await app.inject({ method: 'GET', url: '/api/v1/trash', headers: auth(u) })).json().items).toEqual(
      [],
    );
  });

  it('purgeExpired removes rows older than the window', async () => {
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'old', category: 'tech', wave: 1, priority: 'm', kind: 'steps' },
      })
    ).json();
    await db.pool.query("update documents set deleted_at = now() - interval '31 days' where id=$1", [c.id]);
    const { purgeExpired } = await import('../src/modules/trash/repo.js');
    expect(await purgeExpired(db.pool, 30)).toBe(1);
  });
});
