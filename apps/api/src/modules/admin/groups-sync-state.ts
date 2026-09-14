import type pg from 'pg';

/**
 * Per-group "when did the nightly `identity.sync` job last reconcile this mapping".
 *
 * ## Why `system_state` and not a column
 *
 * The natural home is `groups_map.last_synced_at`, and that is what this was written as first. It
 * could not land: migrations `0026`–`0028` were already taken by this wave and `0029` belongs to
 * the wave-4 program running in parallel, so there is no free number below it to put an `alter
 * table` in, and inserting one would renumber somebody else's migration under them. `system_state`
 * exists for exactly this shape of problem — a background worker's result that a request handler in
 * another process has to read back — and `0025_system_state.js` already ships it.
 *
 * ## What the timestamps mean
 *
 * One run reconciles *every* mapping: `runIdentitySync` walks all active Entra users and calls
 * `applyGroupMap`, which adds and removes roles against the whole `groups_map` table. So a
 * successful run stamps every row that existed when it started, and a mapping added afterwards
 * reads back `null` — "saved, not yet applied to anyone" — which is a real state the screen has to
 * be able to show rather than a gap to paper over with the run's timestamp.
 */
export const GROUPS_SYNC_STATE_KEY = 'identity.groups_map.last_synced_at';

/** `idpGroupId` → ISO timestamp of the run that last reconciled it. */
export type GroupsSyncState = Record<string, string>;

export async function readGroupsSyncState(db: pg.Pool | pg.PoolClient): Promise<GroupsSyncState> {
  try {
    const r = await db.query<{ value: GroupsSyncState }>('select value from system_state where key=$1', [
      GROUPS_SYNC_STATE_KEY,
    ]);
    const v = r.rows[0]?.value;
    return v && typeof v === 'object' ? v : {};
  } catch {
    // `system_state` may not exist yet (pre-migration); an empty map reads as "never synced",
    // which is the honest answer and not an error worth failing the admin screen over.
    return {};
  }
}

/**
 * Stamps `at` onto every group id currently mapped, merging into whatever is already recorded so a
 * mapping deleted and re-added keeps its history rather than silently resetting to "never".
 */
export async function recordGroupsSynced(db: pg.Pool | pg.PoolClient, at: Date): Promise<string[]> {
  const mapped = (await db.query<{ idp_group_id: string }>('select idp_group_id from groups_map')).rows.map(
    (r) => r.idp_group_id,
  );
  if (!mapped.length) return [];
  const previous = await readGroupsSyncState(db);
  const next: GroupsSyncState = { ...previous };
  for (const id of mapped) next[id] = at.toISOString();
  await db.query(
    `insert into system_state(key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    [GROUPS_SYNC_STATE_KEY, JSON.stringify(next)],
  );
  return mapped;
}
