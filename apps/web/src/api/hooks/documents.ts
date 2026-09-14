import { useMemo } from 'react';
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocRef, Document } from '@wecom/shared';
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

/**
 * I10 — pin state, resolved for **any** document, not just the 50 cards on page 1.
 *
 * The article topbar star and the `P` hotkey used to read `useDocuments({ sort: 'wave' })`, which
 * the API pages at 50: a document past card #50 always rendered "☆ הצמד" and `P` toggled the
 * wrong way. `GET /documents?pinned=true` already exists, so the authoritative set is one small
 * query — and because it is *ids only*, `useTogglePin` can update it optimistically without
 * inventing a card for a document that is not in any loaded list.
 */
const PINNED_QUERY = { pinned: true, sort: 'wave', pageSize: 200 } as const;

export const usePinnedIds = () =>
  useQuery({
    queryKey: keys.pins,
    staleTime: 30_000,
    queryFn: async () =>
      unwrap(await api.GET('/documents', { params: { query: PINNED_QUERY } })).items.map((c) => c.id),
  });

/** `isPinned(id)` for the topbar star, the `P` hotkey and the card menu. */
export function useIsPinned(): (id: string | undefined) => boolean {
  const { data } = usePinnedIds();
  const set = useMemo(() => new Set(data ?? []), [data]);
  return (id) => (id ? set.has(id) : false);
}

export const useRelated = (id: string | undefined) =>
  useQuery({
    queryKey: keys.related(id ?? ''),
    enabled: !!id,
    queryFn: async () =>
      unwrap(await api.GET('/documents/{id}/related', { params: { path: { id: id! } } })).items,
  });

export const useLinks = (id: string | undefined) =>
  useQuery({
    queryKey: keys.links(id ?? ''),
    enabled: !!id,
    queryFn: async () => unwrap(await api.GET('/documents/{id}/links', { params: { path: { id: id! } } })),
  });

/** How many out-links one document may resolve individually — see `useDocRefs`. */
const MAX_DOC_REF_LOOKUPS = 20;

/**
 * I10 — the `[[doc:…]]` / `R-01` reference table for one document.
 *
 * `<Fmt>` needs `{ id, title, code }` to turn a reference into a link with a readable label.
 * That used to come from page 1 of the library, so a reference to card #51 rendered as a raw
 * uuid. It is derived here from the document's **own** graph instead:
 *
 *   - `GET /documents/:id/related` — titles for the explicit `related` set, every link target,
 *     shared-block neighbours and field neighbours, capped by the API at 6;
 *   - `GET /documents/:id/links` — the complete out-link target set. Anything that cap left out
 *     is resolved with a targeted `GET /documents/{id}`, which also supplies `code` (`related`
 *     does not return it, so `R-01`-style references need the document itself).
 *
 * Bounded by the document's own link count, not by the size of the library, and every lookup
 * lands in the shared `keys.doc(id)` cache — so opening one of those links afterwards is free.
 */
export function useDocRefs(id: string | undefined): DocRef[] {
  const related = useRelated(id);
  const links = useLinks(id);

  const missing = useMemo(() => {
    const known = new Set((related.data ?? []).map((r) => r.documentId));
    const out = new Set<string>();
    for (const l of links.data?.out ?? [])
      if (l.toDocumentId && l.toDocumentId !== id && !known.has(l.toDocumentId)) out.add(l.toDocumentId);
    return [...out].slice(0, MAX_DOC_REF_LOOKUPS);
  }, [related.data, links.data, id]);

  const extra = useQueries({
    queries: missing.map((docId) => ({
      queryKey: keys.doc(docId),
      staleTime: 60_000,
      queryFn: async () => unwrap(await api.GET('/documents/{id}', { params: { path: { id: docId } } })),
    })),
    combine: (results) =>
      results.flatMap((r) => (r.data ? [{ id: r.data.id, title: r.data.title, code: r.data.code }] : [])),
  });

  const fromRelated = related.data;
  return useMemo(
    () => [...(fromRelated ?? []).map((r) => ({ id: r.documentId, title: r.title })), ...extra],
    [fromRelated, extra],
  );
}

export const useVersions = (id: string | undefined) =>
  useQuery({
    queryKey: keys.versions(id ?? ''),
    enabled: !!id,
    queryFn: async () =>
      unwrap(await api.GET('/documents/{id}/versions', { params: { path: { id: id! } } })).items,
  });

