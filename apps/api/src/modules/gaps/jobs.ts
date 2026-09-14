import type { FastifyInstance } from 'fastify';
import { makeEvent } from '@wecom/shared';
import { QUEUES } from '../../plugins/boss.js';
import { runDetection, type DetectDeps } from './detect.js';

/** Nightly gap detection at 03:30 Asia/Jerusalem — after the day's usage has settled, before the shift starts. */
export async function startGapJobs(app: FastifyInstance, deps: () => DetectDeps): Promise<void> {
  const boss = app.boss;
  if (!boss || app.config.NODE_ENV === 'test') return;
  await boss.work(QUEUES.gapsDetect, async () => {
    const r = await runDetection({
      ...deps(),
      publish: (tx, gapId, kind) => app.events.publish(tx, makeEvent('gap.detected', { gapId, kind })),
    });
    app.log.info(r, 'gap detection run');
  });
  try {
    await boss.schedule(QUEUES.gapsDetect, '30 3 * * *', {}, { tz: 'Asia/Jerusalem' });
  } catch (err) {
    app.log.warn({ err }, 'could not schedule gaps.detect');
  }
}
