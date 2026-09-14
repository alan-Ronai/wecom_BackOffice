const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
exports.up = (pgm) => {
  // Usage on the dashboards is measured, not guessed: the web posts outcome picks,
  // completed calls, palette opens and jumps to POST /telemetry and they land here.
  pgm.createTable('telemetry_events', {
    id: id(pgm),
    user_id: { type: 'uuid', references: 'users', onDelete: 'set null' },
    kind: { type: 'text', notNull: true, check: "kind in ('outcome','call_completed','palette','jump')" },
    document_id: { type: 'uuid', references: 'documents', onDelete: 'cascade' },
    step_key: 'text',
    at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('telemetry_events', ['kind', 'at']);
  pgm.createIndex('telemetry_events', ['document_id', 'at']);
};
exports.down = (pgm) => {
  pgm.dropTable('telemetry_events');
};
