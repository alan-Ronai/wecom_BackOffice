import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import routes from './routes.js';
import { startSourcedocsJobs } from './jobs.js';

export default async function sourcedocs(app: FastifyInstance) {
  // `app.ts` registers @fastify/multipart on the /api/v1 scope *after* registerModules, so its
  // content-type parser is invisible to routes declared here. Registering it in this module's own
  // context (the plugin is fastify-plugin-wrapped, so it lands on this context, not on /api/v1)
  // gives `/source/import` and `/assets` a parser without touching app.ts.
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  await app.register(routes);
  app.addHook('onReady', async () => {
    await startSourcedocsJobs(app);
  });
}
