import type { FastifyInstance } from 'fastify';
import trackingRoutes from './routes.js';
import { startTrackingJobs } from './jobs.js';
import type { TrackingDeps } from './audiences.js';

/** V2 module. `deps` is a thunk so the notifier in force at call time is used (tests swap it). */
export default async function learningTrackingModule(app: FastifyInstance) {
  const deps = (): TrackingDeps => ({
    db: app.db,
    notifier: app.notifier,
    events: app.events,
    log: app.log,
  });
  await app.register(trackingRoutes(deps));
  app.addHook('onReady', async () => {
    await startTrackingJobs(app, deps);
  });
}
