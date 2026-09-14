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
      headers: { ...auth(u), 'if-match': b.etag },
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
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/trash', headers: auth(u) })).json().items,
    ).toEqual([]);
  });

  /**
   * A-C1 — `purgeExpired` has carried PRD §10 since wave 2, but `purge()` (which both
   * operator-facing routes call) did not, so `DELETE /trash/:type/:id` and `DELETE /trash`
   * hard-deleted published documents together with their whole version history. No undo, and
   * the audit records the action but not the content.
   */
  it('A-C1: the manual purge routes never hard-delete a once-published document', async () => {
    const mk = async (title: string) => {
      const d = (
        await app.inject({
          method: 'POST',
          url: '/api/v1/documents',
          headers: auth(u),
          payload: { title, category: 'ops', wave: 1, priority: 'm', kind: 'steps' },
        })
      ).json();
      await db.pool.query(
        `insert into document_versions(document_id, version, snapshot, kind, label) values ($1,1,'{}','published','v1')`,
        [d.id],
      );
      // Soft-delete directly: DELETE /documents/:id already refuses a once-published item, so
      // this reproduces a row that reached the trash before it was published (or via 0030).
      await db.pool.query('update documents set deleted_at=now() where id=$1', [d.id]);
      return d.id as string;
    };
    const protectedId = await mk('פורסם פעם');

    const one = await app.inject({
      method: 'DELETE',
      url: `/api/v1/trash/document/${protectedId}`,
      headers: auth(u),
    });
    expect(one.statusCode).toBe(409);
    expect(one.json().code).toBe('ONCE_PUBLISHED');

    // Empty-trash skips it rather than 409ing on the first row, and says how many stayed.
    const disposable = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'טיוטה למחיקה', category: 'ops', wave: 1, priority: 'm', kind: 'steps' },
      })
    ).json();
    await app.inject({ method: 'DELETE', url: `/api/v1/documents/${disposable.id}`, headers: auth(u) });

    const e = await app.inject({
      method: 'DELETE',
      url: '/api/v1/trash',
      headers: { ...auth(u), 'x-confirm': 'empty' },
    });
    expect(e.json().purged).toBeGreaterThan(0);
    expect(e.json().skipped).toBe(1);
    // Still there, with its version history.
    expect((await db.pool.query('select 1 from documents where id=$1', [protectedId])).rowCount).toBe(1);
    expect(
      (await db.pool.query('select 1 from document_versions where document_id=$1', [protectedId])).rowCount,
    ).toBe(1);
    expect((await db.pool.query('select 1 from documents where id=$1', [disposable.id])).rowCount).toBe(0);
    await db.pool.query('delete from document_versions where document_id=$1', [protectedId]);
    await db.pool.query('delete from documents where id=$1', [protectedId]);
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

  it('purgeExpired never removes a document that has a published version', async () => {
    const r = await db.pool.query(
      `insert into documents(slug,title,category,wave,priority,status,current_version,deleted_at)
       values ('once-pub','x','sim',1,'m','archived',1, now() - interval '400 days') returning id`,
    );
    const id = r.rows[0].id as string;
    await db.pool.query(
      `insert into document_versions(document_id, version, snapshot, kind, label) values ($1,1,'{}','published','v1')`,
      [id],
    );
    const { purgeExpired } = await import('../src/modules/trash/repo.js');
    await purgeExpired(db.pool, 30);
    const still = await db.pool.query('select 1 from documents where id=$1', [id]);
    expect(still.rowCount).toBe(1);
  });
});
