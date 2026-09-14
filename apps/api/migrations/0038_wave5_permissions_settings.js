/**
 * Wave 5 (V0): learning/gaps permissions, the `approver` system role, the two new
 * notification kinds, and the `workflow` settings row.
 *
 * Mirrors `packages/shared/src/permissions.ts` (`PERMISSIONS`, `DEFAULT_ROLES`) — the
 * migrations test asserts the two agree, so a grant added on one side only is a red test
 * rather than a permission that silently exists in code and not in the database.
 *
 * `approver` is deliberately *not* the lead role plus one permission: it publishes and
 * applies suggestions without `docs.edit`, which is the whole point of spec §1.6's
 * separation of duties. `workflow.requireApprover` (default off, `0038` seeds `{}` so the
 * schema defaults apply) is what switches the gate on; nothing changes on upgrade.
 *
 * The `notifications.kind` check is a closed inline list first written by `0020_collab.js`
 * and last widened by `0026_notification_kinds.js`; both lists below are copied from the
 * state `0026` leaves, so `down` restores exactly what was live before this migration.
 */

const NEW = [
  ['learning.read', 'learning'],
  ['learning.manage', 'learning'],
  ['learning.publish', 'learning'],
  ['gaps.read', 'gaps'],
  ['gaps.manage', 'gaps'],
];
const GRANTS = {
  agent: ['learning.read'],
  editor: ['learning.read', 'learning.manage', 'gaps.read'],
  lead: ['learning.read', 'learning.manage', 'gaps.read', 'learning.publish', 'gaps.manage'],
  admin: ['learning.read', 'learning.manage', 'gaps.read', 'learning.publish', 'gaps.manage'],
  approver: [
    'docs.read',
    'docs.read_unpublished',
    'notes.write',
    'docs.publish',
    'suggestions.apply',
    'learning.publish',
  ],
};
/** The list `0026_notification_kinds.js` leaves in force, plus wave 5's two. */
const NOTIFICATION_KINDS = [
  'suggestion',
  'sync',
  'mention',
  'review',
  'publish',
  'system',
  'feedback',
  'source',
  'learning',
  'gap',
];
const NOTIFICATION_KINDS_0026 = NOTIFICATION_KINDS.slice(0, -2);

const list = (values) => values.map((v) => `'${v}'`).join(',');

/** node-pg-migrate names an inline column check `<table>_<column>_check` (see 0026). */
const recheck = (pgm, values) => {
  pgm.sql(`alter table notifications drop constraint if exists notifications_kind_check`);
  pgm.sql(`alter table notifications add constraint notifications_kind_check
             check (kind in (${list(values)}))`);
};

exports.up = (pgm) => {
  for (const [name, resource] of NEW)
    pgm.sql(
      `insert into permissions(name, resource) values ('${name}', '${resource}') on conflict (name) do nothing`,
    );
  pgm.sql(
    `insert into roles(name, description, system) values ('approver', 'מאשר תוכן — מפרסם ללא זכויות עריכה', true) on conflict (name) do nothing`,
  );
  for (const [role, perms] of Object.entries(GRANTS))
    for (const p of perms)
      pgm.sql(
        `insert into role_permissions(role_id, permission) select id, '${p}' from roles where name='${role}' on conflict do nothing`,
      );
  recheck(pgm, NOTIFICATION_KINDS);
  // An empty patch: every effective value comes from `WorkflowSettingsSchema`'s defaults
  // until an admin saves `/admin/workflow`, so a later settings key needs no backfill.
  pgm.sql(
    `insert into app_settings(key, value) values ('workflow', '{}'::jsonb) on conflict (key) do nothing`,
  );
};

exports.down = (pgm) => {
  pgm.sql(`delete from app_settings where key='workflow'`);
  // Safe only because nothing has written these kinds yet on a rollback path; delete rather
  // than fail the whole rollback on rows the narrower constraint would reject (same as 0026).
  pgm.sql(`delete from notifications where kind not in (${list(NOTIFICATION_KINDS_0026)})`);
  recheck(pgm, NOTIFICATION_KINDS_0026);
  const perms = list(NEW.map(([n]) => n));
  pgm.sql(`delete from role_permissions where permission in (${perms})`);
  pgm.sql(`delete from role_permissions where role_id in (select id from roles where name='approver')`);
  pgm.sql(`delete from user_roles where role_id in (select id from roles where name='approver')`);
  pgm.sql(`delete from groups_map where role_id in (select id from roles where name='approver')`);
  pgm.sql(`delete from roles where name='approver'`);
  pgm.sql(`delete from permissions where name in (${perms})`);
};
