import type { FastifyInstance } from 'fastify';
import { setUsage } from '../../plugins/wave4.js';
import { PgUsage } from './recorder.js';
import routes from './routes.js';

/**
 * W5 module. A plain module plugin like every other entry in `registerModules`: W0's `app.usage`
 * is a delegating holder decorated once on the root, so `setUsage` swaps the implementation for
 * every sibling module (the search module included) and for jobs — no `fastify-plugin` needed.
 */
export default async function usageModule(app: FastifyInstance) {
  setUsage(app, new PgUsage(app.db, app.log));
  await app.register(routes);
}
