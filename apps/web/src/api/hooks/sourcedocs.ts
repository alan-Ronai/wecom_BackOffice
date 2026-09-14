/**
 * Source documents (wave 4, W4) — "מקור האמת": the full, versioned HTML document behind a
 * knowledge item, authored with TipTap, importable from and exportable to Word.
 *
 * Routes are typed from the **zod contract** in `@wecom/shared` rather than the generated
 * `schema.d.ts`, exactly as `src/api/stage45.ts` does for the stage 4–5 surface: the backend half
 * of this lane (W4-api) adds `/documents/:id/source*` and `/assets` to `docs/api/openapi.json`
 * concurrently, so `pnpm generate:client` cannot type them yet. `SourceDocumentSchema`,
 * `SourceDocumentVersionsResponseSchema` and `AssetSchema` *are* the contract both sides build
 * against (`docs/api/CONTRACTS-wave4.md`), so every response is parsed with them — a mock or a
 * server that drifts fails at the call site instead of rendering `undefined`.
 *
 * When these paths land in `openapi.json`, each wrapper below can be replaced by the matching
 * `api.GET(...)`/`api.PUT(...)` call; the hook signatures do not change.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AssetSchema,
  SourceDocumentSchema,
  SourceDocumentVersionsResponseSchema,
  type Asset,
  type SourceDocument,
  type SourceDocumentVersion,
} from '@wecom/shared';
import { API_BASE, apiUpload } from '../client.js';
import { keys } from '../keys.js';
import { ApiError, unwrap } from '../unwrap.js';

/**
 * The per-user autosave payload of `GET|PUT /documents/:id/source/draft`.
 *
 * Declared here rather than imported: W4-api appends `SourceDraftSchema` to
 * `packages/shared/src/schemas/wave4.ts` in the same wave, and this lane must not edit that file
 * beyond the one additive preference field. Swap this for the shared schema once it lands.
 */
export const SourceDraftShape = z.object({ html: z.string(), updatedAt: z.string() });
export type SourceDraft = z.infer<typeof SourceDraftShape>;

interface Init {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** `If-Match`, for the optimistic-concurrency PUT. */
  etag?: string;
}

async function request(path: string, init: Init): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.etag) headers['if-match'] = init.etag;
  return globalThis.fetch(`${API_BASE}${path}`, {
    method: init.method ?? 'GET',
    credentials: 'include',
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

async function fail(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
    details?: unknown;
  };
  throw new ApiError(res.status, body.code ?? 'ERROR', body.message ?? 'שגיאה', body.details);
}

async function parse<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  res: Response,
  path: string,
): Promise<T> {
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success)
    throw new ApiError(
      res.status,
      'CONTRACT',
      `תשובת השרת ל-${path} אינה תואמת את החוזה`,
      parsed.error.issues,
    );
  return parsed.data;
}

async function sourceJson<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  path: string,
  init: Init = {},
): Promise<T> {
  const res = await request(path, init);
  if (!res.ok) await fail(res);
  return parse(schema, res, path);
}

/** Same, but "there is no source document / no draft yet" (204) is `null`, not an error. */
async function sourceMaybe<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  path: string,
  init: Init = {},
): Promise<T | null> {
  const res = await request(path, init);
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) await fail(res);
  return parse(schema, res, path);
}

async function sourceVoid(path: string, init: Init = {}): Promise<void> {
  const res = await request(path, init);
  if (!res.ok) await fail(res);
}

/* ── source document ────────────────────────────────────────────────────── */

export const useSourceDocument = (id: string | undefined) =>
  useQuery({
    queryKey: keys.source(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<SourceDocument | null> =>
      sourceMaybe(SourceDocumentSchema, `/documents/${id!}/source`),
  });

/** `etag` is the value from the last GET/PUT; the server answers 412 when it is stale. */
export const useSaveSource = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { html: string; label?: string; etag?: string }): Promise<SourceDocument> =>
      sourceJson(SourceDocumentSchema, `/documents/${id}/source`, {
        method: 'PUT',
        etag: v.etag,
        body: { html: v.html, ...(v.label ? { label: v.label } : {}) },
      }),
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
      (await sourceJson(SourceDocumentVersionsResponseSchema, `/documents/${id!}/source/versions`)).items,
  });

export const useSourceVersion = (id: string | undefined, v: number | undefined) =>
  useQuery({
    queryKey: keys.sourceVersion(id ?? '', v ?? -1),
    enabled: !!id && v != null,
    queryFn: async (): Promise<SourceDocument> =>
      sourceJson(SourceDocumentSchema, `/documents/${id!}/source/versions/${v!}`),
  });

export const useRestoreSource = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: number): Promise<SourceDocument> =>
      sourceJson(SourceDocumentSchema, `/documents/${id}/source/restore/${v}`, { method: 'POST' }),
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
      return SourceDocumentSchema.parse(
        unwrap(await apiUpload<unknown>(`/documents/${id}/source/import`, form)),
      );
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
      return AssetSchema.parse(unwrap(await apiUpload<unknown>('/assets', form)));
    },
  });

/* ── autosave draft ─────────────────────────────────────────────────────── */

/** Autosave lives in the W4 `/source/draft` routes: per user, per document, cleared by a save. */
export const useSourceDraft = (id: string | undefined) =>
  useQuery({
    queryKey: keys.sourceDraft(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<SourceDraft | null> =>
      sourceMaybe(SourceDraftShape, `/documents/${id!}/source/draft`),
  });

export const useSaveSourceDraft = (id: string) =>
  useMutation({
    mutationFn: async (html: string): Promise<void> =>
      sourceVoid(`/documents/${id}/source/draft`, { method: 'PUT', body: { html } }),
  });

export const useDeleteSourceDraft = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => sourceVoid(`/documents/${id}/source/draft`, { method: 'DELETE' }),
    onSuccess: () => qc.removeQueries({ queryKey: keys.sourceDraft(id) }),
  });
};
