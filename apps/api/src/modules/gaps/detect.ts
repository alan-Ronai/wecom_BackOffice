import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import type { GapDetectResult, Notifier, TaxonomyResolver } from '@wecom/shared';
import { getWorkflowSettings } from '../../lib/workflowSettings.js';
import { withTransaction, type Tx } from '../../lib/sql.js';
import { allHeuristics } from './heuristics.js';
import { autoResolvePublished, getGap, recordRun, upsertCandidates } from './repo.js';

export interface DetectDeps {
  db: pg.Pool;
  notifier: Notifier;
  taxonomy: TaxonomyResolver;
  log: FastifyBaseLogger;
  /** Publishes `gap.detected`; injected so the module can pass `app.events.publish(tx, …)`. */
  publish?: (tx: Tx, gapId: string, kind: string) => Promise<void>;
}

/**
 * Who to tell about a new gap.
 *
 * W1's `usersWithPermissionInWorld` matches a user whose `world_scope` is null *or* contains the
 * world it is given, so there is no slug that means "any world" — passing `'*'` would quietly
 * reach unrestricted users only, and a lead scoped to `billing` would never hear about the
 * zero-result searches they are the ones to answer. A world-less gap therefore unions the
 * resolver over every active world here, rather than teaching `PgTaxonomy` a wildcard it has no
 * other caller for.
 */
async function recipientsFor(d: DetectDeps, worldSlug: string | null): Promise<string[]> {
  if (worldSlug) return d.taxonomy.usersWithPermissionInWorld('gaps.manage', worldSlug);
  const worlds = await d.db.query<{ slug: string }>('select slug from worlds where active order by position');
  const ids = new Set<string>();
  for (const w of worlds.rows)
    for (const id of await d.taxonomy.usersWithPermissionInWorld('gaps.manage', w.slug)) ids.add(id);
  return [...ids];
}

/**
 * One detection run: heuristics → idempotent upsert → auto-resolve → notify the new gaps → run log.
 * Every outcome, failure included, lands in `gap_runs`, which is what `lastRunAt` reports to the UI.
 */
/**
 * A-M12: one detection run at a time, across every API instance.
 *
 * A run is five full-table heuristics — a `cume_dist` window over every published document and a
 * `jsonb_each` over 90 days of attempts among them — and `POST /gaps/detect` offered it on demand
 * to any `gaps.manage` holder with no throttle and no guard against the nightly job. A session
 * advisory lock is the cheap version: Postgres releases it if the process dies, so a crashed run
 * cannot wedge the button, and the whole thing costs one round trip.
 *
 * `0x9a95` is an arbitrary constant; `pg_try_advisory_lock` takes an int, and a literal keeps the
 * key greppable and stable across releases in a way `hashtext('gaps.detect')` would not be.
 */
const DETECT_LOCK = 0x9a95;
export class GapRunInProgress extends Error {
  readonly statusCode = 429;
  readonly code = 'GAP_RUN_IN_PROGRESS';
  constructor() {
    super('זיהוי פערים כבר רץ כעת — נסו שוב בעוד רגע');
  }
}

/** How recently a run started, in milliseconds, or null if there has never been one. */
export async function msSinceLastRun(d: Pick<DetectDeps, 'db'>): Promise<number | null> {
  const r = await d.db.query<{ ms: string }>(
    `select extract(epoch from (now() - max(started_at))) * 1000 ms from gap_runs`,
  );
  const ms = r.rows[0]?.ms;
  return ms == null ? null : Number(ms);
}

export async function runDetection(d: DetectDeps): Promise<GapDetectResult> {
  const started = new Date();
  const client = await d.db.connect();
  try {
    const got = await client.query<{ locked: boolean }>('select pg_try_advisory_lock($1) locked', [
      DETECT_LOCK,
    ]);
    if (!got.rows[0].locked) throw new GapRunInProgress();
    return await detect(d, started);
  } finally {
    await client.query('select pg_advisory_unlock($1)', [DETECT_LOCK]).catch(() => undefined);
    client.release();
  }
}

async function detect(d: DetectDeps, started: Date): Promise<GapDetectResult> {
  try {
    const s = await getWorkflowSettings(d.db);
    const cands = await allHeuristics(d.db, s.gaps);
    const result = await withTransaction(d.db, async (tx) => {
      const up = await upsertCandidates(tx, cands);
      const resolved = await autoResolvePublished(tx);
      for (const id of up.newIds) {
        const g = await getGap(tx, id);
        if (g && d.publish) await d.publish(tx, g.id, g.kind);
      }
      return { ...up, resolved };
    });
    // Notifications land outside the transaction: a notifier that fails must not undo the run,
    // and the upsert is the thing that must not be repeated.
    for (const id of result.newIds) {
      const g = await getGap(d.db, id);
      if (!g) continue;
      const users = await recipientsFor(d, g.worldSlug);
      if (!users.length) continue;
      await d.notifier.notify({
        userIds: users,
        kind: 'gap',
        title: g.title,
        body: `פער ידע חדש (${g.kind})`,
        href: '/gaps',
        entityType: 'gap',
        entityId: g.id,
      });
    }
    const out = {
      detected: result.detected,
      updated: result.updated,
      resolvedAutomatically: result.resolved,
      tookMs: Date.now() - started.getTime(),
    };
    await recordRun(
      d.db,
      { detected: out.detected, updated: out.updated, resolved: out.resolvedAutomatically },
      started,
    );
    return out;
  } catch (err) {
    d.log.error({ err }, 'gap detection failed');
    await recordRun(
      d.db,
      { detected: 0, updated: 0, resolved: 0, error: (err as Error).message },
      started,
    ).catch(() => undefined);
    throw err;
  }
}
