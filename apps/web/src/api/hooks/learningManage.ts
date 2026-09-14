/**
 * Wave 5 (V4b) — the editor's half of learning: items, builders, publishing, audiences,
 * assignment and completion.
 *
 * Every call goes through the temporary `w5` bridge (`src/api/wave5.ts`) because the V1–V3 routes
 * are not in the published contract while this lane runs, and every response is parsed with
 * `checked` against `@wecom/shared`. V6 swaps each `w5(...)` for the generated `api.*` call.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AssignResultSchema,
  AudienceSchema,
  CompletionResponseSchema,
  DocumentLearningSchema,
  GenerateQuestionsResponseSchema,
  LearningDashboardSchema,
  LearningItemSchema,
  LearningItemsResponseSchema,
  LearningVersionsResponseSchema,
  type AssignBodySchema,
  type AudienceCreateSchema,
  type GenerateQuestionsBodySchema,
  type LearningItemCreateSchema,
  type LearningItemPatchSchema,
  type LearningItemsQuerySchema,
  type LearningPublishBodySchema,
  type PutEntriesBodySchema,
  type PutQuestionsBodySchema,
} from '@wecom/shared';
import { keys } from '../keys.js';
import { invalidateLearning } from '../invalidateLearning.js';
import { w5, w5Void } from '../wave5.js';

export type LearningItemsQuery = Partial<z.input<typeof LearningItemsQuerySchema>>;
type QueryParams = Record<string, string | number | undefined>;

/**
 * `POST /learning/items/:id/publish` answers `{ item, version }` — the V1 ruling, which corrects
 * what `CONTRACTS-wave5.md` said (a bare `LearningVersion`). V1 appends
 * `LearningPublishResponseSchema` to `@wecom/shared`; until that lands on this branch the shape is
 * composed here from the shared item schema rather than re-declared, and V6 swaps the import in.
 */
const PublishResponseSchema = z.object({
  item: LearningItemSchema,
  version: z.number().int().nonnegative(),
});

export const useLearningItems = (q: LearningItemsQuery = {}, enabled = true) =>
  useQuery({
    queryKey: keys.learning.items(q),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () => w5(LearningItemsResponseSchema, 'GET', '/learning/items', { query: q as QueryParams }),
  });

export const useLearningItem = (id: string | undefined) =>
  useQuery({
    queryKey: keys.learning.item(id ?? ''),
    enabled: !!id,
    queryFn: () => w5(LearningItemSchema, 'GET', `/learning/items/${id}`),
  });

export const useCreateLearningItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: z.input<typeof LearningItemCreateSchema>) =>
      w5(LearningItemSchema, 'POST', '/learning/items', { body }),
    onSuccess: () => invalidateLearning(qc),
  });
};

export const usePatchLearningItem = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: z.input<typeof LearningItemPatchSchema>) =>
      w5(LearningItemSchema, 'PATCH', `/learning/items/${id}`, { body }),
    onSuccess: (item) => {
      qc.setQueryData(keys.learning.item(id), item);
      invalidateLearning(qc, id);
    },
  });
};

export const useDeleteLearningItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => w5Void('DELETE', `/learning/items/${id}`),
    onSuccess: (_v, id) => invalidateLearning(qc, id),
  });
};

export const usePutEntries = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: z.input<typeof PutEntriesBodySchema>) =>
      w5(LearningItemSchema, 'PUT', `/learning/items/${id}/entries`, { body }),
    onSuccess: (item) => {
      qc.setQueryData(keys.learning.item(id), item);
      invalidateLearning(qc, id);
    },
  });
};

export const usePutQuestions = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: z.input<typeof PutQuestionsBodySchema>) =>
      w5(LearningItemSchema, 'PUT', `/learning/items/${id}/questions`, { body }),
    onSuccess: (item) => {
      qc.setQueryData(keys.learning.item(id), item);
      invalidateLearning(qc, id);
    },
  });
};

/** Draft questions only — nothing is saved until `usePutQuestions` (spec §4). */
export const useGenerateQuestions = (id: string) =>
  useMutation({
    mutationFn: (body: z.input<typeof GenerateQuestionsBodySchema>) =>
      w5(GenerateQuestionsResponseSchema, 'POST', `/learning/items/${id}/generate`, { body }),
  });

export const usePublishLearningItem = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: z.input<typeof LearningPublishBodySchema>) =>
      w5(PublishResponseSchema, 'POST', `/learning/items/${id}/publish`, { body }),
    onSuccess: (res) => {
      qc.setQueryData(keys.learning.item(id), res.item);
      invalidateLearning(qc, id);
    },
  });
};

export const useLearningVersions = (id: string | undefined) =>
  useQuery({
    queryKey: keys.learning.versions(id ?? ''),
    enabled: !!id,
    queryFn: async () =>
      (await w5(LearningVersionsResponseSchema, 'GET', `/learning/items/${id}/versions`)).items,
  });

export const useCreateAudience = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: z.input<typeof AudienceCreateSchema>) =>
      w5(AudienceSchema, 'POST', `/learning/items/${id}/audiences`, { body }),
    onSuccess: () => invalidateLearning(qc, id),
  });
};

export const useDeleteAudience = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (audienceId: string) => w5Void('DELETE', `/learning/audiences/${audienceId}`),
    onSuccess: () => invalidateLearning(qc),
  });
};

export const useAssignUsers = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: z.input<typeof AssignBodySchema>) =>
      w5(AssignResultSchema, 'POST', `/learning/items/${id}/assign`, { body }),
    onSuccess: () => invalidateLearning(qc, id),
  });
};

export const useCompletion = (id: string | undefined, enabled = true) =>
  useQuery({
    queryKey: keys.learning.completion(id ?? ''),
    enabled: enabled && !!id,
    queryFn: () => w5(CompletionResponseSchema, 'GET', `/learning/items/${id}/completion`),
  });

export const useLearningDashboard = (world?: string, enabled = true) =>
  useQuery({
    queryKey: keys.learning.dashboard(world),
    enabled,
    staleTime: 60_000,
    queryFn: () => w5(LearningDashboardSchema, 'GET', '/learning/dashboard', { query: { world } }),
  });

/**
 * `useDocumentLearning` lived here too. V6 keeps exactly one — V4a's in `hooks/learning.ts`, keyed
 * `keys.learning.doc(id)` — so the article badge, the article panel and the manager list all read
 * the same cache entry and one invalidation moves all three.
 */
export { useDocumentLearning } from './learning.js';
