import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { resolvePermissions } from '../../src/modules/auth/permissions.js';
import { gcUnreferencedAssets } from '../../src/modules/sourcedocs/assets.js';

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
      await pool.query(`select world_slug from user_role_worlds where user_id=$1 order by world_slug`, [U])
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

const asset = (n: number) => `a${n}aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const href = (n: number) => `<p><img src="/api/v1/assets/${asset(n)}"></p>`;

/**
 * B-M15. The gc used to extract asset ids out of every HTML row in the database on every weekly
 * run. `0045` has the database keep the answer instead, in `asset_refs`, maintained by a trigger
 * on each of the four columns an image can be referenced from.
 */
run('0045 — asset_refs (B-M15)', () => {
  let c: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let userId: string;
  let docId: string;

  const mkAsset = (n: number) =>
    pool.query(
      `insert into assets(id, mime, bytes, sha256, size, created_at)
         values ($1, 'image/png', '\\x00', $2, 1, now() - interval '30 days')
       on conflict (sha256) do nothing`,
      [asset(n), 'sha-' + n],
    );
  const refsOf = async (n: number) =>
    (
      await pool.query(`select owner_kind from asset_refs where asset_id=$1 order by owner_kind`, [asset(n)])
    ).rows.map((r) => r.owner_kind);
  const alive = async (n: number) =>
    (await pool.query(`select 1 from assets where id=$1`, [asset(n)])).rowCount === 1;

  beforeAll(async () => {
    c = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    pool = new pg.Pool({ connectionString: c.getConnectionUri() });
    await migrate(c.getConnectionUri(), 'up');
    userId = (
      await pool.query(
        `insert into users(subject, source, display_name) values ('bm15','local','X') returning id`,
      )
    ).rows[0].id;

    // Roll 0045 back, write HTML the way it was stored before the join table existed, then roll
    // forward: the backfill has to find references nothing recorded at the time.
    await migrate(c.getConnectionUri(), 'down', 1);
    await mkAsset(1);
    docId = (
      await pool.query(
        `insert into documents(slug, title, category, wave, priority, kind, status, body_html)
           values ('bm15','מסמך','tech',1,'hh','text','draft',$1) returning id`,
        [href(1)],
      )
    ).rows[0].id;
    await migrate(c.getConnectionUri(), 'up');
  }, 240000);

  afterAll(async () => {
    await pool?.end();
    await c?.stop();
  });

  it('backfills references out of HTML that was already stored', async () => {
    expect(await refsOf(1)).toEqual(['document']);
  });

  it('follows a save, in both directions, without the write path knowing', async () => {
    await mkAsset(2);
    // `documents/routes.ts` writes `body_html` and knows nothing about `asset_refs`.
    await pool.query(`update documents set body_html=$1 where id=$2`, [href(1) + href(2), docId]);
    expect(await refsOf(2)).toEqual(['document']);
    // Removing the image from the HTML releases the asset again.
    await pool.query(`update documents set body_html=$1 where id=$2`, [href(1), docId]);
    expect(await refsOf(2)).toEqual([]);
  });

  it('counts a draft as a reference, which is what keeps a pasted screenshot alive', async () => {
    await mkAsset(3);
    // An image is uploaded the moment it is pasted; the version that will reference it may not
    // be written for another week. `assets` is the only copy, so the draft has to count.
    await pool.query(`insert into drafts(user_id, draft_key, payload) values ($1, 'source:x', $2)`, [
      userId,
      JSON.stringify({ html: href(3) }),
    ]);
    expect(await refsOf(3)).toEqual(['draft']);
    // The run collects the image the previous test released and nothing else: the draft is a
    // reference, so the screenshot pasted minutes ago survives a gc pass it would once have
    // been swept up by.
    expect(await gcUnreferencedAssets(pool)).toBe(1);
    expect(await alive(2)).toBe(false);
    expect(await alive(3)).toBe(true);
  });

  it('collects an asset once the last reference goes, and not before', async () => {
    await mkAsset(4);
    const sd = (
      await pool.query(`insert into source_documents(document_id, html) values ($1,$2) returning id`, [
        docId,
        href(4),
      ])
    ).rows[0].id;
    await pool.query(
      `insert into source_document_versions(source_document_id, version, html) values ($1,1,$2)`,
      [sd, href(4)],
    );
    expect(await refsOf(4)).toEqual(['source_document', 'source_document_version']);
    expect(await gcUnreferencedAssets(pool)).toBe(0);

    // Dropping only the version leaves the source document's own copy holding it.
    await pool.query(`delete from source_document_versions where source_document_id=$1`, [sd]);
    expect(await refsOf(4)).toEqual(['source_document']);
    expect(await gcUnreferencedAssets(pool)).toBe(0);
    expect(await alive(4)).toBe(true);

    // Deleting the owner row clears its refs — nothing is left dangling behind a kind/id pair
    // that no longer addresses anything.
    await pool.query(`delete from source_documents where id=$1`, [sd]);
    expect(await refsOf(4)).toEqual([]);
    expect(await gcUnreferencedAssets(pool)).toBe(1);
    expect(await alive(4)).toBe(false);
    // The ones still referenced were not touched.
    expect(await alive(1)).toBe(true);
    expect(await alive(3)).toBe(true);
  });

  it('spares an asset younger than a day even with no reference at all', async () => {
    await pool.query(
      `insert into assets(id, mime, bytes, sha256, size) values ($1,'image/png','\\x00','fresh',1)`,
      [asset(5)],
    );
    expect(await refsOf(5)).toEqual([]);
    expect(await gcUnreferencedAssets(pool)).toBe(0);
    expect(await alive(5)).toBe(true);
  });
});
