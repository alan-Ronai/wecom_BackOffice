/**
 * Widens `telemetry_events.kind` for the wave-5 `client_error` row (`TelemetryEventSchema`).
 *
 * Same shape and same reason as `0026_notification_kinds.js`: the column carries an inline
 * `check` constraint written by `0010_telemetry.js:8`, so appending to the Zod enum alone would
 * have turned every crash report into a 23514 at insert time — which is to say, the reporter for
 * "the screen blanked" would itself have failed silently.
 *
 * `down` narrows the list again and deletes the rows the old constraint would reject, rather than
 * failing the rollback on them; a crash report is the most disposable row in the database.
 */

const TELEMETRY_KINDS = [
  'outcome',
  'call_completed',
  'palette',
  'jump',
  'view_topic',
  'search_click',
  'client_error',
];
const TELEMETRY_KINDS_0026 = ['outcome', 'call_completed', 'palette', 'jump', 'view_topic', 'search_click'];

const list = (values) => values.map((v) => `'${v}'`).join(',');

/** node-pg-migrate names an inline column check `<table>_<column>_check`. */
const recheck = (pgm, table, column, values) => {
  pgm.sql(`alter table ${table} drop constraint if exists ${table}_${column}_check`);
  pgm.sql(`alter table ${table} add constraint ${table}_${column}_check
             check (${column} in (${list(values)}))`);
};

exports.up = (pgm) => {
  recheck(pgm, 'telemetry_events', 'kind', TELEMETRY_KINDS);
};

exports.down = (pgm) => {
  pgm.sql(`delete from telemetry_events where kind not in (${list(TELEMETRY_KINDS_0026)})`);
  recheck(pgm, 'telemetry_events', 'kind', TELEMETRY_KINDS_0026);
};
