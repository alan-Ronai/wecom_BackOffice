import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runMigrations } from '../../../src/migrate.js';

export const integration = process.env.RUN_INTEGRATION === '1';

/** Spins up a migrated throwaway Postgres for one test and always tears it down. */
export async function withDb(fn: (pool: pg.Pool, uri: string) => Promise<void>): Promise<void> {
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
  const uri = container.getConnectionUri();
  const pool = new pg.Pool({ connectionString: uri });
  try {
    await runMigrations(uri);
    await fn(pool, uri);
  } finally {
    // buildApp's db plugin ends the pool it was handed on app.close(), so this may be a no-op.
    await pool.end().catch(() => undefined);
    await container.stop();
  }
}
