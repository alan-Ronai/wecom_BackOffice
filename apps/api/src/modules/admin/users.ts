import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminUserCreateSchema,
  AdminUserPatchSchema,
  AdminUserRowSchema,
  AdminUsersQuerySchema,
  UserRoleSchema,
  UserSchema,
  paginated,
} from '@wecom/shared';
import { HttpError, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { hashPassword } from '../auth/local.js';
import { initials as initialsOf } from '../auth/identity.js';

const UserWithRoles = UserSchema.extend({ roles: z.array(UserRoleSchema) });
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export default async function userRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  /**
   * Stage-5 §admin. The people page: roles with their category scopes, the IdP groups
   * that grant them, how many sessions are live right now, and filters on free text,
   * identity source, role name and active state. `groups` is derived from `groups_map`
   * rather than stored per user — a group only matters here because it maps to a role.
   */
  app.get(
    '/users',
    {
      config: { requires: ['users.manage'] },
      schema: {
        tags: ['admin'],
        querystring: AdminUsersQuerySchema,
        response: { 200: paginated(AdminUserRowSchema) },
      },
    },
    async (req) => {
      const { q, page, pageSize, source, role, active } = req.query;
      const cond: string[] = [];
      const params: unknown[] = [];
      const add = (sql: string, v: unknown) => {
        params.push(v);
        cond.push(sql.replace(/\?/g, '$' + params.length));
      };
      if (q) add('(u.display_name ilike ? or u.email ilike ? or u.subject ilike ?)', `%${q}%`);
      if (source) add('u.source = ?', source);
      if (active !== undefined) add('u.active = ?', active);
      if (role)
        add(
          'exists (select 1 from user_roles ur join roles r on r.id=ur.role_id where ur.user_id=u.id and r.name = ?)',
          role,
        );
      const where = cond.length ? 'where ' + cond.join(' and ') : '';
      const total = (await app.db.query<{ n: string }>(`select count(*) as n from users u ${where}`, params))
        .rows[0].n;
      const rows = await app.db.query(
        `select u.*,
                (select count(*)::int from sessions s
                  where s.user_id = u.id and s.revoked_at is null and s.expires_at > now()) as sessions
           from users u ${where} order by u.display_name
           limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, pageSize, (page - 1) * pageSize],
      );
      const ids = rows.rows.map((u) => u.id);
      const roles = await app.db.query(
        `select ur.user_id, ur.role_id, r.name, ur.category_scope
           from user_roles ur join roles r on r.id=ur.role_id where ur.user_id = any($1::uuid[]) order by r.name`,
        [ids],
      );
      const groups = await app.db.query(
        `select distinct ur.user_id, gm.idp_group_name
           from user_roles ur join groups_map gm on gm.role_id = ur.role_id
          where ur.user_id = any($1::uuid[]) order by gm.idp_group_name`,
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
        createdAt: new Date(u.created_at).toISOString(),
        sessions: u.sessions as number,
        roles: roles.rows
          .filter((r) => r.user_id === u.id)
          .map((r) => ({ roleId: r.role_id, roleName: r.name, categoryScope: r.category_scope })),
        groups: groups.rows.filter((g) => g.user_id === u.id).map((g) => g.idp_group_name as string),
      }));
      return { items, total: Number(total), page, pageSize };
    },
  );

  /**
   * Stage-1 §4. Creating a local (non-federated) user was previously only possible
   * through the `create-admin` CLI, so an operator could not add a break-glass or
   * service account from the admin UI at all.
   */
  app.post(
    '/users',
    {
      config: { requires: ['users.manage'] },
      schema: {
        tags: ['admin'],
        body: AdminUserCreateSchema,
        response: { 201: UserWithRoles },
      },
    },
    async (req, reply) => {
      const { email, password, displayName, roles } = req.body;
      const subject = email.toLowerCase();
      const name = displayName ?? subject.split('@')[0];
      const hash = await hashPassword(password);
      const client = await app.db.connect();
      try {
        await client.query('begin');
        const existing = await client.query<{ id: string }>(
          `select id from users where subject=$1 and source='local'`,
          [subject],
        );
        if (existing.rowCount) throw new HttpError(409, 'USER_EXISTS', 'משתמש מקומי עם כתובת זו כבר קיים');
        const created = await client.query(
          `insert into users(subject, source, email, display_name, initials, password_hash)
           values ($1,'local',$1,$2,$3,$4) returning *`,
          [subject, name, initialsOf(name), hash],
        );
        const user = created.rows[0];
        for (const r of roles ?? [])
          await client.query(
            `insert into user_roles(user_id, role_id, category_scope, granted_by) values ($1,$2,$3,$4)`,
            [user.id, r.roleId, r.categoryScope, req.user!.id],
          );
        await audit(client, {
          actorId: req.user!.id,
          action: 'admin.user.create',
          entityType: 'user',
          entityId: user.id as string,
          before: null,
          // Never the password or its hash.
          after: { subject, displayName: name, roles: (roles ?? []).map((r) => r.roleId) },
          requestId: req.id,
          ip: req.ip,
        });
        const granted = await client.query(
          `select ur.user_id, ur.role_id, r.name, ur.category_scope, ur.granted_by, ur.granted_at
             from user_roles ur join roles r on r.id=ur.role_id where ur.user_id=$1 order by r.name`,
          [user.id],
        );
        await client.query('commit');
        reply.code(201);
        return {
          id: user.id,
          subject: user.subject,
          source: user.source,
          email: user.email,
          displayName: user.display_name,
          initials: user.initials,
          active: user.active,
          lastLoginAt: iso(user.last_login_at),
          roles: granted.rows.map((r) => ({
            userId: r.user_id,
            roleId: r.role_id,
            roleName: r.name,
            categoryScope: r.category_scope,
            grantedBy: r.granted_by,
            grantedAt: new Date(r.granted_at).toISOString(),
          })),
        };
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
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
            await client.query(
              `update sessions set revoked_at=now() where user_id=$1 and revoked_at is null`,
              [id],
            );
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
