/** Blocks, CRM fields, scripts, notes and drafts — the rest of the content surface. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Block, CrmField, Note, Script } from '@wecom/shared';
import { api, API_BASE } from '../client.js';
import { keys } from '../keys.js';
import { unwrap, unwrapMaybe } from '../unwrap.js';
import { keepaliveJson, useUnloadFlush } from '../../lib/unloadFlush.js';
import type { DraftEnvelope, UpsertBlockBody, UpsertFieldBody, UpsertScriptBody } from '../types.js';

/* ── blocks ─────────────────────────────────────────────────────────────── */
export const useBlocks = () =>
  useQuery({
    queryKey: keys.blocks,
    queryFn: async () => unwrap(await api.GET('/blocks')).items,
    staleTime: 30_000,
  });

export const useBlockUsage = (id: string | undefined) =>
  useQuery({
    queryKey: keys.blockUsage(id ?? ''),
    enabled: !!id,
    queryFn: async () => unwrap(await api.GET('/blocks/{id}/usage', { params: { path: { id: id! } } })).items,
  });

export const useUpsertBlock = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: UpsertBlockBody & { id?: string }): Promise<Block> =>
      unwrap(
        id
          ? await api.PUT('/blocks/{id}', { params: { path: { id } }, body })
          : await api.POST('/blocks', { body }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.blocks });
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
};

export const useDeleteBlock = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE('/blocks/{id}', { params: { path: { id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.blocks });
      void qc.invalidateQueries({ queryKey: keys.trash });
    },
  });
};

/* ── CRM fields ─────────────────────────────────────────────────────────── */
export const useFields = () =>
  useQuery({
    queryKey: keys.fields,
    queryFn: async () => unwrap(await api.GET('/fields')).items,
    staleTime: 30_000,
  });

export const useFieldUsage = (name: string | undefined) =>
  useQuery({
    queryKey: keys.fieldUsage(name ?? ''),
    enabled: !!name,
    queryFn: async () =>
      unwrap(await api.GET('/fields/{name}/usage', { params: { path: { name: name! } } })).items,
  });

export const useUpsertField = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpsertFieldBody): Promise<CrmField> =>
      unwrap(await api.PUT('/fields/{name}', { params: { path: { name: body.name } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.fields }),
  });
};

/**
 * Deleting a field does not delete the *text* that references it: the chips in every step keep
 * rendering, as "unknown field". So the graph, the field pages and the dashboards all go stale
 * together and are invalidated together.
 */
export const useDeleteField = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      unwrap(await api.DELETE('/fields/{name}', { params: { path: { name } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.fields });
      void qc.invalidateQueries({ queryKey: ['fieldPage'] });
      void qc.invalidateQueries({ queryKey: ['fieldUsage'] });
      void qc.invalidateQueries({ queryKey: ['graph'] });
      void qc.invalidateQueries({ queryKey: keys.dashboards });
      // A deleted field turns every chip that referenced it into "unknown", so the documents
      // rendering those chips have to be re-read as well.
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: keys.trash });
    },
  });
};

/* ── scripts ────────────────────────────────────────────────────────────── */
export const useScripts = () =>
  useQuery({
    queryKey: keys.scripts,
    queryFn: async () => unwrap(await api.GET('/scripts')).items,
    staleTime: 30_000,
  });

export const useUpsertScript = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: UpsertScriptBody & { id?: string }): Promise<Script> =>
      unwrap(
        id
          ? await api.PUT('/scripts/{id}', { params: { path: { id } }, body })
          : await api.POST('/scripts', { body }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.scripts }),
  });
};

export const useDeleteScript = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE('/scripts/{id}', { params: { path: { id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.scripts });
      void qc.invalidateQueries({ queryKey: keys.trash });
    },
  });
};

/* ── notes ──────────────────────────────────────────────────────────────── */
export const useNotes = (id: string | undefined) =>
  useQuery({
    queryKey: keys.notes(id ?? ''),
    enabled: !!id,
    queryFn: async () =>
      unwrap(await api.GET('/documents/{id}/notes', { params: { path: { id: id! } } })).items,
  });

export const useAddNote = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { stepKey: string | null; text: string }): Promise<Note> =>
      unwrap(await api.POST('/documents/{id}/notes', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notes(id) }),
  });
};

