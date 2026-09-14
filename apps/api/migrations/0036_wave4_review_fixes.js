/**
 * Wave-4 final-review fixes that need schema or a data fixup.
 *
 * Everything here is forward-only repair of what 0030–0035 already left on a migrated
 * database, plus the two tables the review asked for. The earlier files are unchanged except
 * where a finding named one (0030's `doc_type` prefix case and its `down`).
 *
 * - A-I4  `doc_type` for `T-`/`I-` coded items. 0030's backfill matched `^[MROES]-`, so the
 *         spec's `T- → T` and `I- → I` rows fell through to the phases/kind rule; the shipped
 *         seed's one `T-01` (kind `steps`, 4 phases) landed as `R` — wrong group in the topic
 *         view, wrong badge, missed by `?docType=T`. 0030 is fixed for fresh databases; this
 *         is the fixup for the ones already migrated.
 * - A-I7  `search_text` for `kind: 'text'` documents. Nothing ever wrote `body_html` into it,
 *         so a text document was not searchable by its body. The application now appends
 *         `htmlToText(bodyHtml)`; this backfills the rows that exist. Writing `search_text`
 *         fires the 0035 trigger, so `search_vector` is rebuilt with them.
 * - B-I6  `connector_media`. `rewriteAssets` deduped only within a single push, so a document
 *         with ten images published fifty times left five hundred copies of the same bytes in
 *         the customer's WordPress media library, with no cleanup path. The mapping is keyed
 *         (connector, asset) and records what the remote gave back.
 * - B-M3  A unique index behind `alertOnce`. It was select-then-insert with nothing to make
 *         it atomic, so two overlapping `feedback.alerts` runs could both notify.
 */

/**
 * Tags out, the five entities `sanitizeHtml` emits decoded, `&amp;` last so an escaped entity
 * is not decoded twice. Close enough to the application's `htmlToText` for an index: the next
 * write through `updateSearchText` replaces this value with the exact one.
 */
const BODY_TEXT = `btrim(regexp_replace(
  replace(replace(replace(replace(replace(
    regexp_replace(coalesce(body_html, ''), '<[^>]+>', ' ', 'g'),
    '&nbsp;', ' '), '&quot;', '"'), '&#39;', ''''), '&lt;', '<'), '&gt;', '>'),
  '\\s+', ' ', 'g'))`;

exports.up = (pgm) => {
  // A-I4 — forward fixup; the rows are still identifiable by their code prefix.
  pgm.sql(`update documents set doc_type = left(code, 1)
    where code ~ '^[TI]-' and doc_type <> left(code, 1)`);

  // A-I7 — a text body has never reached search_text. Writing the column fires 0035's trigger,
  // so `search_vector` picks the body up with it.
  pgm.sql(`update documents
              set search_text = btrim(coalesce(search_text, '') || E'\\n' ||
                                      replace(${BODY_TEXT}, '&amp;', '&'))
            where body_html is not null and ${BODY_TEXT} <> ''`);

  // B-I6 — asset ⇄ remote media, so a push reuses what it already uploaded.
  pgm.createTable('connector_media', {
    connector_id: { type: 'uuid', notNull: true, references: 'connectors', onDelete: 'cascade' },
    asset_id: { type: 'uuid', notNull: true, references: 'assets', onDelete: 'cascade' },
    remote_media_id: { type: 'text', notNull: true },
    remote_url: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('connector_media', 'connector_media_pkey', {
    primaryKey: ['connector_id', 'asset_id'],
  });
  pgm.createIndex('connector_media', 'asset_id');

  // B-C2 — an image an inbound sync could not bring across is recorded here rather than
  // vanishing silently between the remote body and the sanitized source version.
  pgm.addColumns('sync_links', { media_errors: 'jsonb' });

  // B-M3 — makes `alertOnce`'s `on conflict do nothing` mean something.
  pgm.sql(`delete from feedback_alerts a using feedback_alerts b
            where a.ctid > b.ctid and a.document_id = b.document_id
              and a.kind = b.kind and a.window_start = b.window_start`);
  pgm.createIndex('feedback_alerts', ['document_id', 'kind', 'window_start'], {
    unique: true,
    name: 'feedback_alerts_window_uniq',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('feedback_alerts', ['document_id', 'kind', 'window_start'], {
    name: 'feedback_alerts_window_uniq',
  });
  pgm.dropColumns('sync_links', ['media_errors']);
  pgm.dropTable('connector_media');
  // The doc_type and search_text fixups are data repair towards the spec; there is nothing to
  // undo that would not be a second bug.
};
