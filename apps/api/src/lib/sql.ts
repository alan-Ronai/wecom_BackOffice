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

/**
 * `%` and `_` in a user-supplied `ilike` needle are wildcards, so an unescaped `%` matches
 * everything. Not injection — the value stays a bound parameter — but the caller would
 * otherwise control the predicate's meaning. Wrap the placeholder and add `escape '\\'`:
 *
 * ```
 * `col ilike '%' || ${likeEscape('$1')} || '%' escape '\\'`
 * ```
 */
export const likeEscape = (param: string): string =>
  `replace(replace(replace(${param}, '\\', '\\\\'), '%', '\\%'), '_', '\\_')`;

/** The trailing `escape` clause `likeEscape` needs. */
export const LIKE_ESCAPE = " escape '\\'";
