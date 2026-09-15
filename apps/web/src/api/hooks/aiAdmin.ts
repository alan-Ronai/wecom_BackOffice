/**
 * The `/admin/ai` data layer: settings and their version history, the model slot test, the two
 * background jobs, the eval runs, and the transcript browser (list, detail, delete, export).
 *
 * Every call goes through the wave 6 bridge (`api/wave6.ts`) while the routes are outside
 * `openapi.json`; the lines marked `// X6: api.*` are the ones X6 rewrites onto the generated
 * client before deleting the bridge. The schemas are the same either way — they are the contract.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AiSettingsSchema,
  AiSettingVersionsResponseSchema,
  ConversationDetailSchema,
  ConversationsResponseSchema,
  EvalRunsResponseSchema,
  JobQueuedSchema,
  ModelTestResultSchema,
  type AiSettingsPut,
  type ModelTestBody,
} from '@wecom/shared';
import { keys } from '../keys.js';
import { w6, w6Text, w6Void } from '../wave6.js';
import { download } from '../../lib/format.js';
import { invalidateAi } from '../invalidateAi.js';

export const useAiSettings = (enabled = true) =>
  useQuery({
    queryKey: keys.ai.settings,
    enabled,
    staleTime: 30_000,
    queryFn: () => w6(AiSettingsSchema, 'GET', '/admin/ai/settings'), // X6: api.GET
  });

export const usePutAiSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: AiSettingsPut) =>
      w6(AiSettingsSchema, 'PUT', '/admin/ai/settings', { body: patch }), // X6: api.PUT
    onSuccess: (s) => {
      // The response is the merged settings, version bumps included: seed the cache with it so the
      // "גרסה N" chip is right on the render that follows the save, not one refetch later.
      qc.setQueryData(keys.ai.settings, s);
      void qc.invalidateQueries({ queryKey: keys.ai.versions });
    },
  });
};

export const useAiSettingVersions = (enabled = true) =>
  useQuery({
    queryKey: keys.ai.versions,
    enabled,
    queryFn: async () =>
      (await w6(AiSettingVersionsResponseSchema, 'GET', '/admin/ai/settings/versions')).items, // X6: api.GET
  });

export const useTestModel = () =>
  useMutation({
    mutationFn: (body: ModelTestBody) =>
      w6(ModelTestResultSchema, 'POST', '/admin/ai/models/test', { body }), // X6: api.POST
  });

export const useRunEval = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => w6(JobQueuedSchema, 'POST', '/admin/ai/eval'), // X6: api.POST
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.ai.evalRuns }),
  });
};

export const useReindex = () =>
  useMutation({ mutationFn: () => w6(JobQueuedSchema, 'POST', '/admin/ai/reindex') }); // X6: api.POST

export const useEvalRuns = (enabled = true) =>
  useQuery({
    queryKey: keys.ai.evalRuns,
    enabled,
    // A run takes minutes; the table is the only place its progress shows.
    refetchInterval: 30_000,
    queryFn: async () => (await w6(EvalRunsResponseSchema, 'GET', '/admin/ai/eval/runs')).items, // X6: api.GET
  });

/** The admin transcript filters (`ConversationsQuerySchema`'s admin subset, plus the UI's own). */
export interface AdminConversationsQuery {
  userId?: string;
  documentId?: string;
  from?: string;
  to?: string;
  /** UI-side filter over the messages' ratings; not part of the server query yet. */
  feedback?: 'up' | 'down';
  page?: number;
}

export const useAdminConversations = (q: AdminConversationsQuery, enabled = true) =>
  useQuery({
    queryKey: keys.ai.conversations({ admin: true, ...q }),
    enabled,
    queryFn: () =>
      w6(ConversationsResponseSchema, 'GET', '/admin/ai/conversations', { query: { ...q } }), // X6: api.GET
  });

export const useAdminConversation = (id: string | null, enabled = true) =>
  useQuery({
    queryKey: keys.ai.conversation(id ?? ''),
    enabled: enabled && !!id,
    queryFn: () => w6(ConversationDetailSchema, 'GET', `/ai/conversations/${id ?? ''}`), // X6: api.GET
  });

export const useDeleteConversation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => w6Void('DELETE', `/admin/ai/conversations/${id}`), // X6: api.DELETE
    // Every filter combination is its own cache entry, so invalidate the prefix rather than the
    // one key the screen happens to be holding.
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ai', 'conversations'] }),
  });
};

/**
 * JSONL export: fetched as text, then handed to the browser through `download()`'s Blob URL.
 *
 * Not an `<a href>` to the route and not a data URL — the CSP has no `unsafe-inline`, and a plain
 * link would drop the credentials the same-origin fetch carries.
 */
export async function exportConversations(q: AdminConversationsQuery = {}): Promise<void> {
  const text = await w6Text('/admin/ai/conversations/export.jsonl', { query: { ...q } }); // X6: api.GET
  download(`ai-conversations-${new Date().toISOString().slice(0, 10)}.jsonl`, text, 'application/x-ndjson');
}

export { invalidateAi };
