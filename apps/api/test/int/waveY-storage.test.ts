import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdir } from 'node:fs/promises';
import type pg from 'pg';
import { runner } from 'node-pg-migrate';
import { startTestDb, integration, type TestDb } from '../helpers/db.js';
import { gcUnreferencedAssets } from '../../src/modules/sourcedocs/assets.js';

/**
 * Wave Y lane Y2 — the two migrations of the lane, against a real Postgres.
 *
 * 0056 (B-M15, closing it): `asset_refs` gains the two wave-5 HTML columns 0045 predates —
 * `learning_items.description` and its frozen copy in `learning_item_versions.snapshot → item →
 * description` — with the trigger generalised to any path depth, a backfill, and a `down`.
 *
 * 0057: `telemetry_events.kind` loses the dead `view_topic` value.
 */
const run = integration ? describe : describe.skip;

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

/** Counted from the directory, never hardcoded: "down N" must stop just below `from`. */
const countFrom = async (from: number) =>
  (await readdir('migrations')).filter((f) => Number(/^(\d{4})_/.exec(f)?.[1] ?? NaN) >= from).length;

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const href = (n: number) => `<p><img src="/api/v1/assets/${uuid(n)}"></p>`;

run('0056 — asset_refs covers learning items (B-M15)', () => {
  let db: TestDb;
  let pool: pg.Pool;
  let legacyItem: string;
  let userId: string;

  const mkAsset = (n: number) =>
    pool.query(
      `insert into assets(id, mime, bytes, sha256, size, created_at)
       values ($1, 'image/png', '\\x00', $2, 1, now() - interval '2 days')`,
      [uuid(n), 'y2-' + n],
    );
  const refsOf = async (n: number) =>
    (await pool.query(`select owner_kind from asset_refs where asset_id=$1 order by 1`, [uuid(n)])).rows.map(
      (r) => r.owner_kind as string,
    );
  const alive = async (n: number) =>
    (await pool.query(`select 1 from assets where id=$1`, [uuid(n)])).rowCount === 1;
  const mkItem = async (description: string) =>
    (
      await pool.query(
        `insert into learning_items(kind, title, description) values ('briefing','תדריך',$1) returning id`,
        [description],
      )
    ).rows[0].id as string;

  beforeAll(async () => {
    db = await startTestDb();
    pool = db.pool;
    // Roll back to just below 0056, store a briefing intro that names an image the way wave 5
    // did (no trigger), then roll forward: the backfill must find it.
    await migrate(db.url, 'down', await countFrom(56));
    await mkAsset(1);
    legacyItem = await mkItem(href(1));
    await pool.query(`insert into learning_item_versions(item_id, version, snapshot) values ($1, 1, $2)`, [
      legacyItem,
      JSON.stringify({ item: { id: legacyItem, description: href(1) }, sourceVersions: [] }),
    ]);
    expect(await refsOf(1)).toEqual([]);
    await migrate(db.url, 'up');
    userId = (
      await pool.query(
        `insert into users(subject, source, display_name) values ('y2','local','Y') returning id`,
      )
    ).rows[0].id;
  }, 240000);

  afterAll(async () => {
    await db?.stop();
  });

  it('backfills references already stored in a description and a frozen version', async () => {
    expect(await refsOf(1)).toEqual(['learning_item', 'learning_item_version']);
  });

  it('a description save adds and removes the reference', async () => {
    await mkAsset(2);
    const item = await mkItem('<p>בלי תמונה</p>');
    expect(await refsOf(2)).toEqual([]);
    await pool.query(`update learning_items set description=$1 where id=$2`, [href(2), item]);
    expect(await refsOf(2)).toEqual(['learning_item']);
    await pool.query(`update learning_items set description='<p>שוב בלי</p>' where id=$1`, [item]);
    expect(await refsOf(2)).toEqual([]);
  });

  it('a frozen version reads snapshot → item → description, three keys deep', async () => {
    await mkAsset(3);
    const item = await mkItem('');
    await pool.query(`insert into learning_item_versions(item_id, version, snapshot) values ($1, 1, $2)`, [
      item,
      JSON.stringify({ item: { id: item, description: href(3) }, sourceVersions: [] }),
    ]);
    expect(await refsOf(3)).toEqual(['learning_item_version']);
    // Deleting the item cascades to its versions, and the delete arm clears both owners.
    await pool.query(`delete from learning_items where id=$1`, [item]);
    expect(await refsOf(3)).toEqual([]);
  });

  it("keeps 0045's five owners working through the generalised trigger", async () => {
    await mkAsset(4);
    await mkAsset(5);
    await pool.query(
      `insert into documents(slug, title, category, wave, priority, kind, status, body_html)
       values ('y2doc','מסמך','tech',1,'hh','text','draft',$1)`,
      [href(4)],
    );
    await pool.query(`insert into drafts(user_id, draft_key, payload) values ($1,'source:y2',$2)`, [
      userId,
      JSON.stringify({ html: href(5) }),
    ]);
    expect(await refsOf(4)).toEqual(['document']);
    expect(await refsOf(5)).toEqual(['draft']);
  });

  it('gc keeps every referenced asset and deletes the unreferenced one', async () => {
    await mkAsset(6); // referenced by nothing
    // #2 and #3 were released above; #6 never had a reference.
    expect(await gcUnreferencedAssets(pool)).toBe(3);
    for (const n of [2, 3, 6]) expect(await alive(n)).toBe(false);
    for (const n of [1, 4, 5]) expect(await alive(n)).toBe(true);
  });

  it('down restores 0045: the new owners are refused, the old ones still tracked', async () => {
    await migrate(db.url, 'down', await countFrom(56));
    expect(await refsOf(1)).toEqual([]);
    await expect(
      pool.query(`insert into asset_refs(asset_id, owner_kind, owner_id) values ($1,'learning_item',$1)`, [
        uuid(1),
      ]),
    ).rejects.toThrow(/asset_refs_owner_kind_check/);
    await mkAsset(7);
    await pool.query(`update documents set body_html=$1 where slug='y2doc'`, [href(7)]);
    expect(await refsOf(7)).toEqual(['document']);
    await migrate(db.url, 'up');
    expect(await refsOf(1)).toEqual(['learning_item', 'learning_item_version']);
  });
});

run('0057 — telemetry kind view_topic is gone', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await startTestDb();
  }, 240000);
  afterAll(async () => {
    await db?.stop();
  });

  const insert = (kind: string) => db.pool.query(`insert into telemetry_events(kind) values ($1)`, [kind]);

  it('refuses view_topic, keeps every other kind, and down widens back', async () => {
    await expect(insert('view_topic')).rejects.toThrow(/telemetry_events_kind_check/);
    for (const k of ['outcome', 'call_completed', 'palette', 'jump', 'search_click', 'client_error'])
      await insert(k);
    await migrate(db.url, 'down', await countFrom(57));
    await insert('view_topic');
    // Re-up deletes the row the narrowed check would reject instead of failing on it.
    await migrate(db.url, 'up');
    expect(
      (await db.pool.query(`select count(*)::int n from telemetry_events where kind='view_topic'`)).rows[0].n,
    ).toBe(0);
    await expect(insert('view_topic')).rejects.toThrow(/telemetry_events_kind_check/);
  });
});
