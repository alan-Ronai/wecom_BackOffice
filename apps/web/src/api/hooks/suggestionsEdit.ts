/**
 * Structured (row-level) suggestion editing and partial apply — X3's routes (§4.2).
 *
 * The stage-1 `PUT /suggestions/:id/edit` (whole `editedPayload`) stays where it is in
 * `hooks/pipeline.ts`; this is the field-level editor of spec §1.8, which sends row verdicts and
 * applies a subset. Every call is marked `// X6: api.*` for the swap to the generated client.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SuggestionAnalyticsSchema,
  SuggestionSchema,
  type StructuredEdit,
  type Suggestion,
} from '@wecom/shared';
import { keys } from '../keys.js';
import { w6 } from '../wave6.js';

export const useSuggestion = (id: string | null) =>
  useQuery({
    queryKey: keys.suggestion(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<Suggestion> => w6(SuggestionSchema, 'GET', `/suggestions/${id!}`), // X6: api.GET('/suggestions/{id}')
  });

const useSugMutation = <V, R>(fn: (v: V) => Promise<R>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['suggestions'] });
      void qc.invalidateQueries({ queryKey: keys.sources });
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
};

export const useStructuredEdit = () =>
  useSugMutation(
    async (v: { id: string; edit: StructuredEdit }): Promise<Suggestion> =>
      w6(SuggestionSchema, 'PATCH', `/suggestions/${v.id}/edit`, { body: v.edit }), // X6: api.PATCH('/suggestions/{id}/edit')
  );

/** `parts` omitted (`{}`) is the full accept — the contract's own spelling (§4.2). */
export const useAcceptSuggestionParts = () =>
  useSugMutation(
    async (v: { id: string; parts?: string[] }): Promise<Suggestion> =>
      w6(SuggestionSchema, 'POST', `/suggestions/${v.id}/accept`, {
        body: v.parts ? { parts: v.parts } : {},
      }), // X6: api.POST('/suggestions/{id}/accept')
  );

export const useSuggestionAnalytics = (
  q: { from?: string; to?: string; sourceId?: string; type?: string },
  enabled = true,
) =>
  useQuery({
    queryKey: keys.suggestionAnalytics(q),
    enabled,
    queryFn: async () => w6(SuggestionAnalyticsSchema, 'GET', '/suggestions/analytics', { query: q }), // X6: api.GET('/suggestions/analytics')
  });
