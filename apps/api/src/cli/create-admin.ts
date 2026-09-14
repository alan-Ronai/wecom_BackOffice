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
    await db.query(`update users set password_hash=$2, active=true, updated_at=now() where id=$1`, [
      id,
      hash,
    ]);
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

const USAGE = `usage: create-admin --email <email> [--name <display name>] (--password-stdin | interactive prompt)

The password is never taken from the command line: pnpm echoes the resolved command, so
\`--password 'S3cret…'\` ended up in the terminal transcript and in shell history (acceptance
review O-6). Either pipe it in —

  printf '%s' 'the password' | … create-admin --email admin@wecom.local --password-stdin

— or run the command on a terminal and answer the prompt (the typed characters are not echoed).`;

/** Reads the password from a pipe (`--password-stdin`). Trailing newline from `echo` is dropped. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

/** Prompts on the TTY with the echo turned off, so the password never appears on screen. */
async function promptPassword(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let value = '';
  try {
    await new Promise<void>((resolve, reject) => {
      const onData = (ch: string) => {
        for (const c of ch) {
          if (c === '\r' || c === '\n' || c === '\u0004') {
            stdin.off('data', onData);
            resolve();
            return;
          }
          if (c === '\u0003') {
            stdin.off('data', onData);
            reject(new Error('cancelled'));
            return;
          }
          if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
          else value += c;
        }
      };
      stdin.on('data', onData);
    });
  } finally {
    stdin.setRawMode?.(wasRaw ?? false);
    stdin.pause();
    process.stderr.write('\n');
  }
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      'password-stdin': { type: 'boolean', default: false },
      // Still declared so the old spelling gets an explanation instead of parseArgs' bare
      // "Unknown option" throw — an operator with the previous runbook line deserves to know why.
      password: { type: 'string' },
    },
  });
  if (values.password !== undefined) {
    console.error(
      'create-admin: --password is not accepted any more — it put the password in the terminal transcript and in shell history.\n',
    );
    console.error(USAGE);
    process.exit(2);
  }
  if (!values.email) {
    console.error(USAGE);
    process.exit(2);
  }
  const password = values['password-stdin']
    ? await readStdin()
    : process.stdin.isTTY
      ? await (async () => {
          const first = await promptPassword('New admin password (not echoed): ');
          const again = await promptPassword('Repeat it: ');
          if (first !== again) {
            console.error('the two passwords do not match');
            process.exit(2);
          }
          return first;
        })()
      : '';
  if (!password) {
    console.error(
      values['password-stdin']
        ? 'create-admin: --password-stdin was given but nothing arrived on stdin'
        : USAGE,
    );
    process.exit(2);
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  createAdmin(pool, values.email, password, values.name)
    .then((r) => {
      console.log(`${r.created ? 'created' : 'updated'} admin ${r.id}`);
      return pool.end();
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
