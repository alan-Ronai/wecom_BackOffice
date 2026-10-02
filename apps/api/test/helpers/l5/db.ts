import pg from 'pg';
import { startTestDb } from '../db.js';

export const integration = process.env.RUN_INTEGRATION === '1';

/** A migrated throwaway Postgres for one test, always torn down (see `startTestDb`). */
export async function withDb(fn: (pool: pg.Pool, uri: string) => Promise<void>): Promise<void> {
  const db = await startTestDb();
  try {
    await fn(db.pool, db.url);
  } finally {
    // buildApp's db plugin ends the pool it was handed on app.close(); `stop` tolerates that.
    await db.stop();
  }
}
