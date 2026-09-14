import type { FastifyInstance } from 'fastify';
import { setNotifier } from '../../plugins/wave4.js';
import feedbackRoutes from './routes.js';
import { PgNotifier } from './notifier.js';
import type { AlertDeps } from './alerts.js';

/**
 * W3 module. `deps` is resolved lazily so the notifier/taxonomy in force at call time is used —
 * tests swap them with `setNotifier` / `setTaxonomy` after the app is built.
 */
export default async function feedbackModule(app: FastifyInstance) {
  const deps = (): AlertDeps => ({
    db: app.db,
    notifier: app.notifier,
    taxonomy: app.taxonomy,
    log: app.log,
  });
  // The W0 holder delegates, so swapping here is visible to every sibling module and to jobs.
  setNotifier(app, new PgNotifier(app.db, app.events, app.log));
  await app.register(feedbackRoutes(deps));
}
