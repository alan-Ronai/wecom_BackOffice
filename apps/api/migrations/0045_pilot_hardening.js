/**
 * Pilot hardening — the acceptance review's "can wait" backend items, in one migration.
 *
 * 1. `webhook_nonces` (I7 residual) — replay protection for `POST /connectors/:id/webhook`.
 *    `assertFresh` already bounds how *old* a captured request may be (five minutes); nothing
 *    stopped the same signed bytes being posted a hundred times inside that window. One row per
 *    accepted webhook, keyed by a hash of the exact request body, makes the second one a 409.
 *
 * 2. `user_role_worlds` (A-M14) — the foreign key `user_roles.world_scope` could not have.
 *    `documents.category` references `worlds(slug)` with `on update cascade`, so a renamed world
 *    takes its documents with it; a `text[]` column cannot carry a plain FK, so every user's
 *    scope would have silently stopped matching. The join table is that FK, and two triggers
 *    keep it and the array column from drifting apart.
 *
 * `down` reverses everything so `migrations.test.ts`'s full rollback stays green.
 */

exports.up = (pgm) => {
  // ── 1. webhook replay protection (I7) ──────────────────────────────────
  pgm.createTable(
    'webhook_nonces',
    {
      connector_id: { type: 'uuid', notNull: true, references: 'connectors', onDelete: 'cascade' },
      // sha256 of the raw request body, hex. See `connectors/nonces.ts` for why the body and
      // not the `X-KB-Nonce` header is what gets hashed.
      nonce: { type: 'text', notNull: true },
      seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
    { constraints: { primaryKey: ['connector_id', 'nonce'] } },
  );
  // The TTL purge deletes by age across every connector, so the index is on `seen_at` alone.
  pgm.createIndex('webhook_nonces', 'seen_at', { name: 'webhook_nonces_seen_at_index' });

  // ── 2. user_roles.world_scope → worlds(slug) (A-M14) ───────────────────
  pgm.createTable(
    'user_role_worlds',
    {
      user_id: { type: 'uuid', notNull: true },
      role_id: { type: 'uuid', notNull: true },
      // The whole point of the table: `on update cascade` is what `documents.category` already
      // has, so a renamed world carries the scopes that reference it the same way it carries
      // its documents.
      world_slug: {
        type: 'text',
        notNull: true,
        references: 'worlds(slug)',
        onUpdate: 'cascade',
        onDelete: 'cascade',
      },
    },
    {
      constraints: {
        primaryKey: ['user_id', 'role_id', 'world_slug'],
        foreignKeys: [
          {
            columns: ['user_id', 'role_id'],
            references: 'user_roles(user_id, role_id)',
            onDelete: 'cascade',
          },
        ],
      },
    },
  );

  // Backfill. The join is what makes this unable to fail on existing rows: a `world_scope`
  // entry naming a world that was never created (or has since been deleted) simply does not
  // produce a row, where a blanket insert would have raised 23503 and stopped the deploy.
  pgm.sql(`insert into user_role_worlds(user_id, role_id, world_slug)
             select ur.user_id, ur.role_id, w.slug
               from user_roles ur, unnest(ur.world_scope) s
               join worlds w on w.slug = s
              where ur.world_scope is not null
           on conflict do nothing`);

  // Clean-up, same reasoning in the other direction: drop the slugs that matched no world from
  // the array too, so the column and the table agree from here on. Those entries already
  // scoped a user to nothing, so no one's access changes.
  pgm.sql(`update user_roles ur
              set world_scope = coalesce(
                    (select array_agg(s order by s) from unnest(ur.world_scope) s
                      where exists (select 1 from worlds w where w.slug = s)),
                    '{}')
            where ur.world_scope is not null
              and exists (select 1 from unnest(ur.world_scope) s
                           where not exists (select 1 from worlds w where w.slug = s))`);

  // `world_scope` stays the write surface (`admin/users.ts` sets it, and `null` there means
  // "every world" — something a join table cannot express). This trigger mirrors each write
  // into the join table so the two cannot drift, and so no writer has to know about it.
  pgm.sql(`create function user_roles_sync_worlds() returns trigger as $$
             begin
               delete from user_role_worlds
                where user_id = new.user_id and role_id = new.role_id;
               if new.world_scope is not null then
                 insert into user_role_worlds(user_id, role_id, world_slug)
                   select new.user_id, new.role_id, w.slug
                     from unnest(new.world_scope) s join worlds w on w.slug = s
                 on conflict do nothing;
               end if;
               return new;
             end $$ language plpgsql`);
  pgm.sql(`create trigger user_roles_sync_worlds_trg
             after insert or update of world_scope on user_roles
             for each row execute function user_roles_sync_worlds()`);

  // The rename half. `on update cascade` above already carries `user_role_worlds`; this carries
  // the array column with it, so the two still agree after an admin edits a slug.
  pgm.sql(`create function worlds_slug_renamed() returns trigger as $$
             begin
               update user_roles
                  set world_scope = array_replace(world_scope, old.slug, new.slug)
                where world_scope @> array[old.slug];
               return new;
             end $$ language plpgsql`);
  pgm.sql(`create trigger worlds_slug_renamed_trg
             after update of slug on worlds
             for each row when (old.slug is distinct from new.slug)
             execute function worlds_slug_renamed()`);
};

exports.down = (pgm) => {
  pgm.sql('drop trigger if exists worlds_slug_renamed_trg on worlds');
  pgm.sql('drop function if exists worlds_slug_renamed()');
  pgm.sql('drop trigger if exists user_roles_sync_worlds_trg on user_roles');
  pgm.sql('drop function if exists user_roles_sync_worlds()');
  pgm.dropTable('user_role_worlds');
  pgm.dropTable('webhook_nonces');
};
