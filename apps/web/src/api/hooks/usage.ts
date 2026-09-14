/**
 * Usage analytics (W5) — `GET /analytics/usage` and `GET /analytics/search-log`.
 *
 * Transport note: every other hook in this app goes through the generated client (`api`, typed by
 * `schema.d.ts` from `docs/api/openapi.json`). These two routes are implemented in the W5 **api**
 * sub-lane, which merges separately, so they are not in the published contract yet and
 * `pnpm generate:client` cannot type them. Rather than cast the mismatch away, they go through the
 * same small `fetch` bridge `src/api/stage5.ts` uses for its still-unpublished routes, and are
 * **validated at runtime** against the `@wecom/shared` schemas the routes are built to
 * (`checked`) — so a drifting fixture or a backend that answers a different shape surfaces as a
 * typed `ApiError` at the call site instead of `undefined` three components away.
 *
 * Both lines disappear the moment the routes land in `docs/api/openapi.json`: swap `getJson` for
 * `unwrap(await api.GET('/analytics/usage', { params: { query: q } }))` and delete the bridge.
 */
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import {
  SearchLogResponseSchema,
  UsageAnalyticsSchema,
  type SearchLogRowSchema,
  type UsageAnalytics,
} from '@wecom/shared';
import { API_BASE } from '../client.js';
import { keys } from '../keys.js';
import { checked } from '../stage45.js';
import type { Paginated } from '../types.js';

export type SearchLogRow = z.infer<typeof SearchLogRowSchema>;

async function getJson<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  path: string,
  query: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') qs.set(k, String(v));
  const search = qs.toString();
  const response = await globalThis.fetch(`${API_BASE}${path}${search ? `?${search}` : ''}`, {
    credentials: 'include',
  });
  const body: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  return checked(schema, response.ok ? { data: body, response } : { error: body ?? {}, response });
}

export interface UsageQuery {
  from?: string;
  to?: string;
  world?: string;
  limit?: number;
}

export const useUsageAnalytics = (q: UsageQuery) =>
  useQuery<UsageAnalytics>({
    queryKey: keys.analytics.usage(q),
    queryFn: () => getJson(UsageAnalyticsSchema, '/analytics/usage', { ...q }),
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
    queryFn: () => getJson(SearchLogResponseSchema, '/analytics/search-log', { ...q }),
    retry: false,
  });
