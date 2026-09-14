/**
 * Wave 5 (V4b) — knowledge gaps (`GET /gaps`, dismiss, resolve, detect).
 *
 * Through the temporary `w5` bridge and parsed with `checked` against `@wecom/shared`; V6 swaps
 * the bodies for the generated client once V3 publishes the routes.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { GapDetectResultSchema, GapSchema, GapsResponseSchema, type GapsQuerySchema } from '@wecom/shared';
import { keys } from '../keys.js';
import { w5 } from '../wave5.js';

export type GapsQuery = Partial<z.input<typeof GapsQuerySchema>>;
type QueryParams = Record<string, string | number | undefined>;

/** Every gap write can move every filtered list, so they all invalidate the whole prefix. */
const ALL = { queryKey: ['gaps'] as const };

export const useGaps = (q: GapsQuery = {}, enabled = true) =>
  useQuery({
    queryKey: keys.gaps(q),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () => w5(GapsResponseSchema, 'GET', '/gaps', { query: q as QueryParams }),
  });

const useGapMutation = <V, R>(fn: (v: V) => Promise<R>) => {
  const qc = useQueryClient();
  return useMutation<R, Error, V>({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries(ALL) });
};

export const useDismissGap = () =>
  useGapMutation(({ id, reason }: { id: string; reason: string }) =>
    w5(GapSchema, 'POST', `/gaps/${id}/dismiss`, { body: { reason } }),
  );

export const useResolveGap = () =>
  useGapMutation(({ id, documentId }: { id: string; documentId: string }) =>
    w5(GapSchema, 'POST', `/gaps/${id}/resolve`, { body: { documentId } }),
  );

export const useDetectGaps = () =>
  useGapMutation<void, z.infer<typeof GapDetectResultSchema>>(() =>
    w5(GapDetectResultSchema, 'POST', '/gaps/detect', { body: {} }),
  );
