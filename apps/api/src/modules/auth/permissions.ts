import type pg from 'pg';

export type RoleRow = { role_name: string; permission: string | null; category_scope: string[] | null };
export type Resolved = { roles: string[]; permissions: Set<string>; categoryScopes: string[] | null };
/**
 * The shape attached to `req.user` by `plugins/auth.ts` (canonical cross-lane name).
 * `displayName` is the additive field L3 contributes on top of the L0 contract.
 */
export type AuthUser = Resolved & { id: string; displayName: string; sessionId: string | null };
export type Queryable = { query: pg.Pool['query'] };

export function mergeRoleRows(rows: RoleRow[]): Resolved {
  const roles = new Set<string>();
  const permissions = new Set<string>();
  let unrestricted = false;
  const scopes = new Set<string>();
  for (const r of rows) {
    roles.add(r.role_name);
    if (r.permission) permissions.add(r.permission);
    if (r.category_scope == null) unrestricted = true;
    else r.category_scope.forEach((c) => scopes.add(c));
  }
  return {
    roles: [...roles].sort(),
    permissions,
    categoryScopes: unrestricted ? null : [...scopes].sort(),
  };
}

export async function resolvePermissions(db: Queryable, userId: string): Promise<Resolved> {
  const r = await db.query<RoleRow>(
    `select r.name as role_name, rp.permission, ur.category_scope
       from user_roles ur
       join roles r on r.id = ur.role_id
       left join role_permissions rp on rp.role_id = r.id
      where ur.user_id = $1
      order by r.name, rp.permission`,
    [userId],
  );
  return mergeRoleRows(r.rows);
}
