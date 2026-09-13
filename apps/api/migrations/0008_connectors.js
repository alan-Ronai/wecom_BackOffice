const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
exports.up = (pgm) => {
  pgm.createTable('connectors', {
    id: id(pgm),
    type: { type: 'text', notNull: true },
    name: { type: 'text', notNull: true },
    config_encrypted: { type: 'bytea', notNull: true },
    enabled: { type: 'boolean', notNull: true, default: true },
    schedule: { type: 'text', notNull: true, default: '*/15 * * * *' },
    last_run_at: 'timestamptz',
    last_status: 'text',
    health: { type: 'jsonb', notNull: true, default: '{}' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    created_by: { type: 'uuid', references: 'users' },
  });
  pgm.addConstraint('sources', 'sources_connector_fk', {
    foreignKeys: { columns: 'connector_id', references: 'connectors', onDelete: 'set null' },
  });
  pgm.createTable('sync_links', {
    id: id(pgm),
    document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' },
    connector_id: { type: 'uuid', notNull: true, references: 'connectors', onDelete: 'cascade' },
    external_id: { type: 'text', notNull: true },
    source_id: { type: 'uuid', references: 'sources', onDelete: 'set null' },
    base_remote_hash: 'text',
    base_local_version: { type: 'integer', notNull: true, default: 0 },
    remote_url: 'text',
    last_synced_at: 'timestamptz',
    state: {
      type: 'text',
      notNull: true,
      default: 'synced',
      check: "state in ('synced','pending_import','pending_push','conflict')",
    },
    conflict: 'jsonb',
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('sync_links', 'sync_links_remote_unique', { unique: ['connector_id', 'external_id'] });
  pgm.addConstraint('sync_links', 'sync_links_document_unique', { unique: ['document_id', 'connector_id'] });
};
exports.down = (pgm) => {
  pgm.dropTable('sync_links');
  pgm.dropConstraint('sources', 'sources_connector_fk');
  pgm.dropTable('connectors');
};
