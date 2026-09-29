/**
 * Wave Y (Y1, wave 4 A-M14) — `user_roles.world_scope` integrity: the last missing piece.
 *
 * `0045_pilot_hardening` already did most of what A-M14 asked for, and this migration does not
 * repeat it:
 *
 * - `user_role_worlds` is the foreign key a `text[]` cannot carry, `references worlds(slug)
 *   on update cascade on delete cascade`, mirrored from the array by `user_roles_sync_worlds`;
 * - a slug **rename** cascades into the array (`worlds_slug_renamed`), the way
 *   `documents.category`'s `on update cascade` carries documents;
 * - a world **delete** prunes the slug from the array (`worlds_slug_deleted`), the way the join
 *   table's and `document_worlds.world_slug`'s `on delete cascade` drop the membership rows. A
 *   world that is still some document's *primary* world cannot be deleted at all —
 *   `documents.category`'s foreign key is `no action` — so a scope never outlives the documents
 *   it scoped; that is the delete policy, and it is already consistent.
 *
 * The gap: the array itself still **accepted** a slug that names no world. The mirror trigger
 * joins `worlds`, so such a slug silently produced no join row — a grant that scopes the user to
 * nothing while `GET /admin/users` goes on echoing it back. `admin/users.ts` refuses it with
 * `400 UNKNOWN_WORLD`, but that is one writer; a hand-run `update`, an import or a future writer
 * is not. This migration makes the array behave like the foreign key it stands in for:
 *
 * 1. prune any unknown slug already stored (it scoped the user to nothing before and scopes them
 *    to nothing after — nobody's access changes; the same clean-up 0045 ran once);
 * 2. a `before insert or update of world_scope` trigger that rejects a write naming an unknown
 *    slug with SQLSTATE 23503 (`foreign_key_violation`), the error a real FK would raise.
 *
 * `null` (every world) and `{}` (no world) stay valid. The rename and delete triggers from 0045
 * write only slugs that exist at that moment, so they pass through this check unchanged.
 * `worlds_created` (0045, post-pilot H3) re-attached scopes "waiting" for a world that did not
 * exist yet; after this migration no such scope can be stored, so it has nothing left to do. It is
 * kept rather than dropped so this migration stays additive and its `down` stays trivial.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`update user_roles ur
              set world_scope = coalesce(
                    (select array_agg(s order by s) from unnest(ur.world_scope) s
                      where exists (select 1 from worlds w where w.slug = s)),
                    '{}')
            where ur.world_scope is not null
              and exists (select 1 from unnest(ur.world_scope) s
                           where not exists (select 1 from worlds w where w.slug = s))`);

  pgm.sql(`create function user_roles_check_worlds() returns trigger as $$
             declare unknown text[];
             begin
               if new.world_scope is null then return new; end if;
               select array_agg(distinct s order by s) into unknown
                 from unnest(new.world_scope) s
                where s is null or not exists (select 1 from worlds w where w.slug = s);
               if unknown is not null then
                 raise exception 'user_roles.world_scope names unknown worlds: %', array_to_string(unknown, ', ', '<null>')
                   using errcode = 'foreign_key_violation',
                         table = 'user_roles',
                         column = 'world_scope',
                         constraint = 'user_roles_world_scope_worlds_check';
               end if;
               return new;
             end $$ language plpgsql`);
  pgm.sql(`create trigger user_roles_check_worlds_trg
             before insert or update of world_scope on user_roles
             for each row execute function user_roles_check_worlds()`);
};

exports.down = (pgm) => {
  pgm.sql('drop trigger if exists user_roles_check_worlds_trg on user_roles');
  pgm.sql('drop function if exists user_roles_check_worlds()');
  // The prune in `up` is not reversed: the slugs it removed named no world and granted nothing.
};
