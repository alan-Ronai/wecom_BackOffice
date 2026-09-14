import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ADMIN_LOCKED, RoleMatrixSchema, RoleSchema, RoleUpsertSchema, type Permission } from '@wecom/shared';
import { HttpError, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';

async function loadRole(app: FastifyInstance, id: string) {
  const r = (
    await app.db.query(
      `select r.*, coalesce((select array_agg(permission order by permission) from role_permissions where role_id=r.id), '{}') as permissions
         from roles r where r.id=$1`,
      [id],
    )
  ).rows[0];
  if (!r) throw notFound('התפקיד');
  return {
    id: r.id as string,
    name: r.name as string,
    description: r.description as string,
    system: r.system as boolean,
    permissions: r.permissions as Permission[],
  };
}

export default async function roleRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/roles',
    {
      config: { requires: ['roles.manage'] },
      schema: { tags: ['admin'], response: { 200: z.object({ items: z.array(RoleSchema) }) } },
    },
    async () => {
      const r = await app.db.query(
        `select r.id, r.name, r.description, r.system,
                coalesce((select array_agg(permission order by permission) from role_permissions where role_id=r.id), '{}') as permissions
           from roles r order by r.system desc, r.name`,
      );
      return { items: r.rows };
    },
  );

  /**
   * Stage-5 §admin. The whole permission grid in one request: every permission with its
   * resource and description, every role with the permissions it grants and how many
   * people hold it. Built from the `permissions` table rather than the TypeScript
   * catalogue so a permission added by a migration shows up without a redeploy.
   */
  app.get(
    '/roles/matrix',
    {
      config: { requires: ['roles.manage'] },
      schema: { tags: ['admin'], response: { 200: RoleMatrixSchema } },
    },
    async () => {
      const [perms, roles] = await Promise.all([
        app.db.query(`select name, resource, description from permissions order by resource, name`),
        app.db.query(
          `select r.id, r.name, r.system,
                  coalesce((select array_agg(permission order by permission) from role_permissions where role_id=r.id), '{}') as permissions,
                  (select count(*)::int from user_roles ur where ur.role_id = r.id) as users
             from roles r order by r.system desc, r.name`,
        ),
      ]);
      return {
        permissions: perms.rows.map((p) => ({
          name: p.name as Permission,
          resource: p.resource as string,
          description: (p.description as string) ?? '',
        })),
        roles: roles.rows.map((r) => ({
          id: r.id as string,
          name: r.name as string,
          system: r.system as boolean,
          permissions: r.permissions as Permission[],
          users: r.users as number,
        })),
      };
    },
  );

  app.post(
    '/roles',
    {
      config: { requires: ['roles.manage'] },
      schema: {
        tags: ['admin'],
        body: RoleUpsertSchema,
        response: { 200: RoleSchema.extend({ auditId: z.string() }) },
      },
    },
    async (req) => {
      const client = await app.db.connect();
      try {
        await client.query('begin');
        const exists = await client.query(`select 1 from roles where name=$1`, [req.body.name]);
        if (exists.rowCount) throw new HttpError(409, 'ROLE_EXISTS', 'תפקיד בשם זה כבר קיים');
        const id = (
          await client.query<{ id: string }>(
            `insert into roles(name, description) values ($1,$2) returning id`,
            [req.body.name, req.body.description],
          )
        ).rows[0].id;
        for (const p of req.body.permissions)
          await client.query(`insert into role_permissions(role_id, permission) values ($1,$2)`, [id, p]);
        const auditId = await audit(client, {
          actorId: req.user!.id,
          action: 'admin.role.create',
          entityType: 'role',
          entityId: id,
          before: null,
          after: req.body,
          requestId: req.id,
          ip: req.ip,
        });
        await client.query('commit');
        return { ...(await loadRole(app, id)), auditId };
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    },
  );

  app.patch(
    '/roles/:id',
    {
      config: { requires: ['roles.manage'] },
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.string().uuid() }),
        body: RoleUpsertSchema.partial(),
        response: { 200: RoleSchema.extend({ auditId: z.string() }) },
      },
    },
    async (req) => {
      const before = await loadRole(app, req.params.id);
      if (
        before.name === 'admin' &&
        req.body.permissions &&
        ADMIN_LOCKED.some((p) => !req.body.permissions!.includes(p))
      )
        throw new HttpError(
          409,
          'LOCKED_PERMISSION',
          'תפקיד admin חייב לשמור על roles.manage ו-users.manage',
        );
      if (before.system && req.body.name && req.body.name !== before.name)
        throw new HttpError(409, 'SYSTEM_ROLE', 'לא ניתן לשנות שם של תפקיד מערכת');
      const client = await app.db.connect();
      try {
        await client.query('begin');
        await client.query(
          `update roles set name=coalesce($2,name), description=coalesce($3,description) where id=$1`,
          [before.id, req.body.name ?? null, req.body.description ?? null],
        );
        if (req.body.permissions) {
          await client.query(`delete from role_permissions where role_id=$1`, [before.id]);
          for (const p of req.body.permissions)
            await client.query(`insert into role_permissions(role_id, permission) values ($1,$2)`, [
              before.id,
              p,
            ]);
        }
        const auditId = await audit(client, {
          actorId: req.user!.id,
          action: 'admin.role.patch',
          entityType: 'role',
          entityId: before.id,
          before,
          after: req.body,
          requestId: req.id,
          ip: req.ip,
        });
        await client.query('commit');
        app.authCache.clear();
        return { ...(await loadRole(app, before.id)), auditId };
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    },
  );

  app.delete(
    '/roles/:id',
    {
      config: { requires: ['roles.manage'] },
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true), auditId: z.string() }) },
      },
    },
    async (req) => {
      const before = await loadRole(app, req.params.id);
      if (before.system) throw new HttpError(409, 'SYSTEM_ROLE', 'לא ניתן למחוק תפקיד מערכת');
      const client = await app.db.connect();
      try {
        await client.query('begin');
        await client.query(`delete from roles where id=$1`, [before.id]);
        const auditId = await audit(client, {
          actorId: req.user!.id,
          action: 'admin.role.delete',
          entityType: 'role',
          entityId: before.id,
          before,
          after: null,
          requestId: req.id,
          ip: req.ip,
        });
        await client.query('commit');
        app.authCache.clear();
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
