import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { MeSchema, PreferencesSchema } from '@wecom/shared';
import { HttpError } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { withTransaction } from '../../lib/sql.js';
import { SESSION_COOKIE, cookieOptions } from '../../lib/session.js';
import { verifyPassword } from './local.js';
import { resolvePermissions } from './permissions.js';

const OIDC_COOKIE = 'kb_oidc';
const safeReturnTo = (v: unknown): string => (typeof v === 'string' && /^\/(?!\/)/.test(v) ? v : '/');

export default async function authRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const env = app.config.NODE_ENV;

  app.get(
    '/providers',
    {
      config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        response: {
          200: z.object({
            providers: z.array(z.enum(['entra', 'local'])),
            fallback: z.enum(['none', 'paloalto']),
          }),
        },
      },
    },
    async () => ({
      providers: [...(app.oidc ? (['entra'] as const) : []), 'local' as const],
      fallback: app.config.AUTH_FALLBACK,
    }),
  );

  app.get(
    '/login',
    {
      config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { tags: ['auth'], querystring: z.object({ returnTo: z.string().optional() }) },
    },
    async (req, reply) => {
      if (!app.oidc) throw new HttpError(503, 'PROVIDER_UNAVAILABLE', 'כניסה עם חשבון Microsoft אינה מוגדרת');
      const start = await app.oidc.startLogin();
      reply.setCookie(
        OIDC_COOKIE,
        JSON.stringify({
          state: start.state,
          codeVerifier: start.codeVerifier,
          nonce: start.nonce,
          returnTo: safeReturnTo(req.query.returnTo),
        }),
        { ...cookieOptions(env), maxAge: 600, signed: true },
      );
      return reply.redirect(start.url, 302);
    },
  );

  app.get(
    '/callback',
    {
      config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { tags: ['auth'], hide: true },
    },
    async (req, reply) => {
      if (!app.oidc) throw new HttpError(503, 'PROVIDER_UNAVAILABLE', 'כניסה עם חשבון Microsoft אינה מוגדרת');
      const raw = req.cookies[OIDC_COOKIE];
      const unsigned = raw ? req.unsignCookie(raw) : null;
      if (!unsigned || !unsigned.valid || !unsigned.value)
        throw new HttpError(401, 'UNAUTHENTICATED', 'תהליך הכניסה פג תוקף, נסה שוב');
      // A truncated-but-validly-signed cookie must be the intended 401, not a 500.
      let st: { state: string; codeVerifier: string; nonce: string; returnTo: string };
      try {
        st = JSON.parse(unsigned.value) as typeof st;
      } catch {
        throw new HttpError(401, 'UNAUTHENTICATED', 'תהליך הכניסה פג תוקף, נסה שוב');
      }
      const current = new URL(req.url, app.config.OIDC_REDIRECT_URI);
      let result;
      try {
        result = await app.oidc.finishLogin(current, st);
      } catch (e) {
        req.log.warn({ err: e }, 'oidc callback failed');
        throw new HttpError(401, 'UNAUTHENTICATED', 'הכניסה נכשלה, נסה שוב');
      }
      const groups = result.groupsOverflow
        ? await app.oidc.fetchGroupsFromGraph(result.subject)
        : result.groups;
      const { id } = await app.identity.upsertUser({
        subject: result.subject,
        source: 'entra',
        email: result.email,
        displayName: result.displayName,
      });
      const changes = await app.identity.applyGroupMap(id, groups);
      const s = await app.sessions.create(id, req.ip, req.headers['user-agent'] ?? null);
      await withTransaction(app.db, (tx) =>
        audit(tx, {
          actorId: id,
          action: 'auth.login',
          entityType: 'user',
          entityId: id,
          before: null,
          after: { provider: 'entra', groups: groups.length, roles: changes },
          requestId: req.id,
          ip: req.ip,
        }),
      );
      reply.setCookie(SESSION_COOKIE, s.token, cookieOptions(env));
      reply.clearCookie(OIDC_COOKIE, { path: '/' });
      return reply.redirect(app.config.PUBLIC_URL.replace(/\/$/, '') + st.returnTo, 302);
    },
  );

  app.post(
    '/logout',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { tags: ['auth'], response: { 200: z.object({ ok: z.literal(true) }) } },
    },
    async (req, reply) => {
      const user = req.user!;
      if (user.sessionId) await app.sessions.revoke(user.sessionId);
      app.authCache.invalidate(user.id);
      await withTransaction(app.db, (tx) =>
        audit(tx, {
          actorId: user.id,
          action: 'auth.logout',
          entityType: 'user',
          entityId: user.id,
          before: null,
          after: null,
          requestId: req.id,
          ip: req.ip,
        }),
      );
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true as const };
    },
  );

  app.post(
    '/local',
    {
      config: { public: true, rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        body: z.object({ email: z.string().min(3), password: z.string().min(1) }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req, reply) => {
      const r = await app.db.query<{ id: string; password_hash: string | null }>(
        `select id, password_hash from users where lower(email)=$1 and source='local' and active`,
        [req.body.email.toLowerCase()],
      );
      const u = r.rows[0];
      if (!u || !(await verifyPassword(u.password_hash, req.body.password)))
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'אימייל או סיסמה שגויים');
      await app.db.query(`update users set last_login_at=now() where id=$1`, [u.id]);
      const s = await app.sessions.create(u.id, req.ip, req.headers['user-agent'] ?? null);
      await withTransaction(app.db, (tx) =>
        audit(tx, {
          actorId: u.id,
          action: 'auth.login.local',
          entityType: 'user',
          entityId: u.id,
          before: null,
          after: null,
          requestId: req.id,
          ip: req.ip,
        }),
      );
      reply.setCookie(SESSION_COOKIE, s.token, cookieOptions(env));
      return { ok: true as const };
    },
  );

  app.get('/me', { schema: { tags: ['auth'], response: { 200: MeSchema } } }, async (req) => {
    const u = req.user!;
    const row = (
      await app.db.query(
        `select u.id, u.subject, u.source, u.email, u.display_name, u.initials, u.active, u.last_login_at, p.prefs
           from users u left join user_preferences p on p.user_id=u.id where u.id=$1`,
        [u.id],
      )
    ).rows[0];
    // The session's user row can have been hard-deleted between requests.
    if (!row) throw new HttpError(401, 'UNAUTHENTICATED', 'המשתמש אינו קיים עוד');
    const resolved = await resolvePermissions(app.db, u.id);
    return MeSchema.parse({
      user: {
        id: row.id,
        subject: row.subject,
        source: row.source,
        email: row.email,
        displayName: row.display_name,
        initials: row.initials,
        active: row.active,
        lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
      },
      roles: resolved.roles,
      permissions: [...resolved.permissions],
      categoryScopes: resolved.categoryScopes,
      worldScopes: resolved.worldScopes,
      preferences: PreferencesSchema.parse(row.prefs ?? {}),
    });
  });
}
