/** Wave 4 (W3): agent feedback on knowledge items + alert dedupe log. Spec §2.3. */
const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });

exports.up = (pgm) => {
  pgm.createTable('feedback', {
    id: id(pgm),
    document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' },
    document_version: { type: 'integer', notNull: true },
    doc_type: 'text', // captured at creation; null until W1's documents.doc_type exists
    world_slug: { type: 'text', notNull: true },
    step_key: 'text',
    kind: {
      type: 'text',
      notNull: true,
      check: "kind in ('outdated','error','unclear','missing','process_fails','no_answer','other')",
    },
    text: { type: 'text', notNull: true, default: '' },
    status: {
      type: 'text',
      notNull: true,
      default: 'new',
      check: "status in ('new','in_review','needs_update','no_change','done')",
    },
    user_id: { type: 'uuid', notNull: true, references: 'users' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    assignee_id: { type: 'uuid', references: 'users' },
    decision_note: 'text',
    decided_by: { type: 'uuid', references: 'users' },
    decided_at: 'timestamptz',
    resolved_version: 'integer',
  });
  pgm.createIndex('feedback', ['document_id', 'created_at']);
  pgm.createIndex('feedback', ['status', 'created_at']);
  pgm.createIndex('feedback', 'kind');

  pgm.createTable('feedback_alerts', {
    id: id(pgm),
    document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' },
    kind: { type: 'text', notNull: true, check: "kind in ('new','repeat','process_fails','anomaly')" },
    window_start: { type: 'timestamptz', notNull: true },
    window_end: { type: 'timestamptz', notNull: true },
    count: { type: 'integer', notNull: true },
    notified_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('feedback_alerts', ['document_id', 'kind', 'window_end']);
};

exports.down = (pgm) => {
  pgm.dropTable('feedback_alerts');
  pgm.dropTable('feedback');
};
