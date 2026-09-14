/**
 * Wave 5 (V4b) — knowledge gaps (`GET /gaps`, dismiss, resolve, detect).
 *
 * V4b shipped behind the temporary `w5` bridge; V6 published V3's routes, so these go through the
 * generated client and are still parsed with `checked` against `@wecom/shared`.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { GapDetectResultSchema, GapSchema, GapsResponseSchema, type GapsQuerySchema } from '@wecom/shared';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { checked } from '../stage45.js';

export type GapsQuery = Partial<z.input<typeof GapsQuerySchema>>;

/** Every gap write can move every filtered list, so they all invalidate the whole prefix. */
const ALL = { queryKey: ['gaps'] as const };

export const useGaps = (q: GapsQuery = {}, enabled = true) =>
  useQuery({
    queryKey: keys.gaps(q),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => checked(GapsResponseSchema, await api.GET('/gaps', { params: { query: q } })),
  });

const useGapMutation = <V, R>(fn: (v: V) => Promise<R>) => {
  const qc = useQueryClient();
  return useMutation<R, Error, V>({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries(ALL) });
};

export const useDismissGap = () =>
  useGapMutation(async ({ id, reason }: { id: string; reason: string }) =>
    checked(GapSchema, await api.POST('/gaps/{id}/dismiss', { params: { path: { id } }, body: { reason } })),
  );

export const useResolveGap = () =>
  useGapMutation(async ({ id, documentId }: { id: string; documentId: string }) =>
    checked(
      GapSchema,
      await api.POST('/gaps/{id}/resolve', { params: { path: { id } }, body: { documentId } }),
    ),
  );

export const useDetectGaps = () =>
  useGapMutation<void, z.infer<typeof GapDetectResultSchema>>(async () =>
    checked(GapDetectResultSchema, await api.POST('/gaps/detect', {})),
  );
