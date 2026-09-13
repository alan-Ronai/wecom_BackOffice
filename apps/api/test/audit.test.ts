import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { withTransaction } from '../src/lib/sql.js';
import { audit } from '../src/lib/audit.js';
import { makeUser } from './helpers/fixtures.js';

const run = integration ? describe : describe.skip;
run('audit', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    db = await startTestDb();
  }, 120000);
  afterAll(async () => {
    await db.stop();
  });
  it('writes a row inside the transaction and rolls back with it', async () => {
    const u = await makeUser(db.pool);
    const id = await withTransaction(db.pool, (tx) =>
      audit(tx, {
        actorId: u.id,
        action: 'docs.publish',
        entityType: 'document',
        entityId: 'x',
        before: null,
        after: { v: 1 },
        requestId: 'r1',
        ip: '10.0.0.1',
      }),
    );
    expect((await db.pool.query('select action from audit_log where id=$1', [id])).rows[0].action).toBe(
      'docs.publish',
    );
    await expect(
      withTransaction(db.pool, async (tx) => {
        await audit(tx, {
          actorId: u.id,
          action: 'x',
          entityType: 'y',
          entityId: null,
          before: null,
          after: null,
          requestId: null,
          ip: null,
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await db.pool.query("select count(*)::int n from audit_log where action='x'")).rows[0].n).toBe(0);
  });
});
