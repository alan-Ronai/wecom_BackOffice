import type { ReqUser } from './user.js';

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
