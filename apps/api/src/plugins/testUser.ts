import fp from 'fastify-plugin';
import { PERMISSIONS, type Permission } from '@wecom/shared';

/**
 * L3 owns the real `apps/api/src/plugins/auth.ts`. These augmentations describe the same
 * shape so routes can declare `config: { requires: [...] }` before that lane lands; L3's
 * plugin replaces the hook below, not the types.
 */
export interface AuthUser {
  id: string;
  displayName: string;
  roles: string[];
  permissions: Set<string>;
  categoryScopes: string[] | null;
  sessionId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
  interface FastifyContextConfig {
    requires?: Permission[];
    scope?: 'document';
  }
}

export interface TestUserOption {
  id: string;
  displayName: string;
  /** `'all'` grants every permission; otherwise the exact list. */
  permissions: 'all' | Permission[];
  roles?: string[];
  categoryScopes?: string[] | null;
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
  app.addHook('onRequest', async (req, reply) => {
    req.user = {
      id: t.id,
      displayName: t.displayName,
      roles: t.roles ?? [],
      permissions,
      categoryScopes: t.categoryScopes ?? null,
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
