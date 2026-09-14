import type { FastifyInstance } from 'fastify';
import { setTaxonomy } from '../../plugins/wave4.js';
import { PgTaxonomy } from './repo.js';
import routes from './routes.js';

/**
 * A plain module plugin like every other entry in `registerModules`. `app.taxonomy` is a
 * delegating holder decorated once on the root, so `setTaxonomy` swaps the implementation
 * every sibling module and job sees — no `fastify-plugin` wrapping needed here.
 */
export default async function taxonomy(app: FastifyInstance) {
  await app.register(routes);
  setTaxonomy(app, new PgTaxonomy(app.db));
}
