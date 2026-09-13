import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { GroupMapPutSchema, GroupMapSchema } from '@wecom/shared';
import { audit } from '../../lib/audit.js';

export default async function groupsMapRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/groups-map',
    {
      config: { requires: ['roles.manage'] },
      schema: { tags: ['admin'], response: { 200: z.object({ entries: z.array(GroupMapSchema) }) } },
    },
    async () => {
      const r = await app.db.query(
        `select idp_group_id, idp_group_name, role_id from groups_map order by idp_group_name`,
      );
      return {
        entries: r.rows.map((x) => ({
          idpGroupId: x.idp_group_id,
          idpGroupName: x.idp_group_name,
          roleId: x.role_id,
        })),
      };
    },
  );

  app.put(
    '/groups-map',
    {
      config: { requires: ['roles.manage'] },
      schema: {
        tags: ['admin'],
        body: GroupMapPutSchema,
        response: { 200: z.object({ ok: z.literal(true), auditId: z.string() }) },
      },
    },
    async (req) => {
      const client = await app.db.connect();
      try {
        await client.query('begin');
        const before = (await client.query(`select idp_group_id, idp_group_name, role_id from groups_map`))
          .rows;
        await client.query(`delete from groups_map`);
        for (const e of req.body.entries)
          await client.query(
            `insert into groups_map(idp_group_id, idp_group_name, role_id) values ($1,$2,$3)`,
            [e.idpGroupId, e.idpGroupName, e.roleId],
          );
        const auditId = await audit(client, {
          actorId: req.user!.id,
          action: 'admin.groups_map.put',
          entityType: 'groups_map',
          entityId: null,
          before,
          after: req.body.entries,
          requestId: req.id,
          ip: req.ip,
        });
        await client.query('commit');
        return { ok: true as const, auditId };
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    },
  );
}
