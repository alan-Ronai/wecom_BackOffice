import type { FastifyInstance } from 'fastify';
import feedbackRoutes from './routes.js';
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
  await app.register(feedbackRoutes(deps));
}
