import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runMigrations } from '../src/migrate.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
run('runMigrations', () => {
  let c: StartedPostgreSqlContainer;
  beforeAll(async () => {
    c = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
  }, 120000);
  afterAll(async () => {
    await c?.stop();
  });
  it('applies all migrations once and is idempotent', async () => {
    const first = await runMigrations(c.getConnectionUri());
    expect(first.length).toBeGreaterThanOrEqual(7);
    const second = await runMigrations(c.getConnectionUri());
    expect(second).toEqual([]);
    const pool = new pg.Pool({ connectionString: c.getConnectionUri() });
    expect(
      (
        await pool.query(
          "select count(*)::int as n from information_schema.tables where table_name='documents'",
        )
      ).rows[0].n,
    ).toBe(1);
    await pool.end();
  });
});
