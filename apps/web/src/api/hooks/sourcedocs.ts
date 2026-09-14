/**
 * Source documents (wave 4, W4) — "מקור האמת": the full, versioned HTML document behind a
 * knowledge item, authored with TipTap, importable from and exportable to Word.
 *
 * Every route here is published, so the calls go through the generated client and each answer is
 * parsed with `checked` against the zod contract in `@wecom/shared`. The two exceptions are the
 * ones the typed client cannot model: the multipart uploads go through `apiUpload`, and the two
 * binary downloads are plain `<a href>` targets.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AssetSchema,
  SourceDocumentSchema,
  SourceDocumentVersionsResponseSchema,
  SourceDraftSchema,
  type Asset,
  type SourceDocument,
  type SourceDocumentVersion,
} from '@wecom/shared';
import { z } from 'zod';
import { API_BASE, api, apiUpload } from '../client.js';
import { keys } from '../keys.js';
import { unwrap } from '../unwrap.js';
import { checked, checkedMaybe } from '../stage45.js';

/** The per-user autosave payload of `GET|PUT /documents/:id/source/draft`. */
export const SourceDraftShape = SourceDraftSchema;
export type SourceDraft = z.infer<typeof SourceDraftSchema>;

/* ── source document ────────────────────────────────────────────────────── */

/**
 * `latestRevisionId` is what makes the raw-docx download reachable (§5.1,
 * `GET /sources/:id/revisions/:rev/raw`). The API half of this fix adds it to
 * `SourceDocumentSchema`; until that lands the field has to be declared here, because
 * `z.object` strips what it does not know and the pane would never see it.
 *
 * Declared `.optional()` so it parses against both the current and the arriving shared schema.
 * Once `SourceDocumentSchema` carries the field, this extension can go.
 */
const SourceDocumentWithRevisionSchema = SourceDocumentSchema.extend({
  latestRevisionId: z.string().nullable().optional(),
});
export type SourceDocumentWithRevision = z.infer<typeof SourceDocumentWithRevisionSchema>;

export const useSourceDocument = (id: string | undefined) =>
  useQuery({
    queryKey: keys.source(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<SourceDocumentWithRevision | null> =>
      checkedMaybe(
        SourceDocumentWithRevisionSchema,
        await api.GET('/documents/{id}/source', { params: { path: { id: id! } } }),
      ),
  });

/** `etag` is the value from the last GET/PUT; the server answers 412 when it is stale. */
export const useSaveSource = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { html: string; label?: string; etag?: string }): Promise<SourceDocument> =>
      checked(
        SourceDocumentSchema,
        await api.PUT('/documents/{id}/source', {
          params: { path: { id } },
          // Optimistic concurrency: the server answers 412 when the etag is stale.
          ...(v.etag ? { headers: { 'if-match': v.etag } } : {}),
          body: { html: v.html, ...(v.label ? { label: v.label } : {}) },
        }),
      ),
    onSuccess: (data) => {
      qc.setQueryData(keys.source(id), data);
      qc.removeQueries({ queryKey: keys.sourceDraft(id) }); // the server deleted the autosave row
      void qc.invalidateQueries({ queryKey: keys.sourceVersions(id) });
      void qc.invalidateQueries({ queryKey: keys.doc(id) }); // W2's sourceReviewNeeded flag
    },
  });
};

/* ── versions ───────────────────────────────────────────────────────────── */

export const useSourceVersions = (id: string | undefined) =>
  useQuery({
    queryKey: keys.sourceVersions(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<SourceDocumentVersion[]> =>
      checked(
        SourceDocumentVersionsResponseSchema,
        await api.GET('/documents/{id}/source/versions', { params: { path: { id: id! } } }),
      ).items,
  });

export const useSourceVersion = (id: string | undefined, v: number | undefined) =>
  useQuery({
    queryKey: keys.sourceVersion(id ?? '', v ?? -1),
    enabled: !!id && v != null,
    queryFn: async (): Promise<SourceDocument> =>
      checked(
        SourceDocumentSchema,
        await api.GET('/documents/{id}/source/versions/{v}', { params: { path: { id: id!, v: v! } } }),
      ),
  });

export const useRestoreSource = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: number): Promise<SourceDocument> =>
      checked(
        SourceDocumentSchema,
        await api.POST('/documents/{id}/source/restore/{v}', { params: { path: { id, v } } }),
      ),
    onSuccess: (data) => {
      qc.setQueryData(keys.source(id), data);
      void qc.invalidateQueries({ queryKey: keys.sourceVersions(id) });
    },
  });
};

/* ── import / export / assets ───────────────────────────────────────────── */

export const useImportDocx = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<SourceDocument> => {
      const form = new FormData();
      form.append('file', file);
      return checked(SourceDocumentSchema, await apiUpload<unknown>(`/documents/${id}/source/import`, form));
    },
    onSuccess: (data) => {
      qc.setQueryData(keys.source(id), data);
      void qc.invalidateQueries({ queryKey: keys.sourceVersions(id) });
    },
  });
};

/** Plain `<a href>` target — same-origin, cookie auth, binary body the typed client cannot model. */
export const exportDocxUrl = (id: string) => `${API_BASE}/documents/${id}/source/export.docx`;
export const rawRevisionUrl = (sourceId: string, revisionId: string) =>
  `${API_BASE}/sources/${sourceId}/revisions/${revisionId}/raw`;

export const useUploadAsset = () =>
  useMutation({
    mutationFn: async (file: File): Promise<Asset> => {
      const form = new FormData();
      form.append('file', file);
      return checked(AssetSchema, await apiUpload<unknown>('/assets', form));
    },
  });

/* ── autosave draft ─────────────────────────────────────────────────────── */

/** Autosave lives in the W4 `/source/draft` routes: per user, per document, cleared by a save. */
export const useSourceDraft = (id: string | undefined) =>
  useQuery({
    queryKey: keys.sourceDraft(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<SourceDraft | null> =>
      checkedMaybe(
        SourceDraftSchema,
        await api.GET('/documents/{id}/source/draft', { params: { path: { id: id! } } }),
      ),
  });

export const useSaveSourceDraft = (id: string) =>
  useMutation({
    mutationFn: async (html: string): Promise<void> => {
      unwrap(await api.PUT('/documents/{id}/source/draft', { params: { path: { id } }, body: { html } }));
    },
  });

export const useDeleteSourceDraft = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      unwrap(await api.DELETE('/documents/{id}/source/draft', { params: { path: { id } } }));
    },
    onSuccess: () => qc.removeQueries({ queryKey: keys.sourceDraft(id) }),
  });
};
