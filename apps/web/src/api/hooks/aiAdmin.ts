/**
 * The `/admin/ai` data layer: settings and their version history, the model slot test, the two
 * background jobs, the eval runs, and the transcript browser (list, detail, delete, export).
 *
 * Every call goes through the generated `openapi-fetch` client and is parsed at runtime with
 * `checked` against the `@wecom/shared` schema the route is built to. The one exception is the
 * JSONL export, which has no JSON body to parse and is read as text.
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
import { api, API_BASE } from '../client.js';
import { keys } from '../keys.js';
import { checked } from '../stage45.js';
import { ApiError, unwrap } from '../unwrap.js';
import { download } from '../../lib/format.js';
import { invalidateAi } from '../invalidateAi.js';

export const useAiSettings = (enabled = true) =>
  useQuery({
    queryKey: keys.ai.settings,
    enabled,
    staleTime: 30_000,
    queryFn: async () => checked(AiSettingsSchema, await api.GET('/admin/ai/settings')),
  });

export const usePutAiSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: AiSettingsPut) =>
      checked(AiSettingsSchema, await api.PUT('/admin/ai/settings', { body: patch })),
    onSuccess: (s) => {
      // The response is the merged settings, version bumps included: seed the cache with it so the
      // "גרסה N" chip is right on the render that follows the save, not one refetch later.
      qc.setQueryData(keys.ai.settings, s);
      void qc.invalidateQueries({ queryKey: keys.ai.versions });
      /*
       * A brief, style or limits change moves what the next suggestion means, and the acceptance
       * analytics are grouped by model and prompt version — leaving them cached would show
       * yesterday's rate under today's prompt version. `invalidateAi` is the one place that
       * knows the pair; the `setQueryData` above survives it because it is re-seeded first and
       * an invalidated-but-fresh entry refetches in the background.
       */
      invalidateAi(qc);
    },
  });
};

export const useAiSettingVersions = (enabled = true) =>
  useQuery({
    queryKey: keys.ai.versions,
    enabled,
    queryFn: async () =>
      checked(AiSettingVersionsResponseSchema, await api.GET('/admin/ai/settings/versions')).items,
  });

export const useTestModel = () =>
  useMutation({
    mutationFn: async (body: ModelTestBody) =>
      checked(ModelTestResultSchema, await api.POST('/admin/ai/models/test', { body })),
  });

export const useRunEval = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => checked(JobQueuedSchema, await api.POST('/admin/ai/eval', { body: {} })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.ai.evalRuns }),
  });
};

export const useReindex = () =>
  useMutation({
    mutationFn: async () => checked(JobQueuedSchema, await api.POST('/admin/ai/reindex', { body: {} })),
  });

export const useEvalRuns = (enabled = true) =>
  useQuery({
    queryKey: keys.ai.evalRuns,
    enabled,
    // A run takes minutes; the table is the only place its progress shows.
    refetchInterval: 30_000,
    queryFn: async () => checked(EvalRunsResponseSchema, await api.GET('/admin/ai/eval/runs')).items,
  });

/** The admin transcript filters (`ConversationsQuerySchema`'s admin subset, plus the UI's own). */
export interface AdminConversationsQuery {
  userId?: string;
  documentId?: string;
  from?: string;
  to?: string;
  page?: number;
}

/**
 * `page` is the tab's own state and not a `ConversationsQuerySchema` field, so it is dropped here
 * rather than sent. There is deliberately no `feedback`: the route has no such field, the list row
 * carries no message-level rating to filter on locally, and a filter that only changes the query
 * key is worse than no filter (X6 fix wave — the control was removed).
 */
const serverQuery = (q: AdminConversationsQuery): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const k of ['userId', 'documentId', 'from', 'to'] as const) if (q[k]) out[k] = q[k]!;
  return out;
};

export const useAdminConversations = (q: AdminConversationsQuery, enabled = true) =>
  useQuery({
    queryKey: keys.ai.conversations({ admin: true, ...q }),
    enabled,
    queryFn: async () =>
      checked(
        ConversationsResponseSchema,
        await api.GET('/admin/ai/conversations', { params: { query: serverQuery(q) } }),
      ),
  });

export const useAdminConversation = (id: string | null, enabled = true) =>
  useQuery({
    queryKey: keys.ai.conversation(id ?? ''),
    enabled: enabled && !!id,
    queryFn: async () =>
      checked(
        ConversationDetailSchema,
        await api.GET('/ai/conversations/{id}', { params: { path: { id: id ?? '' } } }),
      ),
  });

export const useDeleteConversation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await api.DELETE('/admin/ai/conversations/{id}', { params: { path: { id } } }));
    },
    // Every filter combination is its own cache entry, so invalidate through the one helper that
    // owns the `ai` prefix rather than the single key the screen happens to be holding.
    onSuccess: () => invalidateAi(qc),
  });
};

/**
 * JSONL export: fetched as text, then handed to the browser through `download()`'s Blob URL.
 *
 * Not an `<a href>` to the route and not a data URL — the CSP has no `unsafe-inline`, and a plain
 * link would drop the credentials the same-origin fetch carries.
 */
export async function exportConversations(q: AdminConversationsQuery = {}): Promise<void> {
  /*
   * `application/x-ndjson`, so the generated client — which parses every body as JSON — is not
   * the right transport; this is the same origin, credentials and `ApiError` envelope by hand.
   */
  const url = new URL(`${API_BASE}/admin/ai/conversations/export.jsonl`, window.location.origin);
  for (const [k, v] of Object.entries(serverQuery(q)))
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const res = await globalThis.fetch(url.toString(), { credentials: 'include' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new ApiError(res.status, body.code ?? `HTTP_${res.status}`, body.message ?? 'הייצוא נכשל');
  }
  const text = await res.text();
  download(`ai-conversations-${new Date().toISOString().slice(0, 10)}.jsonl`, text, 'application/x-ndjson');
}

export { invalidateAi };
