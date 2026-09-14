import type pg from 'pg';

export type RoleRow = { role_name: string; permission: string | null; world_scope: string[] | null };
export type Resolved = {
  roles: string[];
  permissions: Set<string>;
  /** null = every world. Values are `worlds.slug`. */
  worldScopes: string[] | null;
  /** @deprecated alias of `worldScopes`, kept for wave 3 code; removed after wave 4. */
  categoryScopes: string[] | null;
};
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
    if (r.world_scope == null) unrestricted = true;
    else r.world_scope.forEach((c) => scopes.add(c));
  }
  const resolvedScopes = unrestricted ? null : [...scopes].sort();
  return {
    roles: [...roles].sort(),
    permissions,
    worldScopes: resolvedScopes,
    categoryScopes: resolvedScopes,
  };
}

/**
 * A-M14: the scope comes from `user_role_worlds`, not from the `world_scope` array.
 *
 * Both hold the same slugs — `0045`'s trigger mirrors every write to the column into the join
 * table — but only the join table has a foreign key to `worlds(slug)` with `on update cascade`.
 * Read through it and a renamed world keeps scoping the users it scoped before, the same way
 * `documents.category` already follows the rename. Read the array and they would all quietly
 * stop matching.
 *
 * `null` stays "every world": that is the one thing a join table cannot express, so the column
 * is still what says whether the role is scoped at all.
 */
export async function resolvePermissions(db: Queryable, userId: string): Promise<Resolved> {
  const r = await db.query<RoleRow>(
    `select r.name as role_name, rp.permission,
            case when ur.world_scope is null then null
                 else coalesce((select array_agg(urw.world_slug order by urw.world_slug)
                                  from user_role_worlds urw
                                 where urw.user_id = ur.user_id
                                   and urw.role_id = ur.role_id), '{}') end as world_scope
       from user_roles ur
       join roles r on r.id = ur.role_id
       left join role_permissions rp on rp.role_id = r.id
      where ur.user_id = $1
      order by r.name, rp.permission`,
    [userId],
  );
  return mergeRoleRows(r.rows);
}
