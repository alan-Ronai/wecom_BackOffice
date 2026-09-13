import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { EventBus } from '../src/lib/events.js';
import { withTransaction } from '../src/lib/sql.js';
import { makeEvent } from '@wecom/shared';
import { D1, auth, makeUser } from './helpers/fixtures.js';
import { buildTestApp } from './helpers/app.js';

const run = integration ? describe : describe.skip;
run('EventBus', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    db = await startTestDb();
  }, 120000);
  afterAll(async () => {
    await db.stop();
  });
  it('delivers events published in a transaction through NOTIFY', async () => {
    const bus = new EventBus();
    await bus.start(db.url);
    const got = new Promise<unknown>((res) => bus.subscribe((e) => res(e)));
    await withTransaction(db.pool, (tx) =>
      bus.publish(tx, makeEvent('document.updated', { documentId: D1, actorId: null })),
    );
    expect(await got).toMatchObject({ name: 'document.updated' });
    await bus.stop();
  });
  it('does not deliver events from a rolled-back transaction', async () => {
    const bus = new EventBus();
    await bus.start(db.url);
    let seen = 0;
    bus.subscribe(() => seen++);
    await expect(
      withTransaction(db.pool, async (tx) => {
        await bus.publish(tx, makeEvent('document.updated', { documentId: D1, actorId: null }));
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
    await new Promise((r) => setTimeout(r, 200));
    expect(seen).toBe(0);
    await bus.stop();
  });

  it('streams a published event over SSE', async () => {
    const app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    const u = await makeUser(db.pool);
    const addr = await app.listen({ port: 0, host: '127.0.0.1' });
    const res = await fetch(addr + '/api/v1/events', { headers: auth(u) });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    await withTransaction(db.pool, (tx) =>
      app.events.publish(tx, makeEvent('document.updated', { documentId: D1, actorId: null })),
    );
    let buf = '';
    while (!buf.includes('event: document.updated')) buf += dec.decode((await reader.read()).value);
    expect(buf).toContain(`"documentId":"${D1}"`);
    await reader.cancel();
    await app.close();
  });
});
