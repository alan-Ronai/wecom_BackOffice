import type { FastifyInstance } from 'fastify';

/** Filled in by Task 11 (trash purge + search reindex workers). */
export async function startJobs(app: FastifyInstance): Promise<void> {
  if (!app.boss) return;
}
