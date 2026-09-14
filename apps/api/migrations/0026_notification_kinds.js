/**
 * Widens the two closed `kind` enums wave 4 appends to, so the contract and the database
 * agree before any wave-4 code writes a row.
 *
 * - `notifications.kind` gains `feedback` and `source` (`NotificationKindSchema`).
 * - `telemetry_events.kind` gains `view_topic` and `search_click` (`TelemetryEventSchema`).
 *
 * Both columns carry a `check` constraint written inline by `0020_collab.js:92` and
 * `0010_telemetry.js:8`, so widening the Zod enum alone would have turned a valid request
 * into a 23514 at insert time. Both lists are append-only — `down` narrows them again, which
 * is only safe because nothing has written the new values yet; it deletes any row that has,
 * rather than failing the rollback with rows the old constraint rejects.
 */

const NOTIFICATION_KINDS = [
  'suggestion',
  'sync',
  'mention',
  'review',
  'publish',
  'system',
  'feedback',
  'source',
];
const NOTIFICATION_KINDS_0020 = ['suggestion', 'sync', 'mention', 'review', 'publish', 'system'];

const TELEMETRY_KINDS = ['outcome', 'call_completed', 'palette', 'jump', 'view_topic', 'search_click'];
const TELEMETRY_KINDS_0010 = ['outcome', 'call_completed', 'palette', 'jump'];

const list = (values) => values.map((v) => `'${v}'`).join(',');

/** node-pg-migrate names an inline column check `<table>_<column>_check`. */
const recheck = (pgm, table, column, values) => {
  pgm.sql(`alter table ${table} drop constraint if exists ${table}_${column}_check`);
  pgm.sql(`alter table ${table} add constraint ${table}_${column}_check
             check (${column} in (${list(values)}))`);
};

exports.up = (pgm) => {
  recheck(pgm, 'notifications', 'kind', NOTIFICATION_KINDS);
  recheck(pgm, 'telemetry_events', 'kind', TELEMETRY_KINDS);
};

exports.down = (pgm) => {
  pgm.sql(`delete from notifications where kind not in (${list(NOTIFICATION_KINDS_0020)})`);
  recheck(pgm, 'notifications', 'kind', NOTIFICATION_KINDS_0020);
  pgm.sql(`delete from telemetry_events where kind not in (${list(TELEMETRY_KINDS_0010)})`);
  recheck(pgm, 'telemetry_events', 'kind', TELEMETRY_KINDS_0010);
};
