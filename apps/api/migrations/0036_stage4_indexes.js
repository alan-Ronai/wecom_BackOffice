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
 * Numbered 0036 to sit clear of wave 4: 0029 is its permissions migration and 0030-0035 are
 * reserved for the rest of it.
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
  for (const [table, column] of INDEXES) pgm.createIndex(table, column, { ifNotExists: true });
};

exports.down = (pgm) => {
  for (const [table, column] of [...INDEXES].reverse()) pgm.dropIndex(table, column, { ifExists: true });
};
