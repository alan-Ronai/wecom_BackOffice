/**
 * Usage analytics (W5) — `GET /analytics/usage` and `GET /analytics/search-log`.
 *
 * Both routes are published now, so they go through the generated client like the rest of the
 * app, and the answers are parsed with `checked` against the `@wecom/shared` schemas the routes
 * are built to: the generated types describe what the contract *says*, `checked` is what notices
 * a fixture or a backend that disagrees with it.
 */
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import {
  SearchLogResponseSchema,
  UsageAnalyticsSchema,
  type SearchLogRowSchema,
  type UsageAnalytics,
} from '@wecom/shared';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { checked } from '../stage45.js';
import type { Paginated } from '../types.js';

export type SearchLogRow = z.infer<typeof SearchLogRowSchema>;

/** Only the filters that are set — an empty string is "no filter", not a value. */
const clean = <T extends object>(q: T): T =>
  Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) as T;

export interface UsageQuery {
  from?: string;
  to?: string;
  world?: string;
  limit?: number;
}

export const useUsageAnalytics = (q: UsageQuery) =>
  useQuery<UsageAnalytics>({
    queryKey: keys.analytics.usage(q),
    queryFn: async () =>
      checked(UsageAnalyticsSchema, await api.GET('/analytics/usage', { params: { query: clean(q) } })),
    // The server caches the same answer for 60 s, so a refetch inside that window buys nothing.
    staleTime: 60_000,
    retry: false,
  });

export interface SearchLogQuery {
  zeroOnly?: boolean;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export const useSearchLog = (q: SearchLogQuery) =>
  useQuery<Paginated<SearchLogRow>>({
    queryKey: keys.analytics.searchLog(q),
    queryFn: async () =>
      checked(
        SearchLogResponseSchema,
        await api.GET('/analytics/search-log', { params: { query: clean(q) } }),
      ),
    retry: false,
  });
