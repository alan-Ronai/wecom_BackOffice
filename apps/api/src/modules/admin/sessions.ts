import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SessionSchema } from '@wecom/shared';
import { notFound } from '../../lib/errors.js';

export default async function sessionRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/sessions',
    {
      config: { requires: ['users.manage'] },
      schema: {
        tags: ['admin'],
        querystring: z.object({ userId: z.string().uuid().optional() }),
        response: { 200: z.object({ items: z.array(SessionSchema) }) },
      },
    },
    async (req) => {
      const r = await app.db.query(
        `select id, user_id, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at from sessions
          where revoked_at is null and expires_at > now() ${req.query.userId ? 'and user_id=$1' : ''}
          order by last_seen_at desc limit 500`,
        req.query.userId ? [req.query.userId] : [],
      );
      return {
        items: r.rows.map((s) => ({
          id: s.id,
          userId: s.user_id,
          ip: s.ip,
          userAgent: s.user_agent,
          createdAt: new Date(s.created_at).toISOString(),
          lastSeenAt: new Date(s.last_seen_at).toISOString(),
          expiresAt: new Date(s.expires_at).toISOString(),
          revokedAt: null,
        })),
      };
    },
  );

  app.delete(
    '/sessions/:id',
    {
      config: { requires: ['users.manage'] },
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true), auditId: z.string() }) },
      },
    },
    async (req) => {
      const s = (await app.db.query(`select user_id from sessions where id=$1`, [req.params.id])).rows[0];
      if (!s) throw notFound('ההתחברות');
      await app.sessions.revoke(req.params.id);
      app.authCache.invalidate(s.user_id);
      const auditId = await app.audit(req, 'admin.session.revoke', 'session', req.params.id, {
        userId: s.user_id,
      });
      return { ok: true as const, auditId };
    },
  );
}
