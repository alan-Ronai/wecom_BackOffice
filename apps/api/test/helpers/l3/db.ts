import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runner } from 'node-pg-migrate';

export const integration = process.env.RUN_INTEGRATION === '1';

export async function startTestDb() {
  const c = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
  const url = c.getConnectionUri();
  await runner({
    databaseUrl: url,
    dir: 'migrations',
    direction: 'up',
    migrationsTable: 'pgmigrations',
    ignorePattern: 'package\\.json',
    log: () => undefined,
  });
  const pool = new pg.Pool({ connectionString: url });
  return {
    pool,
    url,
    stop: async () => {
      // buildApp({ pool }) closes the pool on app.close(); ending twice throws.
      try {
        await pool.end();
      } catch {
        /* already ended by the app under test */
      }
      await c.stop();
    },
  };
}

export async function seedUser(
  pool: pg.Pool,
  u: {
    email: string;
    displayName: string;
    source?: 'entra' | 'paloalto' | 'local';
    subject?: string;
    roles?: string[];
    categoryScope?: string[] | null;
    passwordHash?: string | null;
    active?: boolean;
  },
): Promise<string> {
  const source = u.source ?? 'entra';
  const r = await pool.query<{ id: string }>(
    `insert into users(subject, source, email, display_name, initials, active, password_hash) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [
      u.subject ?? 'sub-' + u.email,
      source,
      u.email,
      u.displayName,
      u.displayName.slice(0, 1),
      u.active ?? true,
      u.passwordHash ?? null,
    ],
  );
  const id = r.rows[0].id;
  for (const role of u.roles ?? []) {
    await pool.query(
      `insert into user_roles(user_id, role_id, category_scope) select $1, id, $3 from roles where name=$2`,
      [id, role, u.categoryScope ?? null],
    );
  }
  return id;
}

export async function createSession(
  pool: pg.Pool,
  userId: string,
  tokenHash: string,
  expiresAt = new Date(Date.now() + 3600e3),
) {
  const r = await pool.query<{ id: string }>(
    `insert into sessions(user_id, token_hash, expires_at) values ($1,$2,$3) returning id`,
    [userId, tokenHash, expiresAt],
  );
  return r.rows[0].id;
}
