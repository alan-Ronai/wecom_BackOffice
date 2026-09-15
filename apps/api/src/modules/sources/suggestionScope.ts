/**
 * Wave 6 fix wave (A-I2, A-I6) — the single spelling of "which suggestions may this caller read".
 *
 * Before the fix there were two answers. `list_suggestions` (the chat tool) narrowed by the target
 * document's worlds but let every **null-target** row through — and `new-card` carries a whole
 * proposed document in its payload, `field-alert` a CRM field name, both with no target. The review
 * queue (`GET /suggestions`, and X6's new `GET /suggestions/:id`) applied no scope at all.
 *
 * The ruling (fix wave, A-I6): **the review queue is world-scoped like every other reader.** So
 * both callers use this predicate, and the rule is written once:
 *
 * - a suggestion with a target document is visible when that document is status-visible to the
 *   caller and inside the caller's world scope;
 * - a suggestion with no target is visible when the **source** it came from feeds at least one
 *   document in the caller's scope (`source_revisions → sources → documents → document_worlds`).
 *   A source that feeds nothing the caller can see is not the caller's to review;
 * - a caller with no world scope at all (`scopes is null`) sees everything, as everywhere else.
 *
 * Two carve-outs, both from the re-review of the first pass, and both about rows that the plain
 * reading of the rule made **unreachable by anyone**:
 *
 * 1. **A source with no documents yet is nobody's world, so it is everybody's.** A brand-new
 *    import has no `documents.source_id` row — `new-card` is precisely the suggestion that
 *    creates the first one — so scoping its null-target rows through "the worlds of the documents
 *    this source feeds" scoped them through the empty set and hid them from every world-scoped
 *    reviewer. Only an unscoped user could then bootstrap a source, which is not a review queue,
 *    it is an admin console. So: while a source feeds no live document, its null-target rows are
 *    visible; from the moment it feeds one, the world scope applies and keeps applying.
 * 2. **A soft-deleted target does not erase the suggestion.** `deleted_at is null` sat outside the
 *    scope branch, so deleting a document took every suggestion against it out of the queue *and*
 *    out of the dashboard counts — for admins too, leaving rows that could be neither rejected nor
 *    restored. An unscoped caller (an admin or a lead) now still sees them; a scoped caller does
 *    not, because a deleted document has no world worth checking them against.
 *
 * This predicate answers the **world** question only. Who may ask it at all is the route's
 * `requires: ['suggestions.review']` and, for the chat tools, the `ai.chat` tier — carve-out 1
 * widens what a reviewer can see, never who counts as one.
 *
 * `scopeParam` is a `text[]`-or-null placeholder the caller has already bound; `readUnpublished`
 * is spliced as a literal, like `visibleWhere`, so callers can drop this into any query without
 * renumbering their placeholders.
 */
/** What the predicate needs from the caller. `worldScopes: null` is "every world". */
export interface SuggestionViewer {
  worldScopes: readonly string[] | null;
  readUnpublished: boolean;
}

/** `SuggestionViewer` from a request user, so the routes do not each spell the two lookups out. */
export const suggestionViewer = (user: {
  worldScopes: readonly string[] | null;
  permissions: ReadonlySet<string> | Set<string>;
}): SuggestionViewer => ({
  worldScopes: user.worldScopes,
  readUnpublished: user.permissions.has('docs.read_unpublished'),
});

export const suggestionVisibleSql = (
  alias: string,
  scopeParam: string,
  readUnpublished: boolean,
): string => `(case when ${alias}.target_document_id is not null then exists (
          select 1 from documents vd
           where vd.id = ${alias}.target_document_id
             ${readUnpublished ? '' : `and vd.status in ('published','partial')`}
             /* Carve-out 2: a soft-deleted target keeps the row for an unscoped caller, who is
                the one who can reject it or restore the document. deleted_at is checked only on
                the scoped branch, where the worlds it would be matched against are gone too.
                Block comments, not "--": this fragment is spliced into other modules' queries. */
             and (${scopeParam}::text[] is null
                  or (vd.deleted_at is null and exists (
                        select 1 from document_worlds vdw
                         where vdw.document_id = vd.id
                           and vdw.world_slug = any(${scopeParam}::text[])))))
        else (${scopeParam}::text[] is null
              /* Carve-out 1: a source that feeds no live document yet has no worlds to scope by,
                 and new-card is the suggestion that gives it its first one. Visible until then. */
              or not exists (
                select 1 from source_revisions vsr0
                  join documents vsd0 on vsd0.source_id = vsr0.source_id and vsd0.deleted_at is null
                 where vsr0.id = ${alias}.source_revision_id)
              or exists (
                select 1 from source_revisions vsr
                  join documents vsd on vsd.source_id = vsr.source_id and vsd.deleted_at is null
                 where vsr.id = ${alias}.source_revision_id
                   and exists (select 1 from document_worlds vsw
                                where vsw.document_id = vsd.id
                                  and vsw.world_slug = any(${scopeParam}::text[]))))
        end)`;
