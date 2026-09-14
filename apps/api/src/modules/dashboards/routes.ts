import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { DashboardSchema, TelemetryBatchSchema, type Dashboard } from '@wecom/shared';
import { requireUser } from '../../lib/user.js';
import * as repo from './repo.js';

/** The aggregates run over every document, view and suggestion, so they are not per-request work. */
const CACHE_TTL_MS = 60_000;

export default async function routes(app: FastifyInstance) {
  let cached: { at: number; value: Dashboard } | null = null;

  app.get(
    '/dashboards',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['dashboards'], response: { 200: DashboardSchema } },
    },
    async (req) => {
      requireUser(req);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
      const value = await repo.computeDashboard(app.db);
      cached = { at: Date.now(), value };
      return value;
    },
  );

  app.post(
    '/telemetry',
    { config: { requires: ['docs.read'] }, schema: { tags: ['dashboards'], body: TelemetryBatchSchema } },
    async (req, reply) => {
      const user = requireUser(req);
      const body = req.body as z.infer<typeof TelemetryBatchSchema>;
      const written = await repo.recordTelemetry(app.db, user.id, body.events);
      // Usage on the dashboard has to reflect what just happened, not the last minute.
      if (written) cached = null;
      reply.code(204);
      return null;
    },
  );
}
