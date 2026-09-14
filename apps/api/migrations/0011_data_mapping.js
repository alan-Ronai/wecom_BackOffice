exports.up = (pgm) => {
  // The data explorer needs the tabular shape of a json/csv source, which the paragraph
  // pipeline flattens away: the inferred header lives on the source and the parsed rows
  // stay on the revision they were parsed from. `sources.mapping` (jsonb) already exists
  // and is reused as the column -> mapped-field record.
  pgm.addColumns('sources', {
    columns: { type: 'text[]', notNull: true, default: '{}' },
  });
  pgm.addColumns('source_revisions', {
    data_rows: 'jsonb',
  });
};
exports.down = (pgm) => {
  pgm.dropColumns('source_revisions', ['data_rows']);
  pgm.dropColumns('sources', ['columns']);
};
