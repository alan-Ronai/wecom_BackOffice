import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth } from './helpers/fixtures.js';

const run = integration ? describe : describe.skip;
run('blocks', () => {
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

  it('creates a block, embeds it in a document, updates it and lists usage', async () => {
    const b = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/blocks',
        headers: auth(u),
        payload: {
          title: 'ריענון SIM',
          kind: 'step',
          actions: [{ id: 'b1', text: 'CRM ← sim block lbl ← שמור' }],
          outcomes: [{ kind: 'ok', text: '✓ הסתדר' }],
          slug: 'sim-refresh',
        },
      })
    ).json();
    expect(b.currentVersion).toBe(1);
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'x', category: 'tech', wave: 1, priority: 'm', kind: 'steps' },
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
              {
                key: 's1',
                num: '1',
                title: 'ריענון SIM',
                blockId: b.id,
                outcomes: [{ kind: 'ok', text: 'ok' }],
              },
            ],
          },
        ],
      },
    });
    const usage = (
      await app.inject({ method: 'GET', url: `/api/v1/blocks/${b.id}/usage`, headers: auth(u) })
    ).json();
    expect(usage.items).toEqual([
      { documentId: c.id, title: 'x', stepKey: 's1', stepNum: '1', mode: 'embedded' },
    ]);
    const up = await app.inject({
      method: 'PUT',
      url: `/api/v1/blocks/${b.id}`,
      headers: auth(u),
      payload: {
        title: 'ריענון SIM',
        kind: 'step',
        actions: [
          { id: 'b1', text: 'CRM ← sim block lbl ← שמור' },
          { id: 'b2', text: 'לחכות 90 שניות' },
        ],
        outcomes: [],
        label: '90 שניות',
      },
    });
    expect(up.json().currentVersion).toBe(2);
    expect(
      (await db.pool.query('select search_text from documents where id=$1', [c.id])).rows[0].search_text,
    ).toContain('90 שניות');
    const doc = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${c.id}`, headers: auth(u) })
    ).json();
    expect(doc.phases[0].steps[0].blockId).toBe(b.id);
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/blocks/${b.id}/versions`, headers: auth(u) }))
        .json()
        .items.map((v: { version: number }) => v.version),
    ).toEqual([1, 2]);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/blocks', headers: auth(u) })).json().items,
    ).toHaveLength(1);
  });

  it('requires blocks.edit to write and soft deletes', async () => {
    const reader = await makeUser(db.pool, { perms: ['docs.read'] });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/blocks',
          headers: auth(reader),
          payload: { title: 'x', kind: 'step', actions: [], outcomes: [] },
        })
      ).statusCode,
    ).toBe(403);
    const b = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/blocks',
        headers: auth(u),
        payload: { title: 'זמני', kind: 'step', actions: [], outcomes: [], slug: 'temp-block' },
      })
    ).json();
    const d = await app.inject({ method: 'DELETE', url: `/api/v1/blocks/${b.id}`, headers: auth(u) });
    expect(d.statusCode).toBe(200);
    expect(d.json().auditId).toBeDefined();
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/blocks/${b.id}`, headers: auth(u) })).statusCode,
    ).toBe(404);
  });
});
