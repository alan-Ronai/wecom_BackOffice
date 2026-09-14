import type { ReqUser } from './user.js';
import { httpError } from './http.js';
import type { Queryable } from './sql.js';

/** Statuses a read-only role may see (PRD §10: only published content by default). */
export const VISIBLE_TO_READERS = ['published', 'partial'] as const;

export const canReadUnpublished = (user: Pick<ReqUser, 'permissions'>): boolean =>
  user.permissions.has('docs.read_unpublished');

/**
 * SQL fragment to append to a `where` clause on a documents alias. Empty for editors.
 * Literal statuses, not a parameter, so callers can splice it into any query without
 * renumbering their placeholders.
 */
export const visibilityWhere = (user: Pick<ReqUser, 'permissions'>, alias = 'd'): string =>
  canReadUnpublished(user) ? '' : ` and ${alias}.status in ('published','partial')`;

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
