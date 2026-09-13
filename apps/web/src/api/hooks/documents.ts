import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Document, Version } from '@wecom/shared';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { unwrap } from '../unwrap.js';
import type {
  CreateDocumentBody,
  ListDocumentsQuery,
  ListDocumentsResponse,
  PatchDocumentBody,
  RelatedDoc,
} from '../types.js';

/** Any `['documents', …]` key — used for optimistic pin updates and broad invalidation. */
const ALL_DOCS = { queryKey: ['documents'] as const };

export const useDocuments = (q: ListDocumentsQuery = {}) =>
  useQuery({
    queryKey: keys.docs(q),
    queryFn: async () => unwrap(await api.GET('/documents', { params: { query: q } })),
    placeholderData: keepPreviousData,
  });

export const useDocument = (id: string | undefined) =>
  useQuery({
    queryKey: keys.doc(id ?? ''),
    enabled: !!id,
    queryFn: async () => unwrap(await api.GET('/documents/{id}', { params: { path: { id: id! } } })),
  });

export const useRelated = (id: string | undefined) =>
  useQuery({
    queryKey: keys.related(id ?? ''),
    enabled: !!id,
    queryFn: async () => unwrap(await api.GET('/documents/{id}/related', { params: { path: { id: id! } } })),
  });

export const useLinks = (id: string | undefined) =>
  useQuery({
    queryKey: keys.links(id ?? ''),
    enabled: !!id,
    queryFn: async () => unwrap(await api.GET('/documents/{id}/links', { params: { path: { id: id! } } })),
  });

export const useVersions = (id: string | undefined) =>
  useQuery({
    queryKey: keys.versions(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<Version[]> =>
      unwrap(await api.GET('/documents/{id}/versions', { params: { path: { id: id! } } })),
  });

export const useVersion = (id: string | undefined, v: number | undefined) =>
  useQuery({
    queryKey: keys.version(id ?? '', v ?? -1),
    enabled: !!id && v != null,
    queryFn: async (): Promise<Document> =>
      unwrap(await api.GET('/documents/{id}/versions/{v}', { params: { path: { id: id!, v: v! } } })),
  });

export function useTogglePin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) =>
      unwrap(
        pinned
          ? await api.POST('/documents/{id}/pin', { params: { path: { id } } })
          : await api.DELETE('/documents/{id}/pin', { params: { path: { id } } }),
      ),
    onMutate: async ({ id, pinned }) => {
      await qc.cancelQueries(ALL_DOCS);
      const prev = qc.getQueriesData<ListDocumentsResponse>(ALL_DOCS);
      qc.setQueriesData<ListDocumentsResponse>(
        ALL_DOCS,
        (p) => p && { ...p, items: p.items.map((c) => (c.id === id ? { ...c, pinned } : c)) },
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev.forEach(([k, d]) => qc.setQueryData(k, d)),
    onSettled: () => qc.invalidateQueries(ALL_DOCS),
  });
}

export const usePublish = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { label: string; markPartial?: boolean }): Promise<Document> =>
      unwrap(await api.POST('/documents/{id}/publish', { params: { path: { id } }, body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.doc(id) });
      void qc.invalidateQueries({ queryKey: keys.versions(id) });
      void qc.invalidateQueries(ALL_DOCS);
      qc.removeQueries({ queryKey: keys.draft(id) });
    },
  });
};

export const useSaveStructure = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      phases,
      related,
      etag,
    }: {
      phases: Document['phases'];
      related?: Document['related'];
      etag?: string;
    }): Promise<Document> =>
      unwrap(
        await api.PUT('/documents/{id}/structure', {
          params: { path: { id }, header: etag ? { 'If-Match': etag } : {} },
          body: { phases, related },
        }),
      ),
    onSuccess: (d) => qc.setQueryData(keys.doc(id), d),
  });
};

export const usePatchDocument = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: PatchDocumentBody): Promise<Document> =>
      unwrap(await api.PATCH('/documents/{id}', { params: { path: { id } }, body })),
    onSuccess: (d) => {
      qc.setQueryData(keys.doc(id), d);
      void qc.invalidateQueries(ALL_DOCS);
    },
  });
};

export const useRestore = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: number): Promise<Document> =>
      unwrap(await api.POST('/documents/{id}/restore/{v}', { params: { path: { id, v } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.doc(id) });
      void qc.invalidateQueries({ queryKey: keys.versions(id) });
      void qc.invalidateQueries(ALL_DOCS);
    },
  });
};

export const useRecordView = () =>
  useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.POST('/documents/{id}/view', { params: { path: { id } } })),
  });

export const useDeleteDocument = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.DELETE('/documents/{id}', { params: { path: { id } } })),
    onSuccess: () => {
      void qc.invalidateQueries(ALL_DOCS);
      void qc.invalidateQueries({ queryKey: keys.trash });
    },
  });
};

export const useCreateDocument = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateDocumentBody): Promise<Document> =>
      unwrap(await api.POST('/documents', { body })),
    onSuccess: () => qc.invalidateQueries(ALL_DOCS),
  });
};

export type { RelatedDoc };
