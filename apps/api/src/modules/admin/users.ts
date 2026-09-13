import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminUserPatchSchema,
  PaginationQuerySchema,
  UserRoleSchema,
  UserSchema,
  paginated,
} from '@wecom/shared';
import { HttpError, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';

const UserWithRoles = UserSchema.extend({ roles: z.array(UserRoleSchema) });
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export default async function userRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/users',
    {
      config: { requires: ['users.manage'] },
      schema: {
        tags: ['admin'],
        querystring: PaginationQuerySchema.extend({ q: z.string().optional() }),
        response: { 200: paginated(UserWithRoles) },
      },
    },
    async (req) => {
      const { q, page, pageSize } = req.query;
      const where = q ? `where (u.display_name ilike $1 or u.email ilike $1)` : '';
      const params: unknown[] = q ? [`%${q}%`] : [];
      const total = (
        await app.db.query<{ n: string }>(`select count(*) as n from users u ${where}`, params)
      ).rows[0].n;
      const rows = await app.db.query(
        `select u.* from users u ${where} order by u.display_name limit ${pageSize} offset ${(page - 1) * pageSize}`,
        params,
      );
      const ids = rows.rows.map((u) => u.id);
      const roles = await app.db.query(
        `select ur.user_id, ur.role_id, r.name, ur.category_scope, ur.granted_by, ur.granted_at
           from user_roles ur join roles r on r.id=ur.role_id where ur.user_id = any($1::uuid[]) order by r.name`,
        [ids],
      );
      const items = rows.rows.map((u) => ({
        id: u.id,
        subject: u.subject,
        source: u.source,
        email: u.email,
        displayName: u.display_name,
        initials: u.initials,
        active: u.active,
        lastLoginAt: iso(u.last_login_at),
        roles: roles.rows
          .filter((r) => r.user_id === u.id)
          .map((r) => ({
            userId: r.user_id,
            roleId: r.role_id,
            roleName: r.name,
            categoryScope: r.category_scope,
            grantedBy: r.granted_by,
            grantedAt: new Date(r.granted_at).toISOString(),
          })),
      }));
      return { items, total: Number(total), page, pageSize };
    },
  );

  app.patch(
    '/users/:id',
    {
      config: { requires: ['users.manage'] },
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.string().uuid() }),
        body: AdminUserPatchSchema,
        response: { 200: z.object({ ok: z.literal(true), auditId: z.string() }) },
      },
    },
    async (req) => {
      const { id } = req.params;
      if (req.body.active === false && id === req.user!.id)
        throw new HttpError(409, 'SELF_DEACTIVATE', 'לא ניתן להשבית את המשתמש שלך');
      const client = await app.db.connect();
      try {
        await client.query('begin');
        const before = (
          await client.query(
            `select u.active, (select json_agg(json_build_object('roleId', ur.role_id, 'categoryScope', ur.category_scope)) from user_roles ur where ur.user_id=u.id) as roles
               from users u where u.id=$1`,
            [id],
          )
        ).rows[0];
        if (!before) throw notFound('המשתמש');
        if (req.body.active !== undefined) {
          await client.query(`update users set active=$2, updated_at=now() where id=$1`, [
            id,
            req.body.active,
          ]);
          if (!req.body.active)
            await client.query(`update sessions set revoked_at=now() where user_id=$1 and revoked_at is null`, [
              id,
            ]);
        }
        if (req.body.roles) {
          await client.query(`delete from user_roles where user_id=$1`, [id]);
          for (const r of req.body.roles)
            await client.query(
              `insert into user_roles(user_id, role_id, category_scope, granted_by) values ($1,$2,$3,$4)`,
              [id, r.roleId, r.categoryScope, req.user!.id],
            );
        }
        const auditId = await audit(client, {
          actorId: req.user!.id,
          action: 'admin.user.patch',
          entityType: 'user',
          entityId: id,
          before,
          after: req.body,
          requestId: req.id,
          ip: req.ip,
        });
        await client.query('commit');
        app.authCache.invalidate(id);
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
