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
 * 3. `asset_refs` (B-M15) — the join table the asset gc was supposed to read. Wave 4 got as far
 *    as one regexp pass per HTML row instead of an assets × versions cross product; the row it
 *    parked was "a real join table maintained on save". It is maintained by triggers rather than
 *    by the four write paths, which is both cheaper and stricter: no future writer can forget,
 *    and a bulk `update` cannot slip past.
 *
 * `down` reverses everything so `migrations.test.ts`'s full rollback stays green.
 */

/** Same capture the gc used to run inline: the `src` the sanitizer keeps, as a strict uuid. */
const ASSET_REF_RE = '/api/v1/assets/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

/**
 * Every column an asset can be referenced from: `[owner_kind, table, ...path into the row]`.
 *
 * `drafts` is on the list and has to stay on it. §5.1 autosaves in-progress source HTML there
 * every 3 s and an image is uploaded the moment it is pasted, long before "שמור גרסה" writes a
 * version — an editor who pasted screenshots on Monday and saved the following week would
 * otherwise lose them to Sunday's run, permanently, because `assets` is the only copy.
 */
const OWNERS = [
  ['document', 'documents', 'body_html'],
  ['source_document', 'source_documents', 'html'],
  ['source_document_version', 'source_document_versions', 'html'],
  ['draft', 'drafts', 'payload', 'html'],
];

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

  // ── 3. asset_refs (B-M15) ──────────────────────────────────────────────
  pgm.createTable(
    'asset_refs',
    {
      asset_id: { type: 'uuid', notNull: true, references: 'assets', onDelete: 'cascade' },
      owner_kind: { type: 'text', notNull: true },
      // Deliberately not a foreign key: it addresses one of four tables. Every one of them
      // cascade-deletes its rows, and the `after delete` trigger below clears the refs with
      // them, so nothing is left dangling.
      owner_id: { type: 'uuid', notNull: true },
    },
    { constraints: { primaryKey: ['owner_kind', 'owner_id', 'asset_id'] } },
  );
  pgm.addConstraint('asset_refs', 'asset_refs_owner_kind_check', {
    check: `owner_kind in (${OWNERS.map(([k]) => `'${k}'`).join(', ')})`,
  });
  // The gc asks "is this asset referenced by anything", which reads asset-first.
  pgm.createIndex('asset_refs', 'asset_id', { name: 'asset_refs_asset_id_index' });

  pgm.sql(`create function asset_refs_ids(html text) returns uuid[] as $$
             select coalesce(array_agg(distinct m[1]::uuid), '{}'::uuid[])
               from regexp_matches(coalesce(html, ''), '${ASSET_REF_RE}', 'g') m
           $$ language sql immutable`);

  /*
   * One trigger function for all four owners. `tg_argv[0]` is the owner kind and the rest is a
   * path into `to_jsonb(new)` — `body_html` for a document, `payload`/`html` for a draft — which
   * is what lets a single function serve columns that are not even the same type.
   *
   * The insert joins `assets` rather than trusting the extracted ids: HTML can outlive the image
   * it points at, and a blind insert would then fail the editor's save with a 23503.
   */
  pgm.sql(`create function asset_refs_sync() returns trigger as $$
             declare h text; j jsonb;
             begin
               if tg_op = 'DELETE' then
                 delete from asset_refs
                  where owner_kind = tg_argv[0] and owner_id = old.id;
                 return old;
               end if;
               j := to_jsonb(new);
               if array_length(tg_argv, 1) = 2 then
                 h := j ->> tg_argv[1];
               else
                 h := j -> tg_argv[1] ->> tg_argv[2];
               end if;
               delete from asset_refs
                where owner_kind = tg_argv[0] and owner_id = new.id;
               insert into asset_refs(asset_id, owner_kind, owner_id)
                 select a.id, tg_argv[0], new.id
                   from unnest(asset_refs_ids(h)) i join assets a on a.id = i
               on conflict do nothing;
               return new;
             end $$ language plpgsql`);

  for (const [kind, table, ...path] of OWNERS) {
    const args = [kind, ...path].map((a) => `'${a}'`).join(', ');
    pgm.sql(`create trigger ${table}_asset_refs_trg
               after insert or delete or update of ${path[0]} on ${table}
               for each row execute function asset_refs_sync(${args})`);
  }

  // Backfill from the HTML that is already stored — the same extraction the gc used to do at
  // run time, done once here instead of on every weekly pass.
  for (const [kind, table, ...path] of OWNERS) {
    const col = path.length === 1 ? path[0] : `${path[0]}->>'${path[1]}'`;
    pgm.sql(`insert into asset_refs(asset_id, owner_kind, owner_id)
               select a.id, '${kind}', t.id
                 from ${table} t, unnest(asset_refs_ids(t.${col})) i
                 join assets a on a.id = i
             on conflict do nothing`);
  }
};

exports.down = (pgm) => {
  for (const [, table] of OWNERS) pgm.sql(`drop trigger if exists ${table}_asset_refs_trg on ${table}`);
  pgm.sql('drop function if exists asset_refs_sync()');
  pgm.dropTable('asset_refs');
  pgm.sql('drop function if exists asset_refs_ids(text)');
  pgm.sql('drop trigger if exists worlds_slug_renamed_trg on worlds');
  pgm.sql('drop function if exists worlds_slug_renamed()');
  pgm.sql('drop trigger if exists user_roles_sync_worlds_trg on user_roles');
  pgm.sql('drop function if exists user_roles_sync_worlds()');
  pgm.dropTable('user_role_worlds');
  pgm.dropTable('webhook_nonces');
};
