import fp from 'fastify-plugin';
import { PERMISSIONS, type Permission } from '@wecom/shared';

import type { AuthUser } from '../modules/auth/permissions.js';
export type { AuthUser };

export interface TestUserOption {
  id: string;
  displayName: string;
  /** `'all'` grants every permission; otherwise the exact list. */
  permissions: 'all' | Permission[];
  roles?: string[];
  categoryScopes?: string[] | null;
  worldScopes?: string[] | null;
}

/**
 * Test-only stand-in for L3's auth plugin: active only when NODE_ENV === 'test' and a
 * `testUser` was passed to buildApp. It injects req.user and enforces `config.requires`
 * so route tests exercise the same 401/403 behaviour as production.
 */
export default fp(async (app, opts: { testUser?: TestUserOption }) => {
  const t = opts.testUser;
  if (!t || app.config.NODE_ENV !== 'test') return;
  const permissions = new Set<string>(t.permissions === 'all' ? PERMISSIONS : t.permissions);
  const scopes = t.worldScopes ?? t.categoryScopes ?? null;
  app.addHook('onRequest', async (req, reply) => {
    req.user = {
      id: t.id,
      displayName: t.displayName,
      roles: t.roles ?? [],
      permissions,
      worldScopes: scopes,
      categoryScopes: scopes,
      sessionId: null,
    };
    const requires = req.routeOptions.config?.requires;
    if (!requires?.length) return;
    if (!req.user) return reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'נדרשת התחברות' });
    if (!requires.every((p) => permissions.has(p)))
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'אין הרשאה' });
  });
  app.log.info({ testUser: t.id }, 'test auth shim enabled');
});
