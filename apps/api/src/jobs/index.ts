import type { FastifyInstance } from 'fastify';
import { makeEvent } from '@wecom/shared';
import { QUEUES } from '../plugins/boss.js';
import { withTransaction } from '../lib/sql.js';
import { purgeExpired } from '../modules/trash/repo.js';
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
      app.log.info({ n, sessions: s.rowCount }, 'trash purged');
    } catch (err) {
      await reportFailure(app, QUEUES.trashPurge, err);
      throw err;
    }
  });

  await boss.work(QUEUES.searchReindex, async () => {
    try {
      const n = await reindexAll(app.db);
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
