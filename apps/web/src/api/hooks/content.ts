/** Blocks, CRM fields, scripts, notes and drafts — the rest of the content surface. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Block, CrmField, Note } from '@wecom/shared';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { unwrap, unwrapMaybe } from '../unwrap.js';
import type { DraftEnvelope, UpsertBlockBody, UpsertFieldBody } from '../types.js';

/* ── blocks ─────────────────────────────────────────────────────────────── */
export const useBlocks = () =>
  useQuery({
    queryKey: keys.blocks,
    queryFn: async (): Promise<Block[]> => unwrap(await api.GET('/blocks')),
    staleTime: 30_000,
  });

export const useBlockUsage = (id: string | undefined) =>
  useQuery({
    queryKey: keys.blockUsage(id ?? ''),
    enabled: !!id,
    queryFn: async () => unwrap(await api.GET('/blocks/{id}/usage', { params: { path: { id: id! } } })),
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
    queryFn: async (): Promise<CrmField[]> => unwrap(await api.GET('/fields')),
    staleTime: 30_000,
  });

export const useFieldUsage = (name: string | undefined) =>
  useQuery({
    queryKey: keys.fieldUsage(name ?? ''),
    enabled: !!name,
    queryFn: async () => unwrap(await api.GET('/fields/{name}/usage', { params: { path: { name: name! } } })),
  });

export const useUpsertField = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpsertFieldBody): Promise<CrmField> =>
      unwrap(await api.PUT('/fields/{name}', { params: { path: { name: body.name } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.fields }),
  });
};

/* ── scripts ────────────────────────────────────────────────────────────── */
export const useScripts = () =>
  useQuery({
    queryKey: keys.scripts,
    queryFn: async () => unwrap(await api.GET('/scripts')),
    staleTime: 30_000,
  });

/* ── notes ──────────────────────────────────────────────────────────────── */
export const useNotes = (id: string | undefined) =>
  useQuery({
    queryKey: keys.notes(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<Note[]> =>
      unwrap(await api.GET('/documents/{id}/notes', { params: { path: { id: id! } } })),
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
    mutationFn: async (noteId: string): Promise<Note> =>
      unwrap(await api.POST('/notes/{id}/like', { params: { path: { id: noteId } } })),
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

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
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
