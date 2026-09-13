import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { EventBus } from '../src/lib/events.js';
import { withTransaction } from '../src/lib/sql.js';
import { makeEvent } from '@wecom/shared';
import { D1 } from './helpers/fixtures.js';

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
});
