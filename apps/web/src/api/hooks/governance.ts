/**
 * Governance (wave 4, lane W2) — status changes and the source-review flag.
 *
 * Both routes are in `docs/api/openapi.json` now, so they go through the generated client like
 * the rest of the app: a route that changes shape is a typecheck error rather than a runtime
 * `TypeError`. The answers are still parsed with `checked` against `DocumentSchema`, which is
 * what notices a *server* that disagrees with the contract the types were generated from.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import {
  DocumentSchema,
  type SetStatusBodySchema,
  type SourceReviewClearBodySchema,
  type Document,
} from '@wecom/shared';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { checked } from '../stage45.js';
import { invalidateContent } from '../invalidate.js';
import { useMe } from './me.js';

type SetStatusBody = z.infer<typeof SetStatusBodySchema>;
type SourceReviewClearBody = z.infer<typeof SourceReviewClearBodySchema>;

/** The statuses an editor may set by hand. Publishing stays with the publish route. */
export type SettableStatus = SetStatusBody['status'];

/**
 * True for read-only roles (agents): the API hides unpublished items from them entirely, so the
 * UI hides the status controls and status facets that could only ever come back empty.
 */
export function useReadOnlyReader(): boolean {
  const { data } = useMe();
  return !!data && !data.permissions.includes('docs.read_unpublished');
}

/**
 * One cache update for both mutations — the document itself, plus every list that shows it.
 *
 * `['documents']` alone was too narrow for what a status change actually moves: 'invalid' and
 * 'archived' push an item across the published-only visibility boundary (spec §5.5), which topic
 * pages, search, related/links/backlinks and the world/topic counts all enforce. Marking an item
 * "לא בתוקף" exists precisely so agents stop seeing it, and no SSE event is emitted for a status
 * change, so nothing else would heal those caches.
 */
function useDocumentWriteBack() {
  const qc = useQueryClient();
  return (doc: Document, id: string) => {
    qc.setQueryData(keys.doc(id), doc);
    invalidateContent(qc);
  };
}

/** `POST /documents/:id/status` — 'invalid' | 'archived' | 'draft', reason required. */
export function useSetStatus() {
  const writeBack = useDocumentWriteBack();
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: string } & SetStatusBody): Promise<Document> =>
      api
        .POST('/documents/{id}/status', { params: { path: { id } }, body: { status, reason } })
        .then((r) => checked(DocumentSchema, r)),
    onSuccess: (doc, { id }) => writeBack(doc, id),
  });
}

/** `POST /documents/:id/source-review/clear` — the editor judged the source change harmless. */
export function useClearSourceReview() {
  const writeBack = useDocumentWriteBack();
  return useMutation({
    mutationFn: ({ id, note }: { id: string } & SourceReviewClearBody): Promise<Document> =>
      api
        .POST('/documents/{id}/source-review/clear', { params: { path: { id } }, body: { note } })
        .then((r) => checked(DocumentSchema, r)),
    onSuccess: (doc, { id }) => writeBack(doc, id),
  });
}
