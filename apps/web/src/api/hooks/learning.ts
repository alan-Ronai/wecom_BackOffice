/**
 * Wave 5 (V4a) — the agent's side of learning: my assignments, the reader/player payload,
 * acknowledgements and quiz attempts, and the per-document refresh state.
 *
 * The `/learning/*` routes land with V2, in parallel with this lane, so they are not in
 * `docs/api/openapi.json` yet and `api.GET('/learning/my')` cannot compile. Until V6 swaps the
 * transport (each call site is marked `V6: api.*`), `learningRequest` is the same shape as the
 * generated client — same base, same credentials, same `ApiError` envelope — and every answer is
 * still parsed with `checked` against the shared zod contract.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import {
  AttemptResultSchema,
  DocumentLearningSchema,
  MyLearningResponseSchema,
  PlayerItemSchema,
  StartAttemptResponseSchema,
  type AttemptAnswersSchema,
} from '@wecom/shared';
import { API_BASE } from '../client.js';
import { keys } from '../keys.js';
import { checked } from '../stage45.js';
import { ApiError } from '../unwrap.js';

export type AttemptAnswers = z.input<typeof AttemptAnswersSchema>;

/** Temporary transport (see header). Mirrors `openapi-fetch`'s `{ data, error, response }`. */
async function learningRequest(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<{ data?: unknown; error?: unknown; response: Response }> {
  const response = await globalThis.fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return { data: undefined, response };
  const json = (await response.json().catch(() => undefined)) as unknown;
  if (!response.ok) {
    const env = (json ?? {}) as { code?: string; message?: string; details?: unknown };
    throw new ApiError(
      response.status,
      env.code ?? 'HTTP_' + response.status,
      env.message ?? 'השרת החזיר שגיאה',
      env.details,
    );
  }
  return { data: json, response };
}

/** Every learning key starts with `'learning'`, so one prefix drops the lot. */
const ALL = { queryKey: ['learning'] as const };

export const useMyLearning = (enabled = true) =>
  useQuery({
    queryKey: keys.learning.my,
    enabled,
    // V6: api.GET('/learning/my')
    queryFn: async () => checked(MyLearningResponseSchema, await learningRequest('GET', '/learning/my')),
  });

export const usePlayerItem = (assignmentId: string | undefined) =>
  useQuery({
    queryKey: keys.learning.player(assignmentId ?? ''),
    enabled: !!assignmentId,
    // V6: api.GET('/learning/my/{assignmentId}')
    queryFn: async () =>
      checked(PlayerItemSchema, await learningRequest('GET', `/learning/my/${assignmentId}`)),
  });

export const useAcknowledge = (assignmentId: string) => {
  const qc = useQueryClient();
  return useMutation({
    // V6: api.POST('/learning/my/{assignmentId}/acknowledge')
    mutationFn: async () => {
      await learningRequest('POST', `/learning/my/${assignmentId}/acknowledge`);
    },
    onSuccess: () => void qc.invalidateQueries(ALL),
  });
};

export const useStartAttempt = (assignmentId: string) =>
  useMutation({
    // V6: api.POST('/learning/my/{assignmentId}/attempts')
    mutationFn: async () =>
      checked(
        StartAttemptResponseSchema,
        await learningRequest('POST', `/learning/my/${assignmentId}/attempts`),
      ).attemptId,
  });

export const useSubmitAttempt = () => {
  const qc = useQueryClient();
  return useMutation({
    // V6: api.PUT('/learning/attempts/{id}')
    mutationFn: async ({ attemptId, answers }: { attemptId: string; answers: AttemptAnswers }) =>
      checked(
        AttemptResultSchema,
        await learningRequest('PUT', `/learning/attempts/${attemptId}`, answers),
      ),
    onSuccess: () => void qc.invalidateQueries(ALL),
  });
};

/** `enabled` lets the article skip the call for users without `learning.read`. */
export const useDocumentLearning = (documentId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: keys.learning.doc(documentId ?? ''),
    enabled: enabled && !!documentId,
    // V6: api.GET('/documents/{id}/learning')
    queryFn: async () =>
      checked(DocumentLearningSchema, await learningRequest('GET', `/documents/${documentId}/learning`)),
  });
