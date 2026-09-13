const PERMISSIONS = ['docs.read','docs.create','docs.edit','docs.publish','docs.delete','docs.restore','blocks.edit','fields.edit','scripts.edit','notes.write','notes.moderate','suggestions.review','suggestions.apply','sources.manage','connectors.manage','users.manage','roles.manage','audit.read','system.admin'];
const agent = ['docs.read','notes.write'];
const editor = [...agent,'docs.create','docs.edit','suggestions.review','scripts.edit'];
const lead = [...editor,'docs.publish','docs.delete','docs.restore','blocks.edit','fields.edit','suggestions.apply','sources.manage','notes.moderate'];
const ROLES = { agent, editor, lead, admin: PERMISSIONS };
exports.up = (pgm) => {
  pgm.createTable('users', { id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') }, subject: { type: 'text', notNull: true }, source: { type: 'text', notNull: true, check: "source in ('entra','paloalto','local')" }, email: 'text', display_name: { type: 'text', notNull: true }, initials: { type: 'text', notNull: true, default: '' }, active: { type: 'boolean', notNull: true, default: true }, password_hash: 'text', last_login_at: 'timestamptz', created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }, updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') } });
  pgm.addConstraint('users', 'users_subject_source_unique', { unique: ['subject', 'source'] });
  pgm.createIndex('users', 'lower(email)', { name: 'users_email_idx' });
  pgm.createTable('roles', { id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') }, name: { type: 'text', notNull: true, unique: true }, description: { type: 'text', notNull: true, default: '' }, system: { type: 'boolean', notNull: true, default: false }, created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') } });
  pgm.createTable('permissions', { name: { type: 'text', primaryKey: true }, resource: { type: 'text', notNull: true }, description: { type: 'text', notNull: true, default: '' } });
  pgm.createTable('role_permissions', { role_id: { type: 'uuid', notNull: true, references: 'roles', onDelete: 'cascade' }, permission: { type: 'text', notNull: true, references: 'permissions', onDelete: 'cascade' } }, { constraints: { primaryKey: ['role_id', 'permission'] } });
  pgm.createTable('user_roles', { user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' }, role_id: { type: 'uuid', notNull: true, references: 'roles', onDelete: 'cascade' }, category_scope: 'text[]', granted_by: { type: 'uuid', references: 'users' }, granted_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') } }, { constraints: { primaryKey: ['user_id', 'role_id'] } });
  pgm.createTable('groups_map', { idp_group_id: { type: 'text', primaryKey: true }, idp_group_name: { type: 'text', notNull: true }, role_id: { type: 'uuid', notNull: true, references: 'roles', onDelete: 'cascade' } });
  for (const p of PERMISSIONS) pgm.sql(`insert into permissions(name, resource) values ('${p}', '${p.split('.')[0]}')`);
  for (const [name, perms] of Object.entries(ROLES)) { pgm.sql(`insert into roles(name, system) values ('${name}', true)`); for (const p of perms) pgm.sql(`insert into role_permissions(role_id, permission) select id, '${p}' from roles where name='${name}'`); }
};
exports.down = (pgm) => { pgm.dropTable('groups_map'); pgm.dropTable('user_roles'); pgm.dropTable('role_permissions'); pgm.dropTable('permissions'); pgm.dropTable('roles'); pgm.dropTable('users'); };
