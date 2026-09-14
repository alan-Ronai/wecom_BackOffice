/**
 * Wave 4 (W3) feedback — agent reports on knowledge items, the editor queue and its analytics.
 *
 * The routes are typed from the **zod contract** in `@wecom/shared` (`schemas/wave4.ts`) through
 * `stageJson`, exactly like the stage 4–5 wrappers in `src/api/stage45.ts`: sub-lane W3-api is
 * adding `/feedback*` concurrently, so they are not in `docs/api/openapi.json` yet and
 * `pnpm generate:client` cannot type them. Every response is parsed against the contract, so a
 * drifting msw fixture or a backend answering a different shape fails at the call site instead of
 * rendering `undefined`. When the paths appear in `openapi.json`, each wrapper becomes a plain
 * `api.GET(...)` — the migration is per-route and mechanical.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import {
  DocumentFeedbackResponseSchema,
  FeedbackAnalyticsSchema,
  FeedbackDetailSchema,
  FeedbackListResponseSchema,
  FeedbackRowSchema,
  FeedbackSchema,
  type CreateFeedbackBodySchema,
  type FeedbackAnalyticsQuerySchema,
  type FeedbackPatchBodySchema,
  type FeedbackQuerySchema,
  type FeedbackResolveBodySchema,
} from '@wecom/shared';
import { keys } from '../keys.js';
import { stageJson } from '../stage45.js';

export type FeedbackQuery = Partial<z.input<typeof FeedbackQuerySchema>>;
export type FeedbackAnalyticsQuery = z.input<typeof FeedbackAnalyticsQuerySchema>;
type CreateBody = z.input<typeof CreateFeedbackBodySchema>;
type PatchBody = z.input<typeof FeedbackPatchBodySchema>;
type ResolveBody = z.input<typeof FeedbackResolveBodySchema>;

/** Every feedback query key starts with `'feedback'`, so one prefix invalidates the lot. */
const ALL = { queryKey: ['feedback'] as const };

/** Only send the filters that are set — an empty string is "no filter", not a value. */
const query = (q: Record<string, unknown>): Record<string, string | number | boolean | undefined> =>
  Object.fromEntries(
    Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as Record<string, string | number | boolean | undefined>;

export const useCreateFeedback = (documentId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBody) =>
      stageJson(FeedbackSchema, `/documents/${documentId}/feedback`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries(ALL);
      void qc.invalidateQueries({ queryKey: keys.docFeedback(documentId) });
    },
  });
};

export const useFeedbackList = (q: FeedbackQuery = {}) =>
  useQuery({
    queryKey: keys.feedback(q),
    queryFn: () => stageJson(FeedbackListResponseSchema, '/feedback', { query: query(q) }),
    placeholderData: keepPreviousData,
  });

export const useFeedbackDetail = (id: string | undefined) =>
  useQuery({
    queryKey: keys.feedbackItem(id ?? ''),
    enabled: !!id,
    queryFn: () => stageJson(FeedbackDetailSchema, `/feedback/${id!}`),
  });

const useFeedbackMutation = <V, R>(fn: (v: V) => Promise<R>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries(ALL);
      void qc.invalidateQueries({ queryKey: ['docFeedback'] });
    },
  });
};

export const usePatchFeedback = () =>
  useFeedbackMutation(({ id, ...body }: { id: string } & PatchBody) =>
    stageJson(FeedbackRowSchema, `/feedback/${id}`, { method: 'PATCH', body }),
  );

export const useResolveFeedback = () =>
  useFeedbackMutation(({ id, ...body }: { id: string } & ResolveBody) =>
    stageJson(FeedbackRowSchema, `/feedback/${id}/resolve`, { method: 'POST', body }),
  );

export const useFeedbackAnalytics = (q: FeedbackAnalyticsQuery = {}) =>
  useQuery({
    queryKey: keys.feedbackAnalytics(q),
    queryFn: () => stageJson(FeedbackAnalyticsSchema, '/feedback/analytics', { query: query(q) }),
    staleTime: 60_000,
  });

/** Open reports on one item — the publish dialog's checkbox list (needs docs.edit). */
export const useDocumentFeedback = (documentId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: keys.docFeedback(documentId ?? ''),
    enabled: !!documentId && enabled,
    queryFn: () =>
      stageJson(DocumentFeedbackResponseSchema, `/documents/${documentId!}/feedback`).then((r) => r.items),
  });
