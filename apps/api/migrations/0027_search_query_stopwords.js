/**
 * Search correctness: apply the Hebrew stopword list to *queries*, not only to the index.
 *
 * 0023 taught `documents_search_vector_update()` to `ts_delete()` the stopwords out of
 * `search_vector`. The query side was left building `plainto_tsquery('simple', $1)`, which
 * produces a conjunction of **every** word including the stopwords — and those lexemes no
 * longer exist in any document, so `search_vector @@ plainto_tsquery(...)` could never be
 * satisfied for a query containing one. `חוב של לקוח` matched zero documents where `חוב לקוח`
 * matched one, and the `or d.title ilike '%…%'` arm in `documents/repo.ts` masked it for
 * title-substring hits, which is why no test failed.
 *
 * The durable fix is that the two sides share one definition rather than one list: both
 * `kb_tsquery` and the trigger tokenise with `to_tsvector('simple', …)` and then `ts_delete`
 * the same `search_hebrew_stopwords` rows. Adding a word to that table can no longer make the
 * index and the query disagree.
 *
 * While here, 0023's trigger re-read the whole stopword table on every row write (including
 * during bulk loads and its own backfill). `kb_stopwords()` is `stable`, so the planner may
 * cache it within a statement, and the trigger now calls it.
 */

exports.up = (pgm) => {
  pgm.sql(`
    create or replace function kb_stopwords() returns text[] as $$
      select coalesce(array_agg(word), '{}') from search_hebrew_stopwords;
    $$ language sql stable;
  `);

  // Same tokeniser, same ts_delete, same table as the trigger below — that is the whole point.
  pgm.sql(`
    create or replace function kb_tsquery(q text) returns tsquery as $$
    declare
      v tsvector;
      s text;
    begin
      v := ts_delete(to_tsvector('simple', coalesce(q, '')), kb_stopwords());
      select string_agg(quote_literal(lexeme), ' & ') into s from unnest(v);
      -- Nothing left: the caller typed only stopwords (or nothing at all). Fall back to the
      -- literal query so the behaviour is "no vector hit", the same as before 0023, rather
      -- than a malformed tsquery.
      if s is null then return plainto_tsquery('simple', coalesce(q, '')); end if;
      return to_tsquery('simple', s);
    end
    $$ language plpgsql stable;
  `);

  /**
   * The command palette ranks on every keystroke, so the last word of the query is a prefix
   * match. Same pipeline as `kb_tsquery`, except the lexeme carrying the highest position
   * (the word still being typed) gets `:*`.
   */
  pgm.sql(`
    create or replace function kb_tsquery_prefix(q text) returns tsquery as $$
    declare
      v tsvector;
      last_pos int;
      s text;
    begin
      v := ts_delete(to_tsvector('simple', coalesce(q, '')), kb_stopwords());
      select max(p) into last_pos from unnest(v) u, unnest(u.positions) p;
      if last_pos is null then return kb_tsquery(q); end if;
      select string_agg(t, ' & ' order by at) into s from (
        select quote_literal(u.lexeme) || case when max(p) = last_pos then ':*' else '' end as t,
               min(p) as at
          from unnest(v) u, unnest(u.positions) p
         group by u.lexeme
      ) x;
      return to_tsquery('simple', s);
    end
    $$ language plpgsql stable;
  `);

  pgm.sql(`
    create or replace function documents_search_vector_update() returns trigger as $$
    begin
      new.search_vector := ts_delete(
        setweight(to_tsvector('simple', coalesce(new.title,'')), 'A')
        || setweight(to_tsvector('simple', coalesce(new.description,'')), 'B')
        || setweight(to_tsvector('simple', coalesce(new.search_text,'')), 'C'),
        kb_stopwords()
      );
      return new;
    end
    $$ language plpgsql;
  `);
};

exports.down = (pgm) => {
  // Back to 0023's trigger, which inlined the stopword lookup.
  pgm.sql(`
    create or replace function documents_search_vector_update() returns trigger as $$
    declare
      stop text[];
    begin
      select coalesce(array_agg(word), '{}') into stop from search_hebrew_stopwords;
      new.search_vector := ts_delete(
        setweight(to_tsvector('simple', coalesce(new.title,'')), 'A')
        || setweight(to_tsvector('simple', coalesce(new.description,'')), 'B')
        || setweight(to_tsvector('simple', coalesce(new.search_text,'')), 'C'),
        stop
      );
      return new;
    end
    $$ language plpgsql;
  `);
  pgm.sql('drop function if exists kb_tsquery_prefix(text)');
  pgm.sql('drop function if exists kb_tsquery(text)');
  pgm.sql('drop function if exists kb_stopwords()');
};
