import pg from 'pg';
import { startTestDb as start } from '../db.js';

export const integration = process.env.RUN_INTEGRATION === '1';

/** The shared helper (template clone under `TEST_DATABASE_URL`, a testcontainer otherwise). */
export const startTestDb = start;

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
      `insert into user_roles(user_id, role_id, world_scope) select $1, id, $3 from roles where name=$2`,
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
