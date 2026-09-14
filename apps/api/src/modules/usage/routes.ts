import type { FastifyInstance } from 'fastify';
import {
  SearchLogQuerySchema,
  SearchLogResponseSchema,
  UsageAnalyticsQuerySchema,
  UsageAnalyticsSchema,
  type UsageAnalytics,
} from '@wecom/shared';
import { requireUser } from '../../lib/user.js';
import { TtlCache } from './cache.js';
import {
  listSearchLog,
  probeCapabilities,
  usageAnalytics,
  type SearchLogQuery,
  type UsageQuery,
} from './repo.js';

const CACHE_MS = 60_000;

export default async function routes(app: FastifyInstance) {
  const cache = new TtlCache<UsageAnalytics>(CACHE_MS);

  app.get(
    '/analytics/usage',
    {
      config: { requires: ['analytics.read'] },
      schema: {
        tags: ['analytics'],
        querystring: UsageAnalyticsQuerySchema,
        response: { 200: UsageAnalyticsSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const query = req.query as UsageQuery;
      /**
       * Keyed on the *parsed* query, so `?limit=5&world=a` and `?world=a&limit=5` are one
       * entry, and on the caller's scope set, so scoping the data cannot cross-serve one
       * editor's snapshot to another (B-I8, B-M8).
       */
      const key = JSON.stringify([
        Object.entries(query)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b)),
        user.worldScopes ? [...user.worldScopes].sort() : null,
      ]);
      const hit = cache.get(key);
      if (hit) return hit;
      const caps = await probeCapabilities(app.db);
      const result = await usageAnalytics(app.db, query, caps, user.worldScopes);
      cache.set(key, result);
      return result;
    },
  );

  app.get(
    '/analytics/search-log',
    {
      config: { requires: ['analytics.read'] },
      schema: {
        tags: ['analytics'],
        querystring: SearchLogQuerySchema,
        response: { 200: SearchLogResponseSchema },
      },
    },
    async (req) => {
      requireUser(req);
      return listSearchLog(app.db, req.query as SearchLogQuery);
    },
  );
}
