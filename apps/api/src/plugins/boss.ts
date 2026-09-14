import fp from 'fastify-plugin';
import PgBoss from 'pg-boss';
import { checkBackupAge, recordBackupCheck } from '../services/backupCheck.js';

export const QUEUES = {
  pipelineProcess: 'pipeline.process', // L5: turn a source revision into suggestions (concurrency 1)
  sourcesWatch: 'sources.watch', // L5: watched-folder poller
  connectorRun: 'connector.run', // L6: scheduled connector sync (one schedule per connector id)
  connectorWebhook: 'connector.webhook', // L6: webhook-triggered sync
  identitySync: 'identity.sync', // L3: nightly Entra users/groups refresh
  trashPurge: 'trash.purge', // L2: nightly hard delete after 30 days
  searchReindex: 'search.reindex', // L2: rebuild search_text / embeddings
  backupCheck: 'system.backup-check', // L1: verify last backup age
  feedbackDigest: 'feedback.digest', // W3: daily per-editor summary of open feedback
  feedbackAlerts: 'feedback.alerts', // W3: every 10 min, repeat/anomaly windows
  assetsGc: 'assets.gc', // W4: weekly, delete assets no source version references
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

declare module 'fastify' {
  interface FastifyInstance {
    boss: PgBoss | null;
  }
}

export default fp(async (app, opts: { boss?: boolean }) => {
  if (opts.boss === false) {
    app.decorate('boss', null);
    return;
  }
  const boss = new PgBoss({
    connectionString: app.config.DATABASE_URL,
    schema: 'pgboss',
    retryLimit: 3,
    retryBackoff: true,
    archiveCompletedAfterSeconds: 3600,
    deleteAfterDays: 7,
  });
  boss.on('error', (err) => app.log.error({ err }, 'pg-boss error'));
  try {
    await boss.start();
    for (const q of Object.values(QUEUES)) await boss.createQueue(q);
    app.decorate('boss', boss);
    app.log.info('pg-boss started');
    // L1-owned worker: nightly verification that deploy/backup.sh actually wrote
    // a recent dump into BACKUP_DIR. Scheduled a bit after the 02:15 backup run.
    await boss.work(QUEUES.backupCheck, async () => {
      const result = await checkBackupAge(app.config.BACKUP_DIR);
      if (!result.ok) app.log.warn({ result }, 'backup check: no recent backup found');
      else app.log.info({ result }, 'backup check: ok');
      try {
        await recordBackupCheck(app.db, result);
      } catch (err) {
        app.log.warn({ err }, 'could not record backup check result');
      }
    });
    try {
      await boss.schedule(QUEUES.backupCheck, '30 3 * * *', {}, { tz: 'Asia/Jerusalem' });
    } catch (err) {
      app.log.warn({ err }, 'could not schedule system.backup-check');
    }
    // Also queue one run at boot so `lastBackupAt`/`lastBackupOk` are populated for
    // health/admin readers immediately, rather than only after the nightly schedule fires.
    try {
      await boss.send(QUEUES.backupCheck, {});
    } catch (err) {
      app.log.warn({ err }, 'could not queue an initial system.backup-check run');
    }
  } catch (err) {
    app.log.warn({ err }, 'pg-boss not started (database unreachable)');
    app.decorate('boss', null);
    return;
  }
  app.addHook('onClose', async () => {
    await boss.stop({ graceful: true, timeout: 5000 });
  });
});
