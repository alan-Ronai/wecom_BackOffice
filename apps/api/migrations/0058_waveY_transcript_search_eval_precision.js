/**
 * Wave Y (Y3) — two wave-6 follow-ups that each needed a schema change.
 *
 * 1. B-M12: the admin transcript browser searches message bodies
 *    (`GET /admin/ai/conversations?q=…`, `ai_messages.content ilike '%…%'`). A leading-wildcard
 *    `ilike` cannot use a btree, so without a trigram index every search is a sequential scan of
 *    a year of transcripts. `pg_trgm` is already installed (0001); the index is on the bare
 *    column because that is the expression the query writes.
 *
 * 2. Eval precision (wave 6 parked item): `ai_eval_runs` had columns for three of the five scores,
 *    and precision plus the language-failure count were written into `notes` as
 *    `precision 0.962 · כשלי שפה 8`. They become columns of their own. Nullable, not defaulted to
 *    0: a run recorded before this migration whose note carries no measurement has *no* precision,
 *    which is not the same as a precision of zero. Rows whose note does carry it are backfilled
 *    from the note, and the measured prefix is stripped so the note keeps only what is left
 *    (per-case failures).
 */

exports.shorthands = undefined;

const MEASURED = `^precision ([0-9]+(\\.[0-9]+)?) · כשלי שפה ([0-9]+)`;

exports.up = (pgm) => {
  pgm.sql(
    'create index if not exists ai_messages_content_trgm on ai_messages using gin (content gin_trgm_ops)',
  );

  pgm.addColumns('ai_eval_runs', {
    precision: { type: 'real', check: 'precision is null or (precision >= 0 and precision <= 1)' },
    language_failures: { type: 'integer', check: 'language_failures is null or language_failures >= 0' },
  });
  pgm.sql(`
    update ai_eval_runs
       set precision = (regexp_match(notes, '${MEASURED}'))[1]::real,
           language_failures = (regexp_match(notes, '${MEASURED}'))[3]::integer,
           notes = regexp_replace(notes, '${MEASURED}( · )?', '')
     where notes ~ '${MEASURED}'`);
};

exports.down = (pgm) => {
  // Put the measurement back where the pre-0058 code (and admin page) read it.
  pgm.sql(`
    update ai_eval_runs
       set notes = concat_ws(' · ',
             'precision ' || to_char(precision, 'FM0.000') || ' · כשלי שפה ' || coalesce(language_failures, 0),
             nullif(notes, ''))
     where precision is not null`);
  pgm.dropColumns('ai_eval_runs', ['precision', 'language_failures']);
  pgm.sql('drop index if exists ai_messages_content_trgm');
};
