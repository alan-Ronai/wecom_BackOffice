import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { DashboardSchema, TelemetryBatchSchema } from '@wecom/shared';
import { requireUser } from '../../lib/user.js';
import { canReadUnpublished } from '../../lib/visibility.js';
import * as repo from './repo.js';
import { bumpDashboardStamp, isFresh, readDashboardCache, writeDashboardCache } from './cache.js';

export default async function routes(app: FastifyInstance) {
  /**
   * Keyed by the caller's scope, because the document-derived aggregates are scoped: one shared
   * entry would have served a `tech`-only reader whatever the previous caller saw.
   *
   * The entries live in `system_state` rather than in a per-process `Map`. Wave 3's ruling was
   * that N workers serving N snapshots each under 60 s old is within "cached 60 s", and for the
   * age alone that is true — but only the worker that took a telemetry batch could clear its own
   * map, so the invalidation was per-process too and the replicas openly disagreed: refresh
   * twice after recording an outcome and the count could go backwards. A stamp in the database
   * is one invalidation for every replica.
   */
  const keyOf = (scopes: string[] | null) => (scopes ? [...scopes].sort().join(',') : '*');

  app.get(
    '/dashboards',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['dashboards'], response: { 200: DashboardSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      // The cache key carries the visibility half too, or a reader would be served an editor's
      // snapshot (and the other way round) for up to a minute.
      const readUnpublished = canReadUnpublished(user);
      const key = keyOf(user.worldScopes) + (readUnpublished ? '|all' : '|published');
      // The cache is an optimisation, never a dependency: if `system_state` cannot be read the
      // panel is computed rather than refused.
      let stamp = '';
      try {
        const cached = await readDashboardCache(app.db, key);
        stamp = cached.stamp;
        if (cached.entry && isFresh(cached.entry, stamp)) return cached.entry.value;
      } catch (err) {
        req.log.warn({ err }, 'dashboard cache unreadable; computing');
      }
      const value = await repo.computeDashboard(app.db, user.worldScopes, readUnpublished);
      try {
        await writeDashboardCache(app.db, key, stamp, value);
      } catch (err) {
        req.log.warn({ err }, 'dashboard cache unwritable');
      }
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
      // Usage on the dashboard has to reflect what just happened, not the last minute — and on
      // every replica, not only on the one that happened to take this batch.
      if (written)
        await bumpDashboardStamp(app.db).catch((err) =>
          req.log.warn({ err }, 'could not bump the dashboard stamp'),
        );
      reply.code(204);
      return null;
    },
  );
}
