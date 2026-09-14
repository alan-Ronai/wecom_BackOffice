/**
 * Governance (wave 4, lane W2) — status changes and the source-review flag.
 *
 * `POST /documents/:id/status` and `POST /documents/:id/source-review/clear` are being added by the
 * API half of this lane concurrently, so they are not in `docs/api/openapi.json` yet and
 * `pnpm generate:client` cannot type them: `api.POST('/documents/{id}/status')` would not compile.
 * Until they are published these two calls go through the small `postWave4` bridge below — same
 * origin, same credentials, same `ApiError`, and the answer is still validated with `checked`
 * against `DocumentSchema`, the zod contract both halves are built against
 * (`packages/shared/src/schemas/wave4.ts`, `docs/api/CONTRACTS-wave4.md`).
 *
 * When the two paths appear in `openapi.json`, replace each `postWave4(...)` with
 * `checked(DocumentSchema, await api.POST(...))` and delete the bridge; nothing else changes.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import {
  DocumentSchema,
  type SetStatusBodySchema,
  type SourceReviewClearBodySchema,
  type Document,
} from '@wecom/shared';
import { API_BASE } from '../client.js';
import { keys } from '../keys.js';
import { checked } from '../stage45.js';
import { useMe } from './me.js';

type SetStatusBody = z.infer<typeof SetStatusBodySchema>;
type SourceReviewClearBody = z.infer<typeof SourceReviewClearBodySchema>;

/** The statuses an editor may set by hand. Publishing stays with the publish route. */
export type SettableStatus = SetStatusBody['status'];

/** JSON POST to a route the generated client cannot type yet. Removed with the bridge above. */
async function postWave4<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await globalThis.fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  return checked(schema, response.ok ? { data: payload, response } : { error: payload ?? {}, response });
}

/**
 * True for read-only roles (agents): the API hides unpublished items from them entirely, so the
 * UI hides the status controls and status facets that could only ever come back empty.
 */
export function useReadOnlyReader(): boolean {
  const { data } = useMe();
  return !!data && !data.permissions.includes('docs.read_unpublished');
}

/** One cache update for both mutations — the document itself, plus every list that shows it. */
function useDocumentWriteBack() {
  const qc = useQueryClient();
  return (doc: Document, id: string) => {
    qc.setQueryData(keys.doc(id), doc);
    void qc.invalidateQueries({ queryKey: ['documents'] });
  };
}

/** `POST /documents/:id/status` — 'invalid' | 'archived' | 'draft', reason required. */
export function useSetStatus() {
  const writeBack = useDocumentWriteBack();
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: string } & SetStatusBody): Promise<Document> =>
      postWave4(DocumentSchema, `/documents/${id}/status`, { status, reason }),
    onSuccess: (doc, { id }) => writeBack(doc, id),
  });
}

/** `POST /documents/:id/source-review/clear` — the editor judged the source change harmless. */
export function useClearSourceReview() {
  const writeBack = useDocumentWriteBack();
  return useMutation({
    mutationFn: ({ id, note }: { id: string } & SourceReviewClearBody): Promise<Document> =>
      postWave4(DocumentSchema, `/documents/${id}/source-review/clear`, { note }),
    onSuccess: (doc, { id }) => writeBack(doc, id),
  });
}
