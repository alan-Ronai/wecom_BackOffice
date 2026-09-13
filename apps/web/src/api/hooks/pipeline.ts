/** Sources, revisions and suggestions — the stage-2 pipeline surface the UI already drives. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Source, SourceRevision, Suggestion, SuggestionPayload } from '@wecom/shared';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { unwrap } from '../unwrap.js';
import type { Paginated, SuggestionsQuery } from '../types.js';

export const useSources = () =>
  useQuery({
    queryKey: keys.sources,
    queryFn: async (): Promise<Source[]> => unwrap(await api.GET('/sources')),
  });

export const useRevision = (id: string | undefined, rev = 'latest') =>
  useQuery({
    queryKey: keys.revision(id ?? '', rev),
    enabled: !!id,
    queryFn: async (): Promise<SourceRevision> =>
      unwrap(await api.GET('/sources/{id}/revisions/{rev}', { params: { path: { id: id!, rev } } })),
  });

const useSourceMutation = <TVars>(fn: (v: TVars) => Promise<unknown>) => {
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

export const useUploadSource = () =>
  useSourceMutation(async (file: File) => {
    const body = new FormData();
    body.append('file', file);
    return unwrap(await api.POST('/sources/upload', { body }));
  });

export const useSuggestions = (q: SuggestionsQuery = {}) =>
  useQuery({
    queryKey: keys.suggestions(q),
    queryFn: async (): Promise<Paginated<Suggestion>> =>
      unwrap(await api.GET('/suggestions', { params: { query: q } })),
  });

const useSuggestionMutation = <TVars>(fn: (v: TVars) => Promise<unknown>) => {
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

export const useDecideSuggestion = () =>
  useSuggestionMutation(async ({ id, decision }: { id: string; decision: 'accept' | 'reject' | 'reset' }) =>
    unwrap(await api.POST('/suggestions/{id}/{decision}', { params: { path: { id, decision } } })),
  );

export const useEditSuggestion = () =>
  useSuggestionMutation(async ({ id, editedPayload }: { id: string; editedPayload: SuggestionPayload }) =>
    unwrap(await api.PUT('/suggestions/{id}/edit', { params: { path: { id } }, body: { editedPayload } })),
  );

export const usePublishSuggestions = () =>
  useSuggestionMutation(async () => unwrap(await api.POST('/suggestions/publish')));
