import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Permission } from '@wecom/shared';
import { SESSION_COOKIE, cookieOptions, shouldSlide } from '../lib/session.js';
import { HttpError, unauthenticated, forbidden } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { withTransaction } from '../lib/sql.js';
import { resolvePermissions, type AuthUser } from '../modules/auth/permissions.js';
import { SessionStore } from '../modules/auth/session-store.js';

export type FallbackIdentify = (req: FastifyRequest, reply: FastifyReply) => Promise<AuthUser | null>;

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
  interface FastifyContextConfig {
    requires?: Permission[];
    scope?: 'document';
    public?: boolean;
  }
  interface FastifyInstance {
    sessions: SessionStore;
    authCache: { invalidate(userId: string): void; clear(): void };
    setFallbackIdentify(fn: FallbackIdentify | null): void;
    /**
     * Convenience wrapper over `lib/audit.ts` for route handlers that are not
     * already inside a transaction: fills actorId/requestId/ip from the request.
     */
    audit(
      req: FastifyRequest,
      action: string,
      entityType: string,
      entityId: string | null,
      before?: unknown,
      after?: unknown,
    ): Promise<string>;
  }
}

const CACHE_TTL_MS = 60_000;

/**
 * Infrastructure routes owned by other lanes that must answer without a session.
 * Route-level `config.public` is the normal way to opt out of authentication.
 *
 * `/api/docs/json` exposes the whole API surface unauthenticated. That is a
 * deliberate choice for a closed-LAN deployment (the generated client and
 * `deploy/*-check.sh` read it before anyone can log in); it leaks route and schema
 * names only, never data. Drop it from this set if the API is ever exposed wider.
 */
const PUBLIC_PATHS = new Set(['/api/v1/system/health', '/api/docs/json']);

export function checkScope(user: AuthUser, worlds: string | readonly string[]): boolean {
  if (user.worldScopes == null) return true;
  const list = typeof worlds === 'string' ? [worlds] : worlds;
  return list.some((w) => user.worldScopes!.includes(w));
}

export default fp(async (app) => {
  const sessions = new SessionStore(app.db);
  const cache = new Map<string, { at: number; value: AuthUser }>(); // key: sessionId
  const byUser = new Map<string, Set<string>>();
  let fallbackIdentify: FallbackIdentify | null = null;

  app.decorate('sessions', sessions);
  app.decorate('authCache', {
    invalidate(userId: string) {
      for (const sid of byUser.get(userId) ?? []) cache.delete(sid);
      byUser.delete(userId);
    },
    clear() {
      cache.clear();
      byUser.clear();
    },
  });
  app.decorate('setFallbackIdentify', (fn: FallbackIdentify | null) => {
    fallbackIdentify = fn;
  });
  app.decorate(
    'audit',
    (
      req: FastifyRequest,
      action: string,
      entityType: string,
      entityId: string | null,
      before: unknown = null,
      after: unknown = null,
    ) =>
      withTransaction(app.db, (tx) =>
        audit(tx, {
          actorId: req.user?.id ?? null,
          action,
          entityType,
          entityId,
          before,
          after,
          requestId: req.id,
          ip: req.ip,
        }),
      ),
  );
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const s = await sessions.find(token);
      if (s) {
        const hit = cache.get(s.id);
        if (hit && Date.now() - hit.at < CACHE_TTL_MS) req.user = hit.value;
        else {
          const resolved = await resolvePermissions(app.db, s.userId);
          req.user = { id: s.userId, displayName: s.displayName, sessionId: s.id, ...resolved };
          cache.set(s.id, { at: Date.now(), value: req.user });
          if (!byUser.has(s.userId)) byUser.set(s.userId, new Set());
          byUser.get(s.userId)!.add(s.id);
        }
        if (shouldSlide(s.lastSeenAt, new Date())) {
          await sessions.touch(s.id);
          reply.setCookie(SESSION_COOKIE, token, cookieOptions(app.config.NODE_ENV, await sessions.ttlMs()));
        }
      }
    }
    if (!req.user && fallbackIdentify) req.user = await fallbackIdentify(req, reply);
  });

  app.addHook('preHandler', async (req) => {
    const cfg = req.routeOptions.config ?? {};
    if (cfg.public || PUBLIC_PATHS.has(req.routeOptions.url ?? '')) return;
    if (!req.user) throw unauthenticated();
    for (const p of cfg.requires ?? []) if (!req.user.permissions.has(p)) throw forbidden(p);
    if (cfg.scope === 'document') {
      const id = (req.params as { id?: string }).id;
      const r = await app.db.query<{ worlds: string[] | null }>(
        `select (select array_agg(dw.world_slug order by (dw.world_slug = d.category) desc, dw.world_slug)
                   from document_worlds dw where dw.document_id = d.id) worlds
           from documents d where d.id = $1 and d.deleted_at is null`,
        [id],
      );
      if (!r.rows[0]) throw new HttpError(404, 'NOT_FOUND', 'המסמך לא נמצא');
      const worlds = r.rows[0].worlds ?? [];
      if (!checkScope(req.user, worlds))
        throw new HttpError(403, 'SCOPE_DENIED', 'ההרשאה שלך מוגבלת לעולמות תוכן אחרים', {
          worlds,
          scopes: req.user.worldScopes,
        });
    }
  });
});