export const useLikeNote = (docId: string) => {
  const qc = useQueryClient();
  return useMutation({
    // Returns only the new counter pair `{ likes, likedByMe }`, not the whole note.
    mutationFn: async (noteId: string) => ({
      noteId,
      ...unwrap(await api.POST('/notes/{id}/like', { params: { path: { id: noteId } } })),
    }),
    onMutate: async (noteId) => {
      await qc.cancelQueries({ queryKey: keys.notes(docId) });
      const prev = qc.getQueryData<Note[]>(keys.notes(docId));
      qc.setQueryData<Note[]>(keys.notes(docId), (list) =>
        list?.map((n) =>
          n.id === noteId ? { ...n, likedByMe: !n.likedByMe, likes: n.likes + (n.likedByMe ? -1 : 1) } : n,
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(keys.notes(docId), ctx?.prev),
    // Reconcile against the authoritative counters the server returned.
    onSuccess: ({ noteId, likes, likedByMe }) =>
      qc.setQueryData<Note[]>(keys.notes(docId), (list) =>
        list?.map((n) => (n.id === noteId ? { ...n, likes, likedByMe } : n)),
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.notes(docId) }),
  });
};

export const useDeleteNote = (docId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (noteId: string) =>
      unwrap(await api.DELETE('/notes/{id}', { params: { path: { id: noteId } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notes(docId) }),
  });
};

/* ── drafts ─────────────────────────────────────────────────────────────── */
/**
 * Two draft shapes, one editor.
 *
 * An existing document's draft lives at `/documents/:id/draft`. A document that does not exist
 * yet has nowhere to hang one, so the API keeps it at `/drafts/new/:draftId` — a route that was
 * shipped in stage 1 and never called (review "missing features"): `/edit/new` lived purely in
 * React state, so a refresh, a crash or a second machine lost everything typed so far.
 *
 * `/edit/new` uses the fixed draft id below, so there is exactly one in-progress new document per
 * user and reopening the route resumes it.
 */
export const NEW_DRAFT_ID = 'new';

/**
 * A document with no saved draft is a normal state, not an error: `unwrapMaybe` maps both 204
 * and 404 to `null` so the editor seeds from the published document instead of parking the
 * query in a permanent error state.
 */
export const useDraft = (id: string | undefined, isNew = false) =>
  useQuery({
    queryKey: keys.draft(isNew ? `new:${id ?? ''}` : (id ?? '')),
    enabled: !!id,
    retry: false,
    queryFn: async (): Promise<DraftEnvelope | null> =>
      isNew
        ? unwrapMaybe(await api.GET('/drafts/new/{draftId}', { params: { path: { draftId: id! } } }))
        : unwrapMaybe(await api.GET('/documents/{id}/draft', { params: { path: { id: id! } } })),
  });

/** Autosave: debounced 600 ms, exposing the "נשמר …" state the editor topbar renders. */
export function useSaveDraft(id: string, delay = 600, isNew = false) {
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Record<string, unknown> | null>(null);

  const flush = useCallback(async () => {
    const payload = pending.current;
    if (!payload) return;
    pending.current = null;
    await (isNew
      ? api.PUT('/drafts/new/{draftId}', { params: { path: { draftId: id } }, body: { payload } })
      : api.PUT('/documents/{id}/draft', { params: { path: { id } }, body: { payload } }));
    setSaving(false);
    setLastSavedAt(Date.now());
  }, [id, isNew]);

  const save = useCallback(
    (payload: Record<string, unknown>) => {
      pending.current = payload;
      setSaving(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [delay, flush],
  );

  /**
   * Never drop buffered keystrokes. On unmount (leaving the editor by Escape, the topbar, or a
   * route change) the pending payload is written out instead of being thrown away with the timer.
   *
   * The page-teardown path is separate and deliberately does not reuse `flush`: an ordinary
   * `fetch` started during unload is routinely cancelled, and `beforeunload` does not fire at all
   * on mobile Safari or into the bfcache — so the up-to-600 ms of typing sitting in the debounce
   * when someone closes the tab was simply lost. `keepalive` hands the request to the browser to
   * finish without the page. It is a `PUT`, so `sendBeacon` (POST-only) is not available here.
   */
  useUnloadFlush(() => {
    const payload = pending.current;
    if (!payload) return;
    pending.current = null;
    keepaliveJson(
      'PUT',
      isNew
        ? `${API_BASE}/drafts/new/${encodeURIComponent(id)}`
        : `${API_BASE}/documents/${encodeURIComponent(id)}/draft`,
      { payload },
    );
  });

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void flush();
    },
    [flush],
  );

  return { save, flush, saving, lastSavedAt };
}

export const useDeleteDraft = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/documents/{id}/draft', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.draft(id) }),
  });
};

/** Discards the server-side `/edit/new` draft once the document it held has been created. */
export const useDeleteNewDraft = (draftId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      unwrap(await api.DELETE('/drafts/new/{draftId}', { params: { path: { draftId } } })),
    onSuccess: () => qc.removeQueries({ queryKey: keys.draft(`new:${draftId}`) }),
  });
};
