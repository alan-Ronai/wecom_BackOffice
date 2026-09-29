import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ModelClient } from '@wecom/model';
import { buildApp } from '../../src/app.js';
import { refreshStepEmbeddings } from '../../src/modules/sources/embeddings.js';
import { startTestDb, integration } from '../helpers/db.js';
import fakeAuth from '../helpers/fakeAuth.js';
import { makeUser, auth, minimalStructure, type TestUser } from '../helpers/fixtures.js';

/**
 * The 40P01 the wave 6 gate caught in `wave5-seams` ("change-preview…", a 500 on
 * `PUT /documents/:id/structure`).
 *
 * A publish fires `refreshStepEmbeddings` in the background, and the editor's next structure save
 * can land while it is still writing. The two took the same two locks in opposite orders:
 *
 * - `saveStructure` locks the `documents` row `for update`, then `delete from phases` cascades to
 *   `steps` (and on to `step_embeddings`).
 * - the writer's `insert into step_embeddings` fired its two FK checks — `step_id → steps` first,
 *   `document_id → documents` second — each a `for key share`, which `for update` conflicts with.
 *
 * So the writer could hold the step and wait for the document while the save held the document
 * and waited to delete the step. The test below builds exactly that interleaving by hand: the
 * save's first statement is held open, the writer is started against it, and only then does the
 * save delete the steps. Before the fix Postgres broke the cycle by killing one side after
 * `deadlock_timeout`; now the writer waits on the document first, then finds its steps gone and
 * writes nothing.
 */
const run = integration ? describe : describe.skip;
run('step embeddings take the structure save’s lock order', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let lead: TestUser;
  let dim = 0;

  const model = (): ModelClient =>
    ({
      name: 'stub-embed',
      embed: async () => Array.from({ length: dim }, (_, i) => (i === 0 ? 1 : 0)),
    }) as unknown as ModelClient;

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({
      pool: db.pool,
      boss: false,
      plugins: [fakeAuth],
      config: { DATABASE_URL: db.url, NODE_ENV: 'test', MODEL_DISABLED: true },
    });
    await app.ready();
    lead = await makeUser(db.pool);
    const t = await db.pool.query(
      `select atttypmod from pg_attribute where attrelid = 'step_embeddings'::regclass and attname = 'embedding'`,
    );
    dim = Number(t.rows[0].atttypmod);
  }, 120000);
  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  const makeDoc = async (): Promise<string> => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: auth(lead),
      payload: {
        title: 'סדר נעילות',
        description: '',
        category: 'tech',
        wave: 1,
        priority: 'm',
        kind: 'steps',
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${id}/structure`,
      headers: { ...auth(lead), 'if-match': created.json().etag as string },
      payload: minimalStructure,
    });
    expect(put.statusCode, put.body).toBe(200);
    return id;
  };

  /** Until the writer's connection is waiting on a lock — the only proof it reached its insert. */
  const waitForLockWait = async (): Promise<void> => {
    for (let i = 0; i < 200; i++) {
      const r = await db.pool.query(
        `select 1 from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%step_embeddings%'`,
      );
      if (r.rowCount) return;
      await new Promise((res) => setTimeout(res, 25));
    }
    throw new Error('the embedding writer never blocked on the structure save');
  };

  it('a structure save racing the background writer commits, and the writer skips the deleted steps', async () => {
    const docId = await makeDoc();
    const save = await db.pool.connect();
    const warnings: unknown[] = [];
    try {
      await save.query(`set deadlock_timeout = '200ms'`);
      await save.query('begin');
      // `saveStructure`'s first statement, verbatim in effect.
      await save.query('select etag from documents where id=$1 for update', [docId]);

      const writer = refreshStepEmbeddings(db.pool, docId, model(), {
        warn: (o: unknown) => warnings.push(o),
      } as never);
      await waitForLockWait();

      // `saveStructure`'s second statement. Before the fix this is where the cycle closed.
      await save.query('delete from phases where document_id=$1', [docId]);
      await save.query('commit');

      await writer;
    } finally {
      // A deadlock victim leaves the transaction aborted; never hand that back to the pool.
      await save.query('rollback').catch(() => undefined);
      save.release();
    }
    expect(warnings, 'the writer neither deadlocked nor tripped the step FK').toEqual([]);
    const rows = await db.pool.query('select count(*)::int n from step_embeddings where document_id=$1', [
      docId,
    ]);
    expect(rows.rows[0].n).toBe(0);
  });

  it('with no save in flight the writer still embeds every step, and a second pass is a no-op', async () => {
    const docId = await makeDoc();
    expect(await refreshStepEmbeddings(db.pool, docId, model())).toBe(2);
    const rows = await db.pool.query('select count(*)::int n from step_embeddings where document_id=$1', [
      docId,
    ]);
    expect(rows.rows[0].n).toBe(2);
    expect(await refreshStepEmbeddings(db.pool, docId, model())).toBe(0);
  });
});
