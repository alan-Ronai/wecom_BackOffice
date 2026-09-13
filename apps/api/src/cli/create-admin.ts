import pg from 'pg';
import { parseArgs } from 'node:util';
import { hashPassword } from '../modules/auth/local.js';
import { initials } from '../modules/auth/identity.js';

export async function createAdmin(
  db: pg.Pool,
  email: string,
  password: string,
  displayName = 'Admin',
): Promise<{ id: string; created: boolean }> {
  if (password.length < 12) throw new Error('password must be at least 12 characters');
  const e = email.toLowerCase();
  const hash = await hashPassword(password);
  const existing = (
    await db.query<{ id: string }>(`select id from users where subject=$1 and source='local'`, [e])
  ).rows[0];
  let id: string;
  let created = false;
  if (existing) {
    id = existing.id;
    await db.query(`update users set password_hash=$2, active=true, updated_at=now() where id=$1`, [id, hash]);
  } else {
    id = (
      await db.query<{ id: string }>(
        `insert into users(subject, source, email, display_name, initials, password_hash) values ($1,'local',$1,$2,$3,$4) returning id`,
        [e, displayName, initials(displayName), hash],
      )
    ).rows[0].id;
    created = true;
  }
  await db.query(
    `insert into user_roles(user_id, role_id) select $1, id from roles where name='admin' on conflict do nothing`,
    [id],
  );
  await db.query(
    `insert into audit_log(actor_id, action, entity_type, entity_id, after) values (null, 'admin.create_admin', 'user', $1, $2)`,
    [id, JSON.stringify({ email: e, created })],
  );
  return { id, created };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, password: { type: 'string' }, name: { type: 'string' } },
  });
  if (!values.email || !values.password) {
    console.error('usage: create-admin --email <email> --password <password> [--name <display name>]');
    process.exit(2);
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  createAdmin(pool, values.email, values.password, values.name)
    .then((r) => {
      console.log(`${r.created ? 'created' : 'updated'} admin ${r.id}`);
      return pool.end();
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
