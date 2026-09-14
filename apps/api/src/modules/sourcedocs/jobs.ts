import type { FastifyInstance } from 'fastify';
import { QUEUES } from '../../plugins/boss.js';
import { gcUnreferencedAssets } from './assets.js';

/** Weekly: drop image assets no source version or text body references (kept ≥1 day so in-flight edits survive). */
export async function startSourcedocsJobs(app: FastifyInstance): Promise<void> {
  const boss = app.boss;
  if (!boss || app.config.NODE_ENV === 'test') return;
  await boss.work(QUEUES.assetsGc, async () => {
    const n = await gcUnreferencedAssets(app.db);
    app.log.info({ n }, 'assets gc');
  });
  try {
    await boss.schedule(QUEUES.assetsGc, '0 4 * * 0', {}, { tz: 'Asia/Jerusalem' });
  } catch (err) {
    app.log.warn({ err }, 'could not schedule assets.gc');
  }
}
