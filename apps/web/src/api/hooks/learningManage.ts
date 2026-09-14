/**
 * Wave 5 (V4b) — the editor's half of learning: items, builders, publishing, audiences,
 * assignment and completion.
 *
 * V4b shipped behind the temporary `w5` bridge because the V1–V3 routes were not in the published
 * contract while the lane ran. V6 published them, so every call goes through the generated client
 * and every response is still parsed with `checked` against `@wecom/shared`.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AssignResultSchema,
  AudienceOptionsSchema,
  AudienceSchema,
  CompletionResponseSchema,
  GenerateQuestionsResponseSchema,
  LearningDashboardSchema,
  LearningItemSchema,
  LearningItemsResponseSchema,
  LearningPublishResponseSchema,
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
import { api } from '../client.js';
import { keys } from '../keys.js';
import { checked } from '../stage45.js';
import { unwrap } from '../unwrap.js';
import { invalidateLearning } from '../invalidateLearning.js';

export type LearningItemsQuery = Partial<z.input<typeof LearningItemsQuerySchema>>;

export const useLearningItems = (q: LearningItemsQuery = {}, enabled = true) =>
  useQuery({
    queryKey: keys.learning.items(q),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () =>
      checked(LearningItemsResponseSchema, await api.GET('/learning/items', { params: { query: q } })),
  });

export const useLearningItem = (id: string | undefined) =>
  useQuery({
    queryKey: keys.learning.item(id ?? ''),
    enabled: !!id,
    queryFn: async () =>
      checked(LearningItemSchema, await api.GET('/learning/items/{id}', { params: { path: { id: id! } } })),
  });

export const useCreateLearningItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: z.input<typeof LearningItemCreateSchema>) =>
      checked(LearningItemSchema, await api.POST('/learning/items', { body: body as never })),
    onSuccess: () => invalidateLearning(qc),
  });
};

export const usePatchLearningItem = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: z.input<typeof LearningItemPatchSchema>) =>
      checked(
        LearningItemSchema,
        await api.PATCH('/learning/items/{id}', { params: { path: { id } }, body: body as never }),
      ),
    onSuccess: (item) => {
      qc.setQueryData(keys.learning.item(id), item);
      invalidateLearning(qc, id);
    },
  });
};

export const useDeleteLearningItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await api.DELETE('/learning/items/{id}', { params: { path: { id } } }));
    },
    onSuccess: (_v, id) => invalidateLearning(qc, id),
  });
};

export const usePutEntries = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: z.input<typeof PutEntriesBodySchema>) =>
      checked(
        LearningItemSchema,
        await api.PUT('/learning/items/{id}/entries', { params: { path: { id } }, body: body as never }),
      ),
    onSuccess: (item) => {
      qc.setQueryData(keys.learning.item(id), item);
      invalidateLearning(qc, id);
    },
  });
};

export const usePutQuestions = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: z.input<typeof PutQuestionsBodySchema>) =>
      checked(
        LearningItemSchema,
        await api.PUT('/learning/items/{id}/questions', { params: { path: { id } }, body: body as never }),
      ),
    onSuccess: (item) => {
      qc.setQueryData(keys.learning.item(id), item);
      invalidateLearning(qc, id);
    },
  });
};

/** Draft questions only — nothing is saved until `usePutQuestions` (spec §4). */
export const useGenerateQuestions = (id: string) =>
  useMutation({
    mutationFn: async (body: z.input<typeof GenerateQuestionsBodySchema>) =>
      checked(
        GenerateQuestionsResponseSchema,
        await api.POST('/learning/items/{id}/generate', { params: { path: { id } }, body: body as never }),
      ),
  });

export const usePublishLearningItem = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: z.input<typeof LearningPublishBodySchema>) =>
      checked(
        LearningPublishResponseSchema,
        await api.POST('/learning/items/{id}/publish', { params: { path: { id } }, body: body as never }),
      ),
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
      checked(
        LearningVersionsResponseSchema,
        await api.GET('/learning/items/{id}/versions', { params: { path: { id: id! } } }),
      ).items,
  });

/**
 * V6: the roles and worlds an audience is built from, behind `learning.manage` alone. The dialog
 * used `GET /admin/roles`, which needs `roles.manage` — so a lead who may assign learning saw an
 * empty role list against the real API while the MSW fixture happily answered.
 */
export const useAudienceOptions = (enabled = true) =>
  useQuery({
    queryKey: keys.learning.audienceOptions,
    enabled,
    staleTime: 300_000,
    queryFn: async () => checked(AudienceOptionsSchema, await api.GET('/learning/audience-options')),
  });

export const useCreateAudience = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: z.input<typeof AudienceCreateSchema>) =>
      checked(
        AudienceSchema,
        await api.POST('/learning/items/{id}/audiences', { params: { path: { id } }, body: body as never }),
      ),
    onSuccess: () => invalidateLearning(qc, id),
  });
};

export const useDeleteAudience = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await api.DELETE('/learning/audiences/{id}', { params: { path: { id } } }));
    },
    onSuccess: () => invalidateLearning(qc),
  });
};

export const useAssignUsers = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: z.input<typeof AssignBodySchema>) =>
      checked(
        AssignResultSchema,
        await api.POST('/learning/items/{id}/assign', { params: { path: { id } }, body: body as never }),
      ),
    onSuccess: () => invalidateLearning(qc, id),
  });
};

export const useCompletion = (id: string | undefined, enabled = true) =>
  useQuery({
    queryKey: keys.learning.completion(id ?? ''),
    enabled: enabled && !!id,
    queryFn: async () =>
      checked(
        CompletionResponseSchema,
        await api.GET('/learning/items/{id}/completion', { params: { path: { id: id! } } }),
      ),
  });

export const useLearningDashboard = (world?: string, enabled = true) =>
  useQuery({
    queryKey: keys.learning.dashboard(world),
    enabled,
    staleTime: 60_000,
    queryFn: async () =>
      checked(
        LearningDashboardSchema,
        await api.GET('/learning/dashboard', { params: { query: { world } } }),
      ),
  });

/**
 * `useDocumentLearning` lived here too. V6 keeps exactly one — V4a's in `hooks/learning.ts`, keyed
 * `keys.learning.doc(id)` — so the article badge, the article panel and the manager list all read
 * the same cache entry and one invalidation moves all three.
 */
export { useDocumentLearning } from './learning.js';
