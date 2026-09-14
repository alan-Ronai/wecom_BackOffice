/**
 * Wave 4 (W3) feedback — agent reports on knowledge items, the editor queue and its analytics.
 *
 * The routes are published now, so every call goes through the generated client and every answer
 * is parsed with `checked` against the zod contract in `@wecom/shared` (`schemas/wave4.ts`) — the
 * types say what the contract promises, the parse is what notices when an answer disagrees.
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
import { api } from '../client.js';
import { keys } from '../keys.js';
import { checked } from '../stage45.js';

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
    mutationFn: async (body: CreateBody) =>
      checked(
        FeedbackSchema,
        await api.POST('/documents/{id}/feedback', { params: { path: { id: documentId } }, body }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries(ALL);
      void qc.invalidateQueries({ queryKey: keys.docFeedback(documentId) });
    },
  });
};

/** `enabled` is for the sidebar badge: the route needs `feedback.manage`, and asking without it
 *  is a 403 on every page load for every agent. */
export const useFeedbackList = (q: FeedbackQuery = {}, enabled = true) =>
  useQuery({
    queryKey: keys.feedback(q),
    enabled,
    queryFn: async () =>
      checked(FeedbackListResponseSchema, await api.GET('/feedback', { params: { query: query(q) } })),
    placeholderData: keepPreviousData,
  });

export const useFeedbackDetail = (id: string | undefined) =>
  useQuery({
    queryKey: keys.feedbackItem(id ?? ''),
    enabled: !!id,
    queryFn: async () =>
      checked(FeedbackDetailSchema, await api.GET('/feedback/{id}', { params: { path: { id: id! } } })),
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
  useFeedbackMutation(async ({ id, ...body }: { id: string } & PatchBody) =>
    checked(FeedbackRowSchema, await api.PATCH('/feedback/{id}', { params: { path: { id } }, body })),
  );

export const useResolveFeedback = () =>
  useFeedbackMutation(async ({ id, ...body }: { id: string } & ResolveBody) =>
    checked(FeedbackRowSchema, await api.POST('/feedback/{id}/resolve', { params: { path: { id } }, body })),
  );

export const useFeedbackAnalytics = (q: FeedbackAnalyticsQuery = {}) =>
  useQuery({
    queryKey: keys.feedbackAnalytics(q),
    queryFn: async () =>
      checked(FeedbackAnalyticsSchema, await api.GET('/feedback/analytics', { params: { query: query(q) } })),
    staleTime: 60_000,
  });

/** Open reports on one item — the publish dialog's checkbox list (needs docs.edit). */
export const useDocumentFeedback = (documentId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: keys.docFeedback(documentId ?? ''),
    enabled: !!documentId && enabled,
    queryFn: async () =>
      checked(
        DocumentFeedbackResponseSchema,
        await api.GET('/documents/{id}/feedback', { params: { path: { id: documentId! } } }),
      ).items,
  });
