import type { FastifyInstance } from 'fastify';
import learningRoutes from './routes.js';

/** V1 module (wave 5): learning content. V2 registers assignments/tracking in the same prefix from its own module. */
export default async function learningModule(app: FastifyInstance) {
  await app.register(learningRoutes);
}
