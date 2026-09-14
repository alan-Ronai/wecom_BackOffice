/** Blocks, CRM fields, scripts, notes and drafts — the rest of the content surface. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Block, CrmField, Note, Script } from '@wecom/shared';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { unwrap, unwrapMaybe } from '../unwrap.js';
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

export const useDeleteField = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      unwrap(await api.DELETE('/fields/{name}', { params: { path: { name } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.fields });
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
 * A document with no saved draft is a normal state, not an error: `unwrapMaybe` maps both 204
 * and 404 to `null` so the editor seeds from the published document instead of parking the
 * query in a permanent error state.
 */
export const useDraft = (id: string | undefined) =>
  useQuery({
    queryKey: keys.draft(id ?? ''),
    enabled: !!id,
    retry: false,
    queryFn: async (): Promise<DraftEnvelope | null> =>
      unwrapMaybe(await api.GET('/documents/{id}/draft', { params: { path: { id: id! } } })),
  });

/** Autosave: debounced 600 ms, exposing the "נשמר …" state the editor topbar renders. */
export function useSaveDraft(id: string, delay = 600) {
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Record<string, unknown> | null>(null);

  const flush = useCallback(async () => {
    const payload = pending.current;
    if (!payload) return;
    pending.current = null;
    await api.PUT('/documents/{id}/draft', { params: { path: { id } }, body: { payload } });
    setSaving(false);
    setLastSavedAt(Date.now());
  }, [id]);

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
   * route change) the pending payload is written out instead of being thrown away with the timer;
   * while something is buffered a `beforeunload` handler also flushes on tab close/reload.
   */
  useEffect(() => {
    const onBeforeUnload = () => {
      if (pending.current) void flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (timer.current) clearTimeout(timer.current);
      void flush();
    };
  }, [flush]);

  return { save, flush, saving, lastSavedAt };
}

export const useDeleteDraft = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/documents/{id}/draft', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.draft(id) }),
  });
};
