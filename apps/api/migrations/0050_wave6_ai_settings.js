/**
 * Wave 6 (X0): the AI copilot's permissions and its settings rows.
 *
 * Mirrors `packages/shared/src/permissions.ts` (`PERMISSIONS`, `DEFAULT_ROLES`) — the
 * migrations test asserts the two agree role by role, so a grant added on one side only is a
 * red test rather than a permission that silently exists in code and not in the database.
 *
 * The three permissions are deliberately not one: `ai.ask` is read-only question answering an
 * agent gets, `ai.chat` is the editor tool set (read the source and the impact, propose edits,
 * refine a suggestion — none of which writes on its own, spec §1.3), and `ai.manage` is the
 * brief, the model slots and the eval harness, which stay admin-only. `approver` gets none of
 * them: it signs off on content, it does not author it.
 *
 * `ai_setting_versions` is the history behind `currentPromptVersion` — `v3.<brief>.<style>` is
 * stamped on every suggestion and every message, and without the row it names, "the model got
 * worse after we changed the brief" is an unanswerable question. Nothing in this wave deletes
 * from it.
 *
 * The four `app_settings` rows are seeded `{}`: every effective value comes from
 * `AiSettingsSchema`'s defaults until an admin saves `/admin/ai`, so a settings key added in a
 * later wave needs no migration and no backfill (the same rule 0038 set for `workflow`).
 */

const NEW = [
  ['ai.ask', 'ai'],
  ['ai.chat', 'ai'],
  ['ai.manage', 'ai'],
];
/** Copied from `DEFAULT_ROLES`; `approver` deliberately absent. */
const GRANTS = {
  agent: ['ai.ask'],
  editor: ['ai.ask', 'ai.chat'],
  lead: ['ai.ask', 'ai.chat'],
  admin: ['ai.ask', 'ai.chat', 'ai.manage'],
};
const SETTINGS_KEYS = ['ai.brief', 'ai.style', 'ai.models', 'ai.limits'];

const list = (values) => values.map((v) => `'${v}'`).join(',');

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
  pgm.sql(`create table if not exists ai_setting_versions (
             id uuid primary key default gen_random_uuid(),
             key text not null,
             version int not null,
             value jsonb not null,
             updated_by uuid references users(id) on delete set null,
             updated_at timestamptz not null default now(),
             unique (key, version)
           )`);
  // Reading the history of one key in order is the only query this table has.
  pgm.sql(
    `create index if not exists ai_setting_versions_key_version_idx on ai_setting_versions (key, version desc)`,
  );
  for (const key of SETTINGS_KEYS)
    pgm.sql(
      `insert into app_settings(key, value) values ('${key}', '{}'::jsonb) on conflict (key) do nothing`,
    );
};

exports.down = (pgm) => {
  pgm.sql(`delete from app_settings where key in (${list(SETTINGS_KEYS)})`);
  pgm.sql(`drop table if exists ai_setting_versions`);
  const perms = list(NEW.map(([n]) => n));
  pgm.sql(`delete from role_permissions where permission in (${perms})`);
  pgm.sql(`delete from permissions where name in (${perms})`);
};
