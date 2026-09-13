const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
exports.up = (pgm) => {
  pgm.createTable('source_revisions', {
    id: id(pgm),
    source_id: { type: 'uuid', notNull: true, references: 'sources', onDelete: 'cascade' },
    hash: { type: 'text', notNull: true },
    raw: 'bytea',
    paragraphs: { type: 'jsonb', notNull: true },
    meta: 'jsonb',
    imported_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    imported_by: { type: 'uuid', references: 'users' },
    accepted: { type: 'boolean', notNull: true, default: false },
  });
  pgm.addConstraint('source_revisions', 'source_revisions_hash_unique', { unique: ['source_id', 'hash'] });
  pgm.createTable('suggestions', {
    id: id(pgm),
    source_revision_id: { type: 'uuid', notNull: true, references: 'source_revisions', onDelete: 'cascade' },
    anchor: { type: 'text', notNull: true },
    type: { type: 'text', notNull: true },
    title: { type: 'text', notNull: true },
    target_document_id: { type: 'uuid', references: 'documents', onDelete: 'set null' },
    target_step_key: 'text',
    target_block_id: { type: 'uuid', references: 'blocks', onDelete: 'set null' },
    payload: { type: 'jsonb', notNull: true },
    edited_payload: 'jsonb',
    confidence: { type: 'numeric(4,3)', notNull: true },
    rationale: { type: 'text', notNull: true, default: '' },
    status: { type: 'text', notNull: true, default: 'pending' },
    decided_by: { type: 'uuid', references: 'users' },
    decided_at: 'timestamptz',
    applied_version_id: { type: 'uuid', references: 'document_versions' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('suggestions', ['status', 'created_at']);
};
exports.down = (pgm) => {
  pgm.dropTable('suggestions');
  pgm.dropTable('source_revisions');
};
