import type { FastifyRequest } from 'fastify';
import { httpError } from './http.js';

import type { AuthUser } from '../modules/auth/permissions.js';

/** The request user, attached by L3's auth plugin (`req.user: AuthUser | null`). */
export type ReqUser = AuthUser;

export const requireUser = (req: FastifyRequest): ReqUser => {
  if (!req.user) throw httpError(401, 'UNAUTHENTICATED', 'נדרשת כניסה למערכת');
  return req.user;
};

/** `categoryScopes === null` means "every category". */
export const hasScope = (user: ReqUser, category: string): boolean =>
  user.categoryScopes === null || user.categoryScopes.includes(category);

export const hasPerm = (user: ReqUser, permission: string): boolean => user.permissions.has(permission);
