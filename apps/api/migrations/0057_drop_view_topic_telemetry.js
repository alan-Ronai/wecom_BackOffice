/**
 * Wave Y — narrows `telemetry_events.kind` by the dead `view_topic` value (wave-4 parked row).
 *
 * 0026 widened the check for `view_topic` and `search_click`; only the second ever had a
 * producer. `telemetry_events.document_id` references `documents`, so a topic id could never land
 * in it, and topic views are recorded server-side into `topic_views` by `GET /topics/:id/items`,
 * which is what `topTopics` reads. `TelemetryEventSchema` drops the value in the same change.
 *
 * `up` deletes any `view_topic` row before narrowing (there should be none; a telemetry row is
 * the most disposable row in the database, same ruling as 0043's `down`). `down` widens back to
 * 0043's list.
 */

const KINDS_0043 = [
  'outcome',
  'call_completed',
  'palette',
  'jump',
  'view_topic',
  'search_click',
  'client_error',
];
const KINDS = KINDS_0043.filter((k) => k !== 'view_topic');

const list = (values) => values.map((v) => `'${v}'`).join(',');

/** node-pg-migrate names an inline column check `<table>_<column>_check` (0043 kept the name). */
const recheck = (pgm, values) => {
  pgm.sql('alter table telemetry_events drop constraint if exists telemetry_events_kind_check');
  pgm.sql(`alter table telemetry_events add constraint telemetry_events_kind_check
             check (kind in (${list(values)}))`);
};

exports.up = (pgm) => {
  pgm.sql(`delete from telemetry_events where kind = 'view_topic'`);
  recheck(pgm, KINDS);
};

exports.down = (pgm) => {
  recheck(pgm, KINDS_0043);
};
