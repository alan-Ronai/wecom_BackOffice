/**
 * Review baseline: what the reviewer was actually asked to look at.
 *
 * `POST /documents/:id/review-decision` locked the open `review_requests` row and published
 * whatever the document was *at that moment*. Nothing recorded the document at request time and
 * nothing compared it at decision time, so an author could push edits between "send to review"
 * and "approve" and the approval published them under the reviewer's name and label — in a
 * workflow whose entire purpose is that someone looked.
 *
 * Two columns rather than one. `base_version` is `documents.current_version`, which moves on
 * publish; `base_etag` is `documents.etag`, which `PUT /documents/:id/structure` regenerates on
 * every content write. A draft can be rewritten from top to bottom without its version moving,
 * so the version alone would have missed the most common case.
 *
 * Nullable, and the decision route treats `null` as "no baseline recorded": requests that were
 * already open when this migration ran keep working instead of becoming undecidable.
 */

/* Stage-4 indexes folded into this migration so every wave-3 migration stays below 0029. */
/**
 * The indexes stage 4's queries actually need. 0022 covered `assembleMany` and `listCards`
 * well, but the connected-data read models wave 3 added still scan:
 *
 * - `step_field_refs(field_name)` drives `fieldUsageRows`, `fieldUsage`, `inboundFor` on a
 *   field, `documentsMentioning` and the step set `renameField` rewrites.
 * - `document_links(to_*)` drives `inboundFor` and `brokenLinkCount` for every node kind, and
 *   `GET /documents/:id/backlinks`.
 * - `script_refs(script_id)` / `script_refs(document_id)` drive the script edges in `loadGraph`
 *   and `inboundFor` on a script.
 * - `comments(document_id)` drives the thread read on every article open, and
 *   `comment_likes(comment_id)` the like counts beside it.
 * - `telemetry_events(at)` drives the retention sweep added with this wave.
 *
 * Not a problem at today's row counts — the 5,000-document perf fixture is comfortably inside
 * the §11 budget without them — but these are the joins stage 4 introduced, and they are the
 * ones that grow with link density rather than with document count.
 *
 */

const INDEXES = [
  ['step_field_refs', 'field_name'],
  ['document_links', 'to_document_id'],
  ['document_links', 'to_block_id'],
  ['document_links', 'to_field_name'],
  ['document_links', 'to_source_id'],
  ['script_refs', 'script_id'],
  ['script_refs', 'document_id'],
  ['comments', 'document_id'],
  ['comment_likes', 'comment_id'],
  ['telemetry_events', 'at'],
];

exports.up = (pgm) => {
  pgm.addColumns('review_requests', {
    base_version: { type: 'integer' },
    base_etag: { type: 'text' },
  });
  for (const [table, column] of INDEXES) pgm.createIndex(table, column, { ifNotExists: true });
  // `schedule` becomes nullable: `null` is "ללא תזמון" — the connector runs on demand only and
  // the scheduler unregisters its pg-boss cron (folded from a later migration to stay below 0029).
  pgm.alterColumn('connectors', 'schedule', { notNull: false });
};

exports.down = (pgm) => {
  pgm.sql("update connectors set schedule = '*/15 * * * *' where schedule is null");
  pgm.alterColumn('connectors', 'schedule', { notNull: true });
  for (const [table, column] of [...INDEXES].reverse()) pgm.dropIndex(table, column, { ifExists: true });
  pgm.dropColumns('review_requests', ['base_version', 'base_etag']);
};
