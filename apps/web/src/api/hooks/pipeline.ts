/** Sources, revisions and suggestions — the stage-2 pipeline surface the UI already drives. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SourceRevision, SuggestionPayload } from '@wecom/shared';
import { api, apiUpload } from '../client.js';
import { keys } from '../keys.js';
import { unwrap } from '../unwrap.js';
import type { SuggestionsQuery, UploadSourceResult } from '../types.js';

export const useSources = () =>
  useQuery({
    queryKey: keys.sources,
    queryFn: async () => unwrap(await api.GET('/sources')).items,
  });

export const useRevision = (id: string | undefined, rev = 'latest') =>
  useQuery({
    queryKey: keys.revision(id ?? '', rev),
    enabled: !!id,
    queryFn: async (): Promise<SourceRevision> =>
      unwrap(await api.GET('/sources/{id}/revisions/{rev}', { params: { path: { id: id!, rev } } })),
  });

const useSourceMutation = <TVars, TData>(fn: (v: TVars) => Promise<TData>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.sources });
      void qc.invalidateQueries({ queryKey: ['suggestions'] });
      void qc.invalidateQueries({ queryKey: ['revision'] });
    },
  });
};

export const useProcessSource = () =>
  useSourceMutation(async (id: string) =>
    unwrap(await api.POST('/sources/{id}/process', { params: { path: { id } } })),
  );

/** Returns `{ sourceId, revisionId, duplicate, kind, paragraphs }`, not a `Source`. */
export const useUploadSource = () =>
  useSourceMutation(async (file: File) => {
    const body = new FormData();
    body.append('file', file);
    return unwrap(await apiUpload<UploadSourceResult>('/sources/upload', body));
  });

export const useSuggestions = (q: SuggestionsQuery = {}) =>
  useQuery({
    queryKey: keys.suggestions(q),
    queryFn: async () => unwrap(await api.GET('/suggestions', { params: { query: q } })),
  });

const useSuggestionMutation = <TVars, TData>(fn: (v: TVars) => Promise<TData>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['suggestions'] });
      void qc.invalidateQueries({ queryKey: keys.sources });
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
};

/**
 * The API publishes three concrete routes rather than one templated segment, so the decision is
 * dispatched here instead of being interpolated into the path.
 */
export const useDecideSuggestion = () =>
  useSuggestionMutation(async ({ id, decision }: { id: string; decision: 'accept' | 'reject' | 'reset' }) => {
    const path = { path: { id } } as const;
    if (decision === 'accept') return unwrap(await api.POST('/suggestions/{id}/accept', { params: path }));
    if (decision === 'reject') return unwrap(await api.POST('/suggestions/{id}/reject', { params: path }));
    return unwrap(await api.POST('/suggestions/{id}/reset', { params: path }));
  });

export const useEditSuggestion = () =>
  useSuggestionMutation(async ({ id, editedPayload }: { id: string; editedPayload: SuggestionPayload }) =>
    unwrap(await api.PUT('/suggestions/{id}/edit', { params: { path: { id } }, body: { editedPayload } })),
  );

/** Applies every accepted suggestion of one source; `sourceId` is required by the route. */
export const usePublishSuggestions = () =>
  useSuggestionMutation(async (sourceId: string) =>
    unwrap(await api.POST('/suggestions/publish', { body: { sourceId } })),
  );
