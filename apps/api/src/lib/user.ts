import type { FastifyRequest } from 'fastify';
import { httpError } from './http.js';

import type { AuthUser } from '../modules/auth/permissions.js';

/** The request user, attached by L3's auth plugin (`req.user: AuthUser | null`). */
export type ReqUser = AuthUser;

export const requireUser = (req: FastifyRequest): ReqUser => {
  if (!req.user) throw httpError(401, 'UNAUTHENTICATED', 'נדרשת כניסה למערכת');
  return req.user;
};

/** Scope = intersection: `worlds` is the document's world list (or one slug). null scopes = every world. */
export const hasScope = (user: ReqUser, worlds: string | readonly string[]): boolean => {
  if (user.worldScopes === null) return true;
  const list = typeof worlds === 'string' ? [worlds] : worlds;
  return list.some((w) => user.worldScopes!.includes(w));
};

export const hasPerm = (user: ReqUser, permission: string): boolean => user.permissions.has(permission);
