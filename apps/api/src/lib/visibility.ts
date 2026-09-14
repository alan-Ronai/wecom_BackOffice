import type { ReqUser } from './user.js';
import { httpError } from './http.js';
import type { Queryable } from './sql.js';

/** Statuses a read-only role may see (PRD §10: only published content by default). */
export const VISIBLE_TO_READERS = ['published', 'partial'] as const;

export const canReadUnpublished = (user: Pick<ReqUser, 'permissions'>): boolean =>
  user.permissions.has('docs.read_unpublished');

/**
 * `alias.status in ('published','partial')` — the single spelling of the reader rule.
 * Pass `null` for a query whose `status` column needs no qualifier.
 */
export const visibleStatusSql = (alias: string | null = 'd'): string =>
  `${alias ? alias + '.' : ''}status in (${VISIBLE_TO_READERS.map((s) => `'${s}'`).join(',')})`;

/**
 * SQL fragment to append to a `where` clause on a documents alias. Empty for a caller
 * that may read unpublished content. Literal statuses, not a parameter, so callers can
 * splice it into any query without renumbering their placeholders.
 */
export const visibleWhere = (readUnpublished: boolean, alias: string | null = 'd'): string =>
  readUnpublished ? '' : ` and ${visibleStatusSql(alias)}`;

/** `visibleWhere` for the common case of a `ReqUser` rather than a resolved boolean. */
export const visibilityWhere = (user: Pick<ReqUser, 'permissions'>, alias: string | null = 'd'): string =>
  visibleWhere(canReadUnpublished(user), alias);

/**
 * Guard for the routes that hang off a document id but do not load the document — comments,
 * notes, drafts. `config.scope: 'document'` already checks the caller's world scope; this is the
 * other half of §10, and it answers **404 `NOT_PUBLISHED`** rather than 403 for the same reason
 * `getVisibleDocument` does: a reader must not be able to learn that a draft exists by watching
 * which id gives which status.
 *
 * A missing document is left to the caller — most of these routes answer an empty list for one,
 * and turning that into a 404 would be a behaviour change none of them asked for.
 */
export async function assertVisibleDocument(
  q: Queryable,
  id: string,
  user: Pick<ReqUser, 'permissions'>,
): Promise<void> {
  if (canReadUnpublished(user)) return;
  const r = await q.query<{ status: string }>(
    'select status from documents where id=$1 and deleted_at is null',
    [id],
  );
  const status = r.rows[0]?.status;
  if (status && !(VISIBLE_TO_READERS as readonly string[]).includes(status))
    throw httpError(404, 'NOT_PUBLISHED', 'פריט זה אינו זמין כרגע');
}
