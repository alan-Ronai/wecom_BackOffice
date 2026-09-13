const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
exports.up = (pgm) => {
  pgm.createTable('sessions', {
    id: id(pgm),
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
    token_hash: { type: 'text', notNull: true, unique: true },
    ip: 'text',
    user_agent: 'text',
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: 'timestamptz',
  });
  pgm.createIndex('sessions', ['user_id', 'expires_at']);
  pgm.createTable('audit_log', {
    id: id(pgm),
    actor_id: { type: 'uuid', references: 'users' },
    action: { type: 'text', notNull: true },
    entity_type: { type: 'text', notNull: true },
    entity_id: 'text',
    before: 'jsonb',
    after: 'jsonb',
    ip: 'text',
    request_id: 'text',
    at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('audit_log', ['entity_type', 'entity_id']);
  pgm.createIndex('audit_log', 'at');
};
exports.down = (pgm) => {
  pgm.dropTable('audit_log');
  pgm.dropTable('sessions');
};
