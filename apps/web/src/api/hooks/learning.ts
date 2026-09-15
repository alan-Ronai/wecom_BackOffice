/**
 * Wave 5 (V4a) — the agent's side of learning: my assignments, the reader/player payload,
 * acknowledgements and quiz attempts, the per-document refresh state, and (V6) the change
 * preview the publish dialog pre-ticks from.
 *
 * V4a shipped behind a hand-rolled `learningRequest` because V2's routes were not in
 * `docs/api/openapi.json` yet. They are now, so every call goes through the generated client and
 * every answer is still parsed with `checked` against the shared zod contract — the types say what
 * the contract promises, the parse is what notices when an answer disagrees.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import {
  AssignmentSchema,
  AttemptResultSchema,
  ChangePreviewSchema,
  DocumentLearningSchema,
  MyLearningResponseSchema,
  PlayerItemSchema,
  StartAttemptResponseSchema,
  type AttemptAnswersSchema,
} from '@wecom/shared';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { checked } from '../stage45.js';

export type AttemptAnswers = z.input<typeof AttemptAnswersSchema>;

/** Every learning key starts with `'learning'`, so one prefix drops the lot. */
const ALL = { queryKey: ['learning'] as const };

export const useMyLearning = (enabled = true) =>
  useQuery({
    queryKey: keys.learning.my,
    enabled,
    queryFn: async () => checked(MyLearningResponseSchema, await api.GET('/learning/my')),
  });

export const usePlayerItem = (assignmentId: string | undefined) =>
  useQuery({
    queryKey: keys.learning.player(assignmentId ?? ''),
    enabled: !!assignmentId,
    queryFn: async () =>
      checked(
        PlayerItemSchema,
        await api.GET('/learning/my/{assignmentId}', {
          params: { path: { assignmentId: assignmentId! } },
        }),
      ),
  });

export const useAcknowledge = (assignmentId: string) => {
  const qc = useQueryClient();
  return useMutation({
    // The route answers the updated assignment; `checked` is still what turns a non-2xx into the
    // typed `ApiError` the caller expects, and the parsed row itself is not needed here.
    mutationFn: async () => {
      checked(
        AssignmentSchema,
        await api.POST('/learning/my/{assignmentId}/acknowledge', {
          params: { path: { assignmentId } },
        }),
      );
    },
    onSuccess: () => void qc.invalidateQueries(ALL),
  });
};

export const useStartAttempt = (assignmentId: string) =>
  useMutation({
    mutationFn: async () =>
      checked(
        StartAttemptResponseSchema,
        await api.POST('/learning/my/{assignmentId}/attempts', {
          params: { path: { assignmentId } },
        }),
      ).attemptId,
  });

export const useSubmitAttempt = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ attemptId, answers }: { attemptId: string; answers: AttemptAnswers }) =>
      checked(
        AttemptResultSchema,
        await api.PUT('/learning/attempts/{id}', {
          params: { path: { id: attemptId } },
          body: answers as never,
        }),
      ),
    onSuccess: () => void qc.invalidateQueries(ALL),
  });
};

/** `enabled` lets the article skip the call for users without `learning.read`. */
export const useDocumentLearning = (documentId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: keys.learning.doc(documentId ?? ''),
    enabled: enabled && !!documentId,
    queryFn: async () =>
      checked(
        DocumentLearningSchema,
        await api.GET('/documents/{id}/learning', { params: { path: { id: documentId! } } }),
      ),
  });

/**
 * V6: what a publish would flag, so the publish dialog can pre-tick "שינוי מהותי" with the
 * detector's own verdict. `docs.publish` only — the editor asks this about a document it is
 * about to publish, so it is fetched from the publish dialog and nowhere else.
 */
export const useChangePreview = (documentId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: keys.learning.changePreview(documentId ?? ''),
    enabled: enabled && !!documentId,
    queryFn: async () =>
      checked(
        ChangePreviewSchema,
        await api.GET('/documents/{id}/change-preview', { params: { path: { id: documentId! } } }),
      ),
  });
