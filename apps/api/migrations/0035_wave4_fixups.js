/**
 * W6 — the one cross-lane fixup wave 4 still needs once every lane is on one branch.
 *
 * `documents_search_vector_update()` is defined four times across the tree: 0007 (plain),
 * 0023 (plain + Hebrew stopwords), 0027 (plain + `kb_stopwords()`) and 0030 (plain + tags,
 * **no** stopwords). node-pg-migrate applies files in name order, so on a freshly migrated
 * database 0030 runs last and wins: tags reach `search_vector`, and every Hebrew stopword
 * comes back with them. On an already-migrated database only 0030 is pending, so the same
 * two definitions land in the opposite order and tags are the half that goes missing. Either
 * way the two halves never coexisted.
 *
 * This is the single definition that carries both: title/description/tags/search_text at
 * weights A/B/B/C, with 0027's `stable` `kb_stopwords()` deleted from the vector. The trigger
 * itself (which 0030 already re-created to fire on `tags`) is left alone; only the function
 * body changes, and every existing row is reindexed.
 *
 * The wave-4 `notifications.kind` / `telemetry_events.kind` widenings this file was originally
 * planned to carry now live in wave 3's `0026_notification_kinds.js`.
 */
const SEARCH_FN_TAGS_AND_STOPWORDS = `
  create or replace function documents_search_vector_update() returns trigger as $$
  begin
    new.search_vector := ts_delete(
      setweight(to_tsvector('simple', coalesce(new.title,'')), 'A')
      || setweight(to_tsvector('simple', coalesce(new.description,'')), 'B')
      || setweight(to_tsvector('simple', coalesce(array_to_string(new.tags, ' '),'')), 'B')
      || setweight(to_tsvector('simple', coalesce(new.search_text,'')), 'C'),
      kb_stopwords()
    );
    return new;
  end
  $$ language plpgsql;
`;

/** Verbatim copy of 0030's `SEARCH_FN_WITH_TAGS`, so `down` restores exactly what 0030 left. */
const SEARCH_FN_WITH_TAGS = `create or replace function documents_search_vector_update() returns trigger as $$ begin new.search_vector := setweight(to_tsvector('simple', coalesce(new.title,'')), 'A') || setweight(to_tsvector('simple', coalesce(new.description,'')), 'B') || setweight(to_tsvector('simple', coalesce(array_to_string(new.tags, ' '),'')), 'B') || setweight(to_tsvector('simple', coalesce(new.search_text,'')), 'C'); return new; end $$ language plpgsql`;

exports.up = (pgm) => {
  pgm.sql(SEARCH_FN_TAGS_AND_STOPWORDS);
  pgm.sql('update documents set title = title');
};

exports.down = (pgm) => {
  pgm.sql(SEARCH_FN_WITH_TAGS);
  pgm.sql('update documents set title = title');
};
