import type { FastifyInstance } from 'fastify';
import { QUEUES } from '../../plugins/boss.js';
import { evaluateWindows, sendDigest, type AlertDeps } from './alerts.js';

/** Same shape as `apps/api/src/jobs/index.ts`: no-op without pg-boss or under NODE_ENV=test. */
export async function startFeedbackJobs(app: FastifyInstance, deps: () => AlertDeps): Promise<void> {
  const boss = app.boss;
  if (!boss || app.config.NODE_ENV === 'test') return;
  await boss.work(QUEUES.feedbackAlerts, async () => {
    const r = await evaluateWindows(deps());
    if (r.repeat || r.anomaly) app.log.info(r, 'feedback window alerts sent');
  });
  await boss.work(QUEUES.feedbackDigest, async () => {
    const n = await sendDigest(deps());
    app.log.info({ n }, 'feedback digest sent');
  });
  for (const [q, cron] of [
    [QUEUES.feedbackAlerts, '*/10 * * * *'],
    [QUEUES.feedbackDigest, '0 8 * * *'],
  ] as const) {
    try {
      await boss.schedule(q, cron, {}, { tz: 'Asia/Jerusalem' });
    } catch (err) {
      app.log.warn({ err, q }, 'could not schedule feedback job');
    }
  }
}
