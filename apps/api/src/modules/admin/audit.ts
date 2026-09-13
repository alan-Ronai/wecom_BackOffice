import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AuditEntrySchema, AuditQuerySchema, paginated } from '@wecom/shared';

export default async function auditRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/audit',
    {
      config: { requires: ['audit.read'] },
      schema: {
        tags: ['admin'],
        querystring: AuditQuerySchema,
        response: { 200: paginated(AuditEntrySchema) },
      },
    },
    async (req) => {
      const q = req.query;
      const cond: string[] = [];
      const params: unknown[] = [];
      const add = (sql: string, v: unknown) => {
        params.push(v);
        cond.push(sql.replace('?', '$' + params.length));
      };
      if (q.actorId) add('a.actor_id = ?', q.actorId);
      if (q.entityType) add('a.entity_type = ?', q.entityType);
      if (q.entityId) add('a.entity_id = ?', q.entityId);
      if (q.from) add('a.at >= ?', q.from);
      if (q.to) add('a.at <= ?', q.to);
      const where = cond.length ? 'where ' + cond.join(' and ') : '';
      const total = Number(
        (await app.db.query<{ n: string }>(`select count(*) as n from audit_log a ${where}`, params)).rows[0]
          .n,
      );
      const rows = await app.db.query(
        `select a.*, u.display_name as actor_name from audit_log a left join users u on u.id=a.actor_id ${where}
          order by a.at desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`,
        params,
      );
      return {
        items: rows.rows.map((r) => ({
          id: r.id,
          actorId: r.actor_id,
          actorName: r.actor_name,
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          before: r.before,
          after: r.after,
          ip: r.ip,
          requestId: r.request_id,
          at: new Date(r.at).toISOString(),
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
  );
}
