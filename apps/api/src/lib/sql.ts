import type pg from 'pg';

export type Tx = pg.PoolClient;
/** Anything that can run a query: the pool for reads, a transaction client for writes. */
export type Queryable = pg.Pool | Tx;

export async function withTransaction<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const r = await fn(client);
    await client.query('commit');
    return r;
  } catch (e) {
    try {
      await client.query('rollback');
    } catch {
      /* connection already broken */
    }
    throw e;
  } finally {
    client.release();
  }
}
