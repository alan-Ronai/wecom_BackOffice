/** Wave 4 (W5): search log with zero-result capture, per-user topic view counters. */
const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
exports.up = (pgm) => {
  pgm.createTable('search_log', {
    id: id(pgm),
    user_id: { type: 'uuid', references: 'users', onDelete: 'set null' },
    q: { type: 'text', notNull: true },
    filters: { type: 'jsonb', notNull: true, default: '{}' },
    results: { type: 'integer', notNull: true },
    took_ms: { type: 'integer', notNull: true, default: 0 },
    at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('search_log', 'at', { name: 'search_log_at_idx' });
  pgm.createIndex('search_log', 'q', { name: 'search_log_zero_idx', where: 'results = 0' });
  // topic_id is W1's topics.id; no FK so this migration is independent of W1's merge order.
  pgm.createTable(
    'topic_views',
    {
      user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
      topic_id: { type: 'uuid', notNull: true },
      viewed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      count: { type: 'integer', notNull: true, default: 1 },
    },
    { constraints: { primaryKey: ['user_id', 'topic_id'] } },
  );
  pgm.createIndex('topic_views', 'topic_id', { name: 'topic_views_topic_idx' });
};
exports.down = (pgm) => {
  pgm.dropTable('topic_views');
  pgm.dropTable('search_log');
};
