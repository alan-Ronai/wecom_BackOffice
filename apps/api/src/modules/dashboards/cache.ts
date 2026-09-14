import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Dashboard } from '@wecom/shared';
import type { Tx } from '../../lib/sql.js';

type Q = pg.Pool | pg.PoolClient | Tx;

/** The aggregates run over every document, view and suggestion, so they are not per-request work. */
export const DASHBOARD_TTL_MS = 60_000;

/**
 * The content stamp. One row for the whole dashboard, rewritten whenever something the dashboard
 * counts changes — today that is a telemetry batch, which is the only write the panel reflects
 * immediately.
 *
 * It is what makes the cache shared rather than merely stored. A per-process `Map` could be
 * cleared by the worker that took the write and by no one else, so after telemetry arrived one
 * replica showed the new counts and the others went on serving the old ones for up to a minute —
 * the same agent refreshing twice could watch the number go backwards. A stamp every replica
 * reads turns that into one invalidation for all of them.
 */
const STAMP_KEY = 'dashboard.stamp';
export const CACHE_PREFIX = 'dashboard.cache:';
const cacheKey = (key: string) => CACHE_PREFIX + key;

type Entry = { stamp: string; at: number; value: Dashboard };

/**
 * The stamp in force and the snapshot stored for `key`, in one round trip.
 *
 * A missing stamp row reads as `''`, which is also what a snapshot written before the first bump
 * carries — so an untouched deployment hits its cache rather than recomputing on every request.
 */
export async function readDashboardCache(q: Q, key: string): Promise<{ stamp: string; entry: Entry | null }> {
  const r = await q.query<{ key: string; value: unknown }>(
    'select key, value from system_state where key = any($1::text[])',
    [[STAMP_KEY, cacheKey(key)]],
  );
  const byKey = new Map(r.rows.map((x) => [x.key, x.value]));
  const stamp = (byKey.get(STAMP_KEY) as { v?: string } | undefined)?.v ?? '';
  const entry = (byKey.get(cacheKey(key)) as Entry | undefined) ?? null;
  return { stamp, entry };
}

export const isFresh = (entry: Entry, stamp: string, now = Date.now()): boolean =>
  entry.stamp === stamp && now - entry.at < DASHBOARD_TTL_MS;

/**
 * Stores a snapshot under the stamp that was in force *before* it was computed.
 *
 * Taking the stamp from before the computation is what makes the race safe: if a telemetry batch
 * lands while `computeDashboard` is running, the snapshot is written under the superseded stamp
 * and the next read discards it. The failure mode is an extra recomputation, never a stale panel.
 */
export async function writeDashboardCache(q: Q, key: string, stamp: string, value: Dashboard): Promise<void> {
  await q.query(
    `insert into system_state(key, value, updated_at) values ($1, $2, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [cacheKey(key), JSON.stringify({ stamp, at: Date.now(), value })],
  );
}

/** Invalidates every replica's snapshot at once. */
export async function bumpDashboardStamp(q: Q): Promise<void> {
  await q.query(
    `insert into system_state(key, value, updated_at) values ($1, $2, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [STAMP_KEY, JSON.stringify({ v: randomUUID() })],
  );
}

/**
 * Drops snapshots nothing has asked for in a day.
 *
 * The keys are scope-and-visibility combinations, so the set is bounded by the roles that exist
 * rather than by anything a caller chooses — but a role that is deleted, or an admin who looked
 * at the dashboard once, would otherwise leave a row behind forever.
 */
export async function purgeDashboardCache(q: Q): Promise<number> {
  const r = await q.query(
    `delete from system_state
      where key like $1 and updated_at < now() - interval '1 day'`,
    [CACHE_PREFIX + '%'],
  );
  return r.rowCount ?? 0;
}