export const useVersion = (id: string | undefined, v: number | undefined) =>
  useQuery({
    queryKey: keys.version(id ?? '', v ?? -1),
    enabled: !!id && v != null,
    queryFn: async () =>
      unwrap(await api.GET('/documents/{id}/versions/{v}', { params: { path: { id: id!, v: v! } } })),
  });

/**
 * `GET /documents/:id/diff` — the server computes the step-level diff, its stats and the per-step
 * blame in one query. The history page used to fan out 25 full document snapshots to derive the
 * same thing client-side, which is expensive on a LAN VM sharing CPU with the model service.
 */
export const useDiff = (id: string | undefined, from: number | null, to: number | null) =>
  useQuery({
    queryKey: keys.diff(id ?? '', from ?? -1, to ?? -1),
    enabled: !!id && from != null && to != null,
    queryFn: async () =>
      unwrap(
        await api.GET('/documents/{id}/diff', {
          params: { path: { id: id! }, query: { from: from!, to: to! } },
        }),
      ),
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
      await qc.cancelQueries({ queryKey: keys.pins });
      const prev = qc.getQueriesData<ListDocumentsResponse>(ALL_DOCS);
      const prevPins = qc.getQueryData<string[]>(keys.pins);
      qc.setQueriesData<ListDocumentsResponse>(
        ALL_DOCS,
        (p) => p && { ...p, items: p.items.map((c) => (c.id === id ? { ...c, pinned } : c)) },
      );
      // Ids only, so a document that is on no loaded library page still flips instantly (I10).
      qc.setQueryData<string[]>(keys.pins, (ids) =>
        pinned ? [...new Set([...(ids ?? []), id])] : (ids ?? []).filter((x) => x !== id),
      );
      return { prev, prevPins };
    },
    onError: (_e, _v, ctx) => {
      ctx?.prev.forEach(([k, d]) => qc.setQueryData(k, d));
      qc.setQueryData(keys.pins, ctx?.prevPins);
    },
    onSettled: () => {
      void qc.invalidateQueries(ALL_DOCS);
      void qc.invalidateQueries({ queryKey: keys.pins });
    },
  });
}

/**
 * The document id is a *mutation variable*, not a hook argument: the editor's create-then-publish
 * flow only learns the real id after `POST /documents` returns, and binding the id at hook-call
 * time made the new-document path publish the literal path segment `new`.
 *
 * Returns `{ document, version, auditId }`; the document is unwrapped for callers and also seeded
 * into the document cache.
 */
export const usePublish = () => {
  const qc = useQueryClient();
  return useMutation({
    // `resolveFeedbackIds` (wave 4, W3) closes the reports the editor ticked in the publish
    // dialog. It is not in the generated contract yet — W3-api adds it to `PublishBodySchema`
    // and regenerates `openapi.json`; until then it simply rides along in the body.
    mutationFn: async ({
      id,
      ...body
    }: {
      id: string;
      label: string;
      markPartial?: boolean;
      resolveFeedbackIds?: string[];
    }) => unwrap(await api.POST('/documents/{id}/publish', { params: { path: { id } }, body })),
    onSuccess: (res, { id }) => {
      qc.setQueryData(keys.doc(id), res.document);
      void qc.invalidateQueries({ queryKey: keys.versions(id) });
      void qc.invalidateQueries(ALL_DOCS);
      qc.removeQueries({ queryKey: keys.draft(id) });
    },
  });
};

/**
 * `If-Match` is **required**: the route answers 428 without it, because the etag is the only
 * thing stopping one editor's structure save from silently clobbering another's. It is therefore
 * a required mutation variable, so omitting it is a typecheck error rather than a 428 at runtime.
 *
 * Pass the etag from the document you actually edited. `PATCH /documents/:id` *rotates* the etag,
 * so a patch-then-save flow must thread the patched document's etag through — a stale one is a 412.
 */
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
      etag: string;
    }): Promise<Document> =>
      unwrap(
        await api.PUT('/documents/{id}/structure', {
          params: { path: { id }, header: { 'if-match': etag } },
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

/** Also `{ document, version, auditId }` — the restored document is unwrapped and re-cached. */
export const useRestore = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: number) =>
      unwrap(await api.POST('/documents/{id}/restore/{v}', { params: { path: { id, v } } })),
    onSuccess: (res) => {
      qc.setQueryData(keys.doc(id), res.document);
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
