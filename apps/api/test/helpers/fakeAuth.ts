import fp from 'fastify-plugin';
import type { ReqUser } from '../../src/lib/user.js';

/** Test-only: `x-test-user: {"id":"…","permissions":["docs.read"],"categoryScopes":null}` */
export default fp(async (app) => {
  app.addHook('onRequest', async (req) => {
    const raw = req.headers['x-test-user'];
    if (typeof raw !== 'string') return;
    const u = JSON.parse(raw) as {
      id: string;
      displayName?: string;
      roles?: string[];
      permissions: string[];
      categoryScopes: string[] | null;
      worldScopes?: string[] | null;
    };
    const scopes = u.worldScopes ?? u.categoryScopes ?? null;
    req.user = {
      id: u.id,
      displayName: u.displayName ?? 'משתמש בדיקה',
      roles: u.roles ?? [],
      sessionId: null,
      permissions: new Set(u.permissions),
      worldScopes: scopes,
      categoryScopes: scopes,
    } satisfies ReqUser;
  });
  // Minimal mirror of L3's enforcement so route `config.requires` is exercised in tests.
  app.addHook('preHandler', async (req) => {
    const requires = ((req.routeOptions.config ?? {}) as { requires?: string[] }).requires ?? [];
    if (!requires.length) return;
    if (!req.user)
      throw Object.assign(new Error('נדרשת כניסה למערכת'), {
        statusCode: 401,
        code: 'UNAUTHENTICATED',
      });
    for (const p of requires)
      if (!req.user.permissions.has(p))
        throw Object.assign(new Error('אין הרשאה לפעולה זו'), { statusCode: 403, code: 'FORBIDDEN' });
  });
});
