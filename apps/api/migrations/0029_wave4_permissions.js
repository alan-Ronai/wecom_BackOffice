/** Wave 4 (W0): four permissions + default role grants. Mirrors packages/shared/src/permissions.ts. */
const NEW = [
  ['taxonomy.manage', 'taxonomy'],
  ['docs.read_unpublished', 'docs'],
  ['feedback.manage', 'feedback'],
  ['analytics.read', 'analytics'],
];
const GRANTS = {
  editor: ['docs.read_unpublished', 'feedback.manage', 'analytics.read'],
  lead: ['docs.read_unpublished', 'feedback.manage', 'analytics.read', 'taxonomy.manage'],
  admin: ['docs.read_unpublished', 'feedback.manage', 'analytics.read', 'taxonomy.manage'],
};
exports.up = (pgm) => {
  for (const [name, resource] of NEW)
    pgm.sql(
      `insert into permissions(name, resource) values ('${name}', '${resource}') on conflict (name) do nothing`,
    );
  for (const [role, perms] of Object.entries(GRANTS))
    for (const p of perms)
      pgm.sql(
        `insert into role_permissions(role_id, permission) select id, '${p}' from roles where name='${role}' on conflict do nothing`,
      );
};
exports.down = (pgm) => {
  const list = NEW.map(([n]) => `'${n}'`).join(',');
  pgm.sql(`delete from role_permissions where permission in (${list})`);
  pgm.sql(`delete from permissions where name in (${list})`);
};
