import type { FastifyInstance } from 'fastify';
import routes from './routes.js';
import { startSourcedocsJobs } from './jobs.js';

export default async function sourcedocs(app: FastifyInstance) {
  await app.register(routes);
  app.addHook('onReady', async () => {
    await startSourcedocsJobs(app);
  });
}
