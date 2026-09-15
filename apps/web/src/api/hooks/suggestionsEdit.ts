/**
 * Structured (row-level) suggestion editing and partial apply — X3's routes (§4.2).
 *
 * The stage-1 `PUT /suggestions/:id/edit` (whole `editedPayload`) stays where it is in
 * `hooks/pipeline.ts`; this is the field-level editor of spec §1.8, which sends row verdicts and
 * applies a subset. Every call goes through the generated client and is parsed with `checked`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SuggestionAnalyticsSchema,
  SuggestionSchema,
  type SuggestionAnalyticsQuery,
  type StructuredEdit,
  type Suggestion,
} from '@wecom/shared';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { checked } from '../stage45.js';

export const useSuggestion = (id: string | null) =>
  useQuery({
    queryKey: keys.suggestion(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<Suggestion> =>
      checked(SuggestionSchema, await api.GET('/suggestions/{id}', { params: { path: { id: id! } } })),
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

/**
 * X3 kept the existing `PUT /suggestions/:id/edit` and widened its body to
 * `{ editedPayload } | { structuredEdit }` rather than adding a second verb, so the row-level
 * editor posts the second variant to the same route the whole-payload editor already uses.
 * (X6 corrected `CONTRACTS-wave6.md`, which had written this row as `PATCH`.)
 */
export const useStructuredEdit = () =>
  useSugMutation(async (v: { id: string; edit: StructuredEdit }): Promise<Suggestion> =>
    checked(
      SuggestionSchema,
      await api.PUT('/suggestions/{id}/edit', {
        params: { path: { id: v.id } },
        body: { structuredEdit: v.edit },
      }),
    ),
  );

/** `parts` omitted (`{}`) is the full accept — the contract's own spelling (§4.2). */
export const useAcceptSuggestionParts = () =>
  useSugMutation(async (v: { id: string; parts?: string[] }): Promise<Suggestion> =>
    checked(
      SuggestionSchema,
      await api.POST('/suggestions/{id}/accept', {
        params: { path: { id: v.id } },
        body: v.parts ? { parts: v.parts } : {},
      }),
    ),
  );

export const useSuggestionAnalytics = (q: SuggestionAnalyticsQuery, enabled = true) =>
  useQuery({
    queryKey: keys.suggestionAnalytics(q),
    enabled,
    queryFn: async () =>
      checked(SuggestionAnalyticsSchema, await api.GET('/suggestions/analytics', { params: { query: q } })),
  });
