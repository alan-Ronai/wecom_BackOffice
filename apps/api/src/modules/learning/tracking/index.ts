import type { FastifyInstance } from 'fastify';
import trackingRoutes from './routes.js';
import { startTrackingJobs } from './jobs.js';
import type { TrackingDeps } from './audiences.js';
import { setPublishFlagDeps } from '../../documents/publishWithFlag.js';

/** V2 module. `deps` is a thunk so the notifier in force at call time is used (tests swap it). */
export default async function learningTrackingModule(app: FastifyInstance) {
  const deps = (): TrackingDeps => ({
    db: app.db,
    notifier: app.notifier,
    events: app.events,
    log: app.log,
  });
  /**
   * A-C2: the same two holders for `sources/content-adapter.ts`, which implements L5's
   * `ContentApi` and is handed a database client and nothing else. Registered here, the way
   * wave 4 says a lane wires `setNotifier` and friends — the holders are decorated on the root
   * instance, so this reaches every sibling module and every job.
   */
  setPublishFlagDeps({ notifier: app.notifier, events: app.events });
  await app.register(trackingRoutes(deps));
  app.addHook('onReady', async () => {
    await startTrackingJobs(app, deps);
  });
}
