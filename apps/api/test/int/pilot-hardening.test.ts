import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { resolvePermissions } from '../../src/modules/auth/permissions.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;

const migrate = (url: string, direction: 'up' | 'down', count?: number) =>
  runner({
    databaseUrl: url,
    dir: 'migrations',
    direction,
    count,
    migrationsTable: 'pgmigrations',
    ignorePattern: 'package\\.json',
    log: () => undefined,
  });

const U = '66666666-6666-4666-8666-666666666666';

/**
 * A-M14. `documents.category` references `worlds(slug)` with `on update cascade`, so a renamed
 * world takes its documents with it. `user_roles.world_scope` is a `text[]` and could carry no
 * such key, so the same rename would have left every scoped user matching nothing — quietly, as
 * an empty library rather than an error. `0045` adds the join table that can carry it.
 */
run('0045 — user_role_worlds (A-M14)', () => {
  let c: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let roleId: string;

  beforeAll(async () => {
    c = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    pool = new pg.Pool({ connectionString: c.getConnectionUri() });
    await migrate(c.getConnectionUri(), 'up');

    // Roll 0045 back so legacy rows can be written the way they existed before it, then roll
    // forward over them: this is the backfill path a real deploy takes.
    await migrate(c.getConnectionUri(), 'down', 1);
    await pool.query(
      `insert into users(id, subject, source, email, display_name, initials)
         values ($1,'am14','local','am14@t','X','X')`,
      [U],
    );
    roleId = (await pool.query(`select id from roles where name='editor'`)).rows[0].id;
    // `finance` is a real seeded world; `gone` names one that never existed. Before 0045 nothing
    // stopped the second value being stored, so the backfill has to survive it.
    await pool.query(`insert into user_roles(user_id, role_id, world_scope) values ($1,$2,$3)`, [
      U,
      roleId,
      ['tech', 'gone'],
    ]);
    await migrate(c.getConnectionUri(), 'up');
  }, 240000);

  afterAll(async () => {
    await pool?.end();
    await c?.stop();
  });

  const slugs = async () =>
    (
      await pool.query(
        `select world_slug from user_role_worlds where user_id=$1 order by world_slug`,
        [U],
      )
    ).rows.map((r) => r.world_slug);

  it('backfills only the slugs that name a real world, and cleans the rest out of the array', async () => {
    // The migration ran to completion over a row a blanket insert would have failed 23503 on.
    expect(await slugs()).toEqual(['tech']);
    const arr = (await pool.query(`select world_scope from user_roles where user_id=$1`, [U])).rows[0]
      .world_scope;
    // `gone` scoped the user to nothing before and scopes them to nothing now; dropping it only
    // stops the column and the join table disagreeing.
    expect(arr).toEqual(['tech']);
  });

  it('refuses a scope naming a world that does not exist — the key A-M14 asked for', async () => {
    await expect(
      pool.query(`insert into user_role_worlds(user_id, role_id, world_slug) values ($1,$2,'nope')`, [
        U,
        roleId,
      ]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('mirrors a write to world_scope into the join table', async () => {
    // `admin/users.ts` still writes the array and knows nothing about the join table.
    await pool.query(`update user_roles set world_scope=$1 where user_id=$2`, [['tech', 'intl'], U]);
    expect(await slugs()).toEqual(['intl', 'tech']);
    await pool.query(`update user_roles set world_scope=$1 where user_id=$2`, [['tech'], U]);
    expect(await slugs()).toEqual(['tech']);
  });

  it('carries a scoped user through a world rename, which is the whole point', async () => {
    const before = await resolvePermissions(pool, U);
    expect(before.worldScopes).toEqual(['tech']);

    await pool.query(`update worlds set slug='technology' where slug='tech'`);

    // The FK's `on update cascade` moved the join row...
    expect(await slugs()).toEqual(['technology']);
    // ...and the trigger moved the array with it, so the two still agree.
    const arr = (await pool.query(`select world_scope from user_roles where user_id=$1`, [U])).rows[0]
      .world_scope;
    expect(arr).toEqual(['technology']);
    // Which is what matters: the user still sees the world they were scoped to, rather than
    // silently seeing nothing.
    const after = await resolvePermissions(pool, U);
    expect(after.worldScopes).toEqual(['technology']);

    await pool.query(`update worlds set slug='tech' where slug='technology'`);
  });

  it('keeps null meaning "every world" — the one thing the join table cannot say', async () => {
    await pool.query(`update user_roles set world_scope=null where user_id=$1`, [U]);
    expect(await slugs()).toEqual([]);
    expect((await resolvePermissions(pool, U)).worldScopes).toBeNull();
    await pool.query(`update user_roles set world_scope=$1 where user_id=$2`, [['tech'], U]);
  });

  it('drops a user’s scopes when the world is deleted, rather than stranding them', async () => {
    await pool.query(
      `insert into worlds(slug, name, position) values ('temp-world','זמני',99)
         on conflict (slug) do nothing`,
    );
    await pool.query(`update user_roles set world_scope=$1 where user_id=$2`, [['tech', 'temp-world'], U]);
    expect(await slugs()).toEqual(['tech', 'temp-world']);
    await pool.query(`delete from worlds where slug='temp-world'`);
    expect(await slugs()).toEqual(['tech']);
  });
});
