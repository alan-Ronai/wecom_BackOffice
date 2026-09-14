/**
 * W6 — the cross-lane fixups wave 4 needs once every lane is on one branch.
 *
 * 1. `notifications.kind` (0020) predates the wave 4 alert kinds, so W3's `PgNotifier` had to map
 *    `feedback`/`source` onto wave 3 kinds. Widening the check lets the real kind reach the row.
 * 2. `telemetry_events.kind` (0010) predates `view_topic` / `search_click` (spec §2.5).
 * 3. `documents_search_vector_update()` is defined three times across the tree: 0007 (plain),
 *    0023 (plain + Hebrew stopwords) and 0030 (plain + tags, no stopwords). By filename order 0030
 *    runs last, so a freshly migrated database indexes tags but keeps every Hebrew stopword. This
 *    recreates the function once more with **both** halves — title/description/search_text/tags at
 *    weights A/B/C/B, with the 0023 stopword list deleted from the vector — and re-fires the
 *    trigger so existing rows are reindexed.
 */
const SEARCH_FN_TAGS_AND_STOPWORDS = `
  create or replace function documents_search_vector_update() returns trigger as $$
  declare
    stop text[];
  begin
    select coalesce(array_agg(word), '{}') into stop from search_hebrew_stopwords;
    new.search_vector := ts_delete(
      setweight(to_tsvector('simple', coalesce(new.title,'')), 'A')
      || setweight(to_tsvector('simple', coalesce(new.description,'')), 'B')
      || setweight(to_tsvector('simple', coalesce(array_to_string(new.tags, ' '),'')), 'B')
      || setweight(to_tsvector('simple', coalesce(new.search_text,'')), 'C'),
      stop
    );
    return new;
  end
  $$ language plpgsql;
`;

/** Verbatim copy of 0030's `SEARCH_FN_WITH_TAGS`, so `down` restores exactly what 0030 left. */
const SEARCH_FN_WITH_TAGS = `create or replace function documents_search_vector_update() returns trigger as $$ begin new.search_vector := setweight(to_tsvector('simple', coalesce(new.title,'')), 'A') || setweight(to_tsvector('simple', coalesce(new.description,'')), 'B') || setweight(to_tsvector('simple', coalesce(array_to_string(new.tags, ' '),'')), 'B') || setweight(to_tsvector('simple', coalesce(new.search_text,'')), 'C'); return new; end $$ language plpgsql`;

exports.up = (pgm) => {
  pgm.dropConstraint('notifications', 'notifications_kind_check', { ifExists: true });
  pgm.addConstraint('notifications', 'notifications_kind_check', {
    check:
      "kind in ('suggestion','sync','mention','review','publish','system','feedback','source')",
  });

  pgm.dropConstraint('telemetry_events', 'telemetry_events_kind_check', { ifExists: true });
  pgm.addConstraint('telemetry_events', 'telemetry_events_kind_check', {
    check: "kind in ('outcome','call_completed','palette','jump','view_topic','search_click')",
  });

  pgm.sql(SEARCH_FN_TAGS_AND_STOPWORDS);
  pgm.sql('update documents set title = title');
};

exports.down = (pgm) => {
  pgm.sql(SEARCH_FN_WITH_TAGS);
  pgm.sql('update documents set title = title');

  pgm.sql("delete from telemetry_events where kind in ('view_topic','search_click')");
  pgm.dropConstraint('telemetry_events', 'telemetry_events_kind_check', { ifExists: true });
  pgm.addConstraint('telemetry_events', 'telemetry_events_kind_check', {
    check: "kind in ('outcome','call_completed','palette','jump')",
  });

  pgm.sql("delete from notifications where kind in ('feedback','source')");
  pgm.dropConstraint('notifications', 'notifications_kind_check', { ifExists: true });
  pgm.addConstraint('notifications', 'notifications_kind_check', {
    check: "kind in ('suggestion','sync','mention','review','publish','system')",
  });
};
