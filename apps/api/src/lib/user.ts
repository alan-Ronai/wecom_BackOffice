import type { FastifyRequest } from 'fastify';
import { httpError } from './http.js';

import type { AuthUser } from '../modules/auth/permissions.js';

/** The request user, attached by L3's auth plugin (`req.user: AuthUser | null`). */
export type ReqUser = AuthUser;

/** All the scope predicates need off a caller: `null` is "every world" (an unscoped, org-wide role). */
export type ScopedCaller = { readonly worldScopes: readonly string[] | null };

export const requireUser = (req: FastifyRequest): ReqUser => {
  if (!req.user) throw httpError(401, 'UNAUTHENTICATED', 'נדרשת כניסה למערכת');
  return req.user;
};

const listOf = (worlds: string | readonly string[]): readonly string[] =>
  typeof worlds === 'string' ? [worlds] : worlds;

/**
 * The **read** scope rule — "any overlap": `worlds` is the entity's world list (or one slug) and
 * the caller may read it when they hold at least one of them. null scopes = every world.
 */
export const hasScope = (user: ScopedCaller, worlds: string | readonly string[]): boolean => {
  if (user.worldScopes === null) return true;
  return listOf(worlds).some((w) => user.worldScopes!.includes(w));
};

/**
 * The **write** scope rule (wave Y, owner decision on wave 5 A-M6) — edit, publish, delete, status
 * and ownership changes need the caller to hold **every** world the entity spans. A manager scoped
 * to `billing` may still read a briefing that cites one `billing` and four `tech` documents, but
 * may not change it. Unscoped (org-wide) roles are unaffected.
 *
 * It is strictly narrower than `hasScope`: a scoped caller never writes an entity with no world at
 * all, the same answer the read rule gives. Callers whose entities may legitimately span no world
 * (learning items, blocks, fields — worlds derived from what they reference) keep their own
 * `worlds.length &&` short-circuit, exactly as they did around `hasScope`.
 *
 * Every write guard in the API goes through this one predicate — the document route guard in
 * `plugins/auth.ts` (`scope: 'document:write'`), the document, bulk, trash, block, field and
 * learning handlers — so the rule is spelled once.
 */
export const hasAllScopes = (user: ScopedCaller, worlds: string | readonly string[]): boolean => {
  if (user.worldScopes === null) return true;
  const list = listOf(worlds);
  return list.length > 0 && list.every((w) => user.worldScopes!.includes(w));
};

export const hasPerm = (user: ReqUser, permission: string): boolean => user.permissions.has(permission);
