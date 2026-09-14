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
      requireUser(req);
      const query = req.query as UsageQuery;
      // Cache key = the raw query string so `?limit=5` and `?limit=6` are distinct entries.
      const key = req.url.split('?')[1] ?? '';
      const hit = cache.get(key);
      if (hit) return hit;
      const caps = await probeCapabilities(app.db);
      const result = await usageAnalytics(app.db, query, caps);
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
