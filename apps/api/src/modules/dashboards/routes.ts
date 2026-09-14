import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { DashboardSchema, TelemetryBatchSchema, type Dashboard } from '@wecom/shared';
import { requireUser } from '../../lib/user.js';
import * as repo from './repo.js';

/** The aggregates run over every document, view and suggestion, so they are not per-request work. */
const CACHE_TTL_MS = 60_000;

export default async function routes(app: FastifyInstance) {
  /**
   * Keyed by the caller's scope, because the document-derived aggregates are now scoped: one
   * shared entry would have served a `tech`-only reader whatever the previous caller saw.
   * Still per *process*, so a multi-worker deployment serves up to N snapshots up to 60 s old —
   * which is what the contract's "cached 60 s" already allows.
   */
  const cache = new Map<string, { at: number; value: Dashboard }>();
  const keyOf = (scopes: string[] | null) => (scopes ? [...scopes].sort().join(',') : '*');

  app.get(
    '/dashboards',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['dashboards'], response: { 200: DashboardSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const key = keyOf(user.categoryScopes);
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
      const value = await repo.computeDashboard(app.db, user.categoryScopes);
      cache.set(key, { at: Date.now(), value });
      return value;
    },
  );

  app.post(
    '/telemetry',
    {
      // `TelemetryBatchSchema` caps a batch at 200 events; nothing capped the *batches*, and
      // this is the one write route every agent holds the permission for. 120/minute is far
      // more than any real client sends (the web batches on an interval) and bounds the table's
      // growth to something the 90-day retention can hold.
      config: { requires: ['docs.read'], rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: { tags: ['dashboards'], body: TelemetryBatchSchema },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const body = req.body as z.infer<typeof TelemetryBatchSchema>;
      const written = await repo.recordTelemetry(app.db, user.id, body.events);
      // Usage on the dashboard has to reflect what just happened, not the last minute.
      if (written) cache.clear();
      reply.code(204);
      return null;
    },
  );
}
