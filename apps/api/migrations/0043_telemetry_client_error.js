/**
 * Widens `telemetry_events.kind` for the wave-5 `client_error` row (`TelemetryEventSchema`), and
 * gives that row the two columns it needs to be worth reading.
 *
 * Same shape and same reason as `0026_notification_kinds.js`: the column carries an inline
 * `check` constraint written by `0010_telemetry.js:8`, so appending to the Zod enum alone would
 * have turned every crash report into a 23514 at insert time — which is to say, the reporter for
 * "the screen blanked" would itself have failed silently.
 *
 * Post-pilot M2 — `where` and `what`. `0010_telemetry.js` gave the table `document_id` and
 * `step_key` and nothing else, so a `client_error` row answered "did anything crash this week"
 * and stopped there: not which screen, not which throw. Two nullable `text` columns close that,
 * and nullable is the point — every other `kind` (`palette`, `jump`, `outcome`, …) leaves both
 * null, and a crash in the shell has no document to name either.
 *
 * Deliberately no `check` on the lengths. The caps that matter (`path` ≤ 512, `message` ≤ 1,000)
 * live in `TelemetryEventSchema`, which is the one place the web and the API agree on them, and a
 * second copy in DDL would only be a constraint to forget to move. The column that is *not*
 * allowed to hold free text is `message`: `ui/ErrorBoundary.tsx` sends `error.message` with
 * emails and stray uuids redacted and the stack dropped entirely, because this table is read by
 * anyone with `analytics.read`.
 *
 * `down` is symmetric: it drops both columns, narrows the kind list again and deletes the rows
 * the old constraint would reject, rather than failing the rollback on them; a crash report is
 * the most disposable row in the database.
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
  pgm.addColumns('telemetry_events', {
    path: { type: 'text' },
    message: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('telemetry_events', ['path', 'message']);
  pgm.sql(`delete from telemetry_events where kind not in (${list(TELEMETRY_KINDS_0026)})`);
  recheck(pgm, 'telemetry_events', 'kind', TELEMETRY_KINDS_0026);
};
