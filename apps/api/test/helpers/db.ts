import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

const withDb = (external: string, name: string) => {
  const url = new URL(external);
  url.pathname = '/' + name;
  return url.toString();
};

/**
 * Anything that changes what the migrations build → a different template: every migration file, the
 * code they require (`common/`, e.g. the embed-dimension resolver 0051 sizes `vector(N)` with) and
 * the env that code reads. Old templates are left in place — another worktree may still be cloning
 * one on the same server; drop `kbtpl_%` databases by hand when the server gets crowded.
 */
const templateName = () => {
  const hash = createHash('sha1');
  for (const dir of ['migrations', 'common'])
    for (const f of readdirSync(dir).sort())
      if (f !== 'package.json') hash.update(f).update(readFileSync(join(dir, f)));
  for (const k of ['EMBED_DIMENSION', 'MODEL_TIER', 'EMBED_MODEL'])
    hash.update(`${k}=${process.env[k] ?? ''};`);
  return 'kbtpl_' + hash.digest('hex').slice(0, 12);
};

/**
 * Migrate once into a template database, then clone it per test file (`create database … template`
 * is a file copy — milliseconds instead of a full migration run). An advisory lock serialises the
 * first build across vitest workers.
 */
const ensureTemplate = async (admin: pg.Client, external: string) => {
  const tpl = templateName();
  await admin.query('select pg_advisory_lock(771100)');
  try {
    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [tpl]);
    if (!rowCount) {
      // A build that failed or was killed leaves `_build` behind; start it over.
      await admin.query(`drop database if exists ${tpl}_build with (force)`);
      await admin.query(`create database ${tpl}_build`);
      await migrate(withDb(external, `${tpl}_build`));
      await admin.query(`alter database ${tpl}_build rename to ${tpl}`);
      await admin.query(`alter database ${tpl} with allow_connections false`);
    }
  } finally {
    await admin.query('select pg_advisory_unlock(771100)');
  }
  return tpl;
};

/**
 * A migrated Postgres for integration tests.
 * Defaults to a throwaway testcontainer; set `TEST_DATABASE_URL` (a superuser connection string on an
 * already-running pgvector server) to clone a fresh database from a migrated template on it instead —
 * one server for the whole run, and no per-file migration. (The migration tests start their own
 * containers and are unaffected.)
 */
export async function startTestDb(): Promise<TestDb> {
  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    const admin = new pg.Client({ connectionString: external });
    await admin.connect();
    const name = 'kbtest_' + Math.random().toString(36).slice(2, 10);
    const tpl = await ensureTemplate(admin, external);
    await admin.query(`create database ${name} template ${tpl}`);
    await admin.end();
    const dbUrl = withDb(external, name);
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
