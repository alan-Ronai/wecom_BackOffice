/**
 * Wave Y · B-M15 (closing it) — `asset_refs` covers every HTML column, not the five 0045 knew.
 *
 * 0045 built the join table, its triggers and its backfill for the five owners that existed
 * then (documents, document versions, source documents, source versions, drafts), and the gc
 * has read it ever since. Wave 5 then added a sixth HTML column — `learning_items.description`,
 * which `learning/repo.ts` runs through `sanitizeHtml` like every other body — and its frozen
 * copy in `learning_item_versions.snapshot → item → description`. Neither carried a trigger
 * (wave-5 acceptance, "adding the owner to 0045's `OWNERS` list is a one-line change"), so an
 * image referenced only from a briefing intro was unreferenced as far as the gc could tell.
 *
 * The version path is three keys deep, and 0045's `asset_refs_sync` only walked one or two. The
 * function is replaced by one that takes the whole remaining `tg_argv` as a `#>>` path — the
 * same behaviour for the existing five (a one- or two-key path reads the same value), any depth
 * for the new ones. `down` restores 0045's body verbatim.
 */

const OWNERS_0045 = ['document', 'document_version', 'source_document', 'source_document_version', 'draft'];

/** `[owner_kind, table, ...path into to_jsonb(row)]` — same shape as 0045's list. */
const OWNERS = [
  ['learning_item', 'learning_items', 'description'],
  ['learning_item_version', 'learning_item_versions', 'snapshot', 'item', 'description'],
];

/** A version row is written once and read forever (see 0045's `APPEND_ONLY`). */
const APPEND_ONLY = new Set(['learning_item_versions']);

const kindCheck = (kinds) => `owner_kind in (${kinds.map((k) => `'${k}'`).join(', ')})`;

exports.up = (pgm) => {
  pgm.sql(`create or replace function asset_refs_sync() returns trigger as $$
             declare h text;
             begin
               if tg_op = 'DELETE' then
                 delete from asset_refs
                  where owner_kind = tg_argv[0] and owner_id = old.id;
                 return old;
               end if;
               -- tg_argv is zero-based: [0] is the owner kind, [1..] the path into the row.
               h := to_jsonb(new) #>> tg_argv[1:array_length(tg_argv, 1) - 1];
               delete from asset_refs
                where owner_kind = tg_argv[0] and owner_id = new.id;
               insert into asset_refs(asset_id, owner_kind, owner_id)
                 select a.id, tg_argv[0], new.id
                   from unnest(asset_refs_ids(h)) i join assets a on a.id = i
               on conflict do nothing;
               return new;
             end $$ language plpgsql`);

  pgm.dropConstraint('asset_refs', 'asset_refs_owner_kind_check');
  pgm.addConstraint('asset_refs', 'asset_refs_owner_kind_check', {
    check: kindCheck([...OWNERS_0045, ...OWNERS.map(([k]) => k)]),
  });

  for (const [kind, table, ...path] of OWNERS) {
    const args = [kind, ...path].map((a) => `'${a}'`).join(', ');
    const events = APPEND_ONLY.has(table) ? 'insert or delete' : `insert or delete or update of ${path[0]}`;
    pgm.sql(`create trigger ${table}_asset_refs_trg
               after ${events} on ${table}
               for each row execute function asset_refs_sync(${args})`);
  }

  // Backfill: the references already stored in the two columns, which nothing recorded.
  for (const [kind, table, ...path] of OWNERS) {
    pgm.sql(`insert into asset_refs(asset_id, owner_kind, owner_id)
               select a.id, '${kind}', t.id
                 from ${table} t, unnest(asset_refs_ids(to_jsonb(t) #>> '{${path.join(',')}}')) i
                 join assets a on a.id = i
             on conflict do nothing`);
  }
};

exports.down = (pgm) => {
  for (const [, table] of OWNERS) pgm.sql(`drop trigger if exists ${table}_asset_refs_trg on ${table}`);
  pgm.sql(`delete from asset_refs where owner_kind in (${OWNERS.map(([k]) => `'${k}'`).join(', ')})`);
  pgm.dropConstraint('asset_refs', 'asset_refs_owner_kind_check');
  pgm.addConstraint('asset_refs', 'asset_refs_owner_kind_check', { check: kindCheck(OWNERS_0045) });
  // 0045's body, verbatim.
  pgm.sql(`create or replace function asset_refs_sync() returns trigger as $$
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
};
