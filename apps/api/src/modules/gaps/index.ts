import type { FastifyInstance } from 'fastify';
import gapsRoutes from './routes.js';
import { startGapJobs } from './jobs.js';
import type { DetectDeps } from './detect.js';

/** V3 module: gap routes + the nightly job. Deps resolved lazily so tests can swap notifier/taxonomy. */
export default async function gapsModule(app: FastifyInstance) {
  const deps = (): DetectDeps => ({
    db: app.db,
    notifier: app.notifier,
    taxonomy: app.taxonomy,
    log: app.log,
  });
  await app.register(gapsRoutes(deps));
  app.addHook('onReady', async () => {
    await startGapJobs(app, deps);
  });
}
