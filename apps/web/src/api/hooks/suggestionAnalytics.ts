import { useQuery } from '@tanstack/react-query';
import { SuggestionAnalyticsSchema, type SuggestionAnalyticsQuery } from '@wecom/shared';
import { keys } from '../keys.js';
import { w6 } from '../wave6.js';

/**
 * Accept / edit / reject rates for the suggestion pipeline (spec §1.9).
 *
 * `enabled` is the caller's `analytics.read` check: without it the route is a guaranteed 403, and
 * asking anyway costs a round trip and a console error on a tab that is about to render the
 * permission notice instead.
 */
export const useSuggestionAnalytics = (q: SuggestionAnalyticsQuery, enabled = true) =>
  useQuery({
    queryKey: keys.suggestionAnalytics(q),
    enabled,
    staleTime: 60_000,
    queryFn: () =>
      w6(SuggestionAnalyticsSchema, 'GET', '/suggestions/analytics', {
        query: { ...q } as Record<string, string | undefined>,
      }), // X6: api.GET
  });
