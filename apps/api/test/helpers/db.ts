import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runner } from 'node-pg-migrate';

export interface TestDb {
  pool: pg.Pool;
  url: string;
  stop: () => Promise<void>;
}

/** `app.close()` already ends the pool it was handed; ending it twice throws. */
const endPool = async (pool: pg.Pool) => {
  try {
    await pool.end();
  } catch {
    /* already ended by the app's onClose hook */
  }
};

const migrate = async (url: string) => {
  await runner({
    databaseUrl: url,
    dir: 'migrations',
    direction: 'up',
    migrationsTable: 'pgmigrations',
    ignorePattern: 'package\\.json',
    log: () => undefined,
  });
};

/**
 * A migrated Postgres for integration tests.
 * Defaults to a throwaway testcontainer; set `TEST_DATABASE_URL` (a superuser connection string on an
 * already-running pgvector server) to create a fresh database on it instead — much faster to iterate on.
 */
export async function startTestDb(): Promise<TestDb> {
  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    const admin = new pg.Client({ connectionString: external });
    await admin.connect();
    const name = 'kbtest_' + Math.random().toString(36).slice(2, 10);
    await admin.query(`create database ${name}`);
    await admin.end();
    const url = new URL(external);
    url.pathname = '/' + name;
    const dbUrl = url.toString();
    await migrate(dbUrl);
    const pool = new pg.Pool({ connectionString: dbUrl });
    pool.on('error', () => undefined); // see plugins/db.ts — the pool is shared with the app
    return {
      pool,
      url: dbUrl,
      stop: async () => {
        await endPool(pool);
        const drop = new pg.Client({ connectionString: external });
        await drop.connect();
        await drop.query(`drop database if exists ${name} with (force)`);
        await drop.end();
      },
    };
  }
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'pgvector/pgvector:pg16',
  ).start();
  const url = container.getConnectionUri();
  await migrate(url);
  const pool = new pg.Pool({ connectionString: url });
  pool.on('error', () => undefined); // see plugins/db.ts — the pool is shared with the app
  return {
    pool,
    url,
    stop: async () => {
      await endPool(pool);
      await container.stop();
    },
  };
}

export const integration = process.env.RUN_INTEGRATION === '1';
