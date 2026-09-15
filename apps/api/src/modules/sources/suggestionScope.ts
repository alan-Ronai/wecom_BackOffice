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
 * - a suggestion with a target document is visible when that document is — live, status-visible to
 *   the caller, and inside the caller's world scope;
 * - a suggestion with no target is visible when the **source** it came from feeds at least one
 *   document in the caller's scope (`source_revisions → sources → documents → document_worlds`).
 *   A source that feeds nothing the caller can see is not the caller's to review;
 * - a caller with no world scope at all (`scopes is null`) sees everything, as everywhere else.
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
           where vd.id = ${alias}.target_document_id and vd.deleted_at is null
             ${readUnpublished ? '' : `and vd.status in ('published','partial')`}
             and (${scopeParam}::text[] is null or exists (
                   select 1 from document_worlds vdw
                    where vdw.document_id = vd.id and vdw.world_slug = any(${scopeParam}::text[]))))
        else (${scopeParam}::text[] is null or exists (
          select 1 from source_revisions vsr
            join documents vsd on vsd.source_id = vsr.source_id and vsd.deleted_at is null
           where vsr.id = ${alias}.source_revision_id
             and exists (select 1 from document_worlds vsw
                          where vsw.document_id = vsd.id and vsw.world_slug = any(${scopeParam}::text[]))))
        end)`;
