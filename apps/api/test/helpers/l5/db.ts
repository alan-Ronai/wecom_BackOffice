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
    await pool.end();
    await container.stop();
  }
}
