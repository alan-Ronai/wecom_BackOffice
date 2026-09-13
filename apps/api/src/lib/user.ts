import type { FastifyRequest } from 'fastify';
import { httpError } from './http.js';

/**
 * The request user. L3's auth plugin fills the optional fields (`displayName`, `roles`,
 * `sessionId`); L2's routes only need id / permissions / categoryScopes, so the shape stays
 * structurally compatible with L3's `AuthUser` while the fake-auth test plugin can supply a subset.
 */
export interface ReqUser {
  id: string;
  displayName?: string;
  roles?: string[];
  permissions: Set<string>;
  categoryScopes: string[] | null;
  sessionId?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: ReqUser;
  }
}

export const requireUser = (req: FastifyRequest): ReqUser => {
  if (!req.user) throw httpError(401, 'UNAUTHENTICATED', 'נדרשת כניסה למערכת');
  return req.user;
};

/** `categoryScopes === null` means "every category". */
export const hasScope = (user: ReqUser, category: string): boolean =>
  user.categoryScopes === null || user.categoryScopes.includes(category);

export const hasPerm = (user: ReqUser, permission: string): boolean => user.permissions.has(permission);
