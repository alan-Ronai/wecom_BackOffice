import type { FastifyInstance } from 'fastify';
import type { ModelClient } from '@wecom/model';
import { makeEvent } from '@wecom/shared';
import { QUEUES } from '../plugins/boss.js';
import { withTransaction } from '../lib/sql.js';
import { purgeExpired } from '../modules/trash/repo.js';
import { purgeTelemetry } from '../modules/dashboards/repo.js';
import { purgeDashboardCache } from '../modules/dashboards/cache.js';
import { purgeWebhookNonces } from '../modules/connectors/nonces.js';
import { reindexAll } from '../modules/search/repo.js';

/** Publish `job.failed` so the system screen and SSE clients see a failed background run. */
async function reportFailure(app: FastifyInstance, jobName: string, err: unknown) {
  app.log.error({ err, jobName }, 'job failed');
  if (!app.events.listening) return;
  try {
    await withTransaction(app.db, (tx) =>
      app.events.publish(
        tx,
        makeEvent('job.failed', {
          jobName,
          jobId: '',
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
    );
  } catch (e) {
    app.log.error({ err: e }, 'could not publish job.failed');
  }
}

/**
 * L2 background workers, bound to L1's shared pg-boss instance (`app.boss`, `QUEUES`).
 * No-op when pg-boss is not running (tests, or an unreachable database).
 */
export async function startJobs(app: FastifyInstance): Promise<void> {
  const boss = app.boss;
  // Tests drive the queues themselves; a live worker here would steal their jobs.
  if (!boss || app.config.NODE_ENV === 'test') return;

  await boss.work(QUEUES.trashPurge, async () => {
    try {
      const n = await purgeExpired(app.db, app.config.TRASH_DAYS);
      // Nothing else ever deletes sessions, so the table (and /admin/sessions) grew
      // without bound. Keep a week of history past expiry/revocation for the audit view.
      const s = await app.db.query(
        `delete from sessions where (expires_at < now() - interval '7 days')
           or (revoked_at is not null and revoked_at < now() - interval '7 days')`,
      );
      // `POST /telemetry` needs only `docs.read` and had no retention at all, while the
      // dashboard reads nothing older than 30 days.
      const t = await purgeTelemetry(app.db);
      // `presence` expiry is a read-time filter, so rows accumulated one per (document, user)
      // forever. `presence_last_seen_at_index` existed and nothing used it; now it does.
      const p = await app.db.query(`delete from presence where last_seen_at < now() - interval '1 day'`);
      // I7: the webhook replay store only has to remember a delivery for as long as one could
      // still be replayed (`MAX_WEBHOOK_SKEW_MS`, five minutes). Without this it would grow one
      // row per post save, forever.
      const w = await purgeWebhookNonces(app.db);
      // Dashboard snapshots are keyed by scope-and-visibility, so a deleted role would otherwise
      // leave its row in `system_state` forever.
      const d = await purgeDashboardCache(app.db);
      app.log.info(
        { n, sessions: s.rowCount, telemetry: t, presence: p.rowCount, webhookNonces: w, dashboards: d },
        'housekeeping: trash, sessions, telemetry, presence, webhook nonces, dashboard cache',
      );
    } catch (err) {
      await reportFailure(app, QUEUES.trashPurge, err);
      throw err;
    }
  });

  await boss.work(QUEUES.searchReindex, async () => {
    try {
      // L5 decorates app.model; embeddings are best-effort and skipped when it's absent
      // or disabled (reindexAll/updateEmbedding no-op cleanly in that case).
      const model = (app as unknown as { model?: ModelClient | null }).model ?? null;
      const n = await reindexAll(app.db, model);
      app.log.info({ n }, 'search reindexed');
    } catch (err) {
      await reportFailure(app, QUEUES.searchReindex, err);
      throw err;
    }
  });

  try {
    await boss.schedule(QUEUES.trashPurge, '0 3 * * *', {}, { tz: 'Asia/Jerusalem' });
  } catch (err) {
    app.log.warn({ err }, 'could not schedule trash.purge');
  }
}
