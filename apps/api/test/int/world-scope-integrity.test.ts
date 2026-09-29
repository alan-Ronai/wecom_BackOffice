import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { readdir } from 'node:fs/promises';
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

const U = '55555555-5555-4555-8555-555555555555';
/** How many migrations are 0055 or later — later lanes add their own above it (`checkOrder`). */
const from0055 = async () =>
  (await readdir('migrations')).filter((f) => Number(/^(\d{4})_/.exec(f)?.[1] ?? NaN) >= 55).length;

/**
 * Wave Y, wave 4 A-M14 — `0055_world_scope_integrity`. 0045 gave `world_scope` a join table with
 * the foreign key, a rename cascade and a delete prune; the array itself still accepted a slug
 * naming no world. 0055 prunes any such slug and rejects new ones with the error a real FK raises.
 */
run('0055 — user_roles.world_scope integrity (A-M14)', () => {
  let c: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let roleId: string;

  const scopeOf = async () =>
    (await pool.query(`select world_scope from user_roles where user_id=$1`, [U])).rows[0].world_scope;
  const joined = async () =>
    (
      await pool.query(`select world_slug from user_role_worlds where user_id=$1 order by world_slug`, [U])
    ).rows.map((r) => r.world_slug);
  const setScope = (scope: string[] | null) =>
    pool.query(`update user_roles set world_scope=$1 where user_id=$2`, [scope, U]);

  beforeAll(async () => {
    c = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    pool = new pg.Pool({ connectionString: c.getConnectionUri() });
    await migrate(c.getConnectionUri(), 'up');
    // Roll back to just before 0055 so a legacy row can hold an unknown slug, then roll forward
    // over it: the prune path a real deploy takes. Counted from the directory, not hardcoded.
    await migrate(c.getConnectionUri(), 'down', await from0055());
    await pool.query(
      `insert into users(id, subject, source, email, display_name, initials)
         values ($1,'am14y','local','am14y@t','X','X')`,
      [U],
    );
    roleId = (await pool.query(`select id from roles where name='editor'`)).rows[0].id;
    await pool.query(`insert into user_roles(user_id, role_id, world_scope) values ($1,$2,$3)`, [
      U,
      roleId,
      ['tech', 'ghost'],
    ]);
    await migrate(c.getConnectionUri(), 'up');
  }, 240000);

  afterAll(async () => {
    await pool?.end();
    await c?.stop();
  });

  it('prunes an unknown slug already stored, leaving the real ones', async () => {
    expect(await scopeOf()).toEqual(['tech']);
    expect(await joined()).toEqual(['tech']);
  });

  it('rejects an update naming an unknown world, with the foreign-key error code', async () => {
    await expect(setScope(['tech', 'nope'])).rejects.toMatchObject({
      code: '23503',
      constraint: 'user_roles_world_scope_worlds_check',
    });
    // The row is untouched.
    expect(await scopeOf()).toEqual(['tech']);
  });

  it('rejects an insert naming an unknown world', async () => {
    const lead = (await pool.query(`select id from roles where name='lead'`)).rows[0].id;
    await expect(
      pool.query(`insert into user_roles(user_id, role_id, world_scope) values ($1,$2,$3)`, [
        U,
        lead,
        ['nope'],
      ]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('still accepts null (every world), {} (none) and real slugs', async () => {
    await setScope(null);
    expect((await resolvePermissions(pool, U)).worldScopes).toBeNull();
    await setScope([]);
    expect(await scopeOf()).toEqual([]);
    await setScope(['intl', 'tech']);
    expect(await joined()).toEqual(['intl', 'tech']);
    await setScope(['tech']);
  });

  it('cascades a slug rename into the array — the rename trigger passes the check', async () => {
    await pool.query(`update worlds set slug='technology' where slug='tech'`);
    expect(await scopeOf()).toEqual(['technology']);
    expect(await joined()).toEqual(['technology']);
    expect((await resolvePermissions(pool, U)).worldScopes).toEqual(['technology']);
    await pool.query(`update worlds set slug='tech' where slug='technology'`);
    expect(await scopeOf()).toEqual(['tech']);
  });

  it('prunes on delete, and a world that is still a document primary cannot be deleted at all', async () => {
    await pool.query(`insert into worlds(slug, name, position) values ('doomed-y','נמחק',96)`);
    await setScope(['tech', 'doomed-y']);
    await pool.query(`delete from worlds where slug='doomed-y'`);
    expect(await scopeOf()).toEqual(['tech']);
    // Re-creating the slug resurrects nothing, and naming the now-missing slug was refused anyway.
    await pool.query(`insert into worlds(slug, name, position) values ('doomed-y','נמחק',96)`);
    expect(await joined()).toEqual(['tech']);
    await pool.query(`delete from worlds where slug='doomed-y'`);

    // documents.category is `no action`: the world a document lives in cannot vanish under it.
    await pool.query(
      `insert into documents(slug, title, category, wave, priority) values ('am14-y','x','tech',1,'m')`,
    );
    await expect(pool.query(`delete from worlds where slug='tech'`)).rejects.toMatchObject({ code: '23503' });
  });

  it('down removes the check, and up reinstates it', async () => {
    await migrate(c.getConnectionUri(), 'down', await from0055());
    await setScope(['tech', 'later']);
    expect(await scopeOf()).toEqual(['tech', 'later']);
    await setScope(['tech']);
    await migrate(c.getConnectionUri(), 'up');
    await expect(setScope(['tech', 'later'])).rejects.toMatchObject({ code: '23503' });
  });
});
