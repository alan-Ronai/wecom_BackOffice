/** Wave 5 (V1): learning items (briefings, quizzes), their versions, entries and questions. Spec §3. */
const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
const now = (pgm) => ({ type: 'timestamptz', notNull: true, default: pgm.func('now()') });

exports.up = (pgm) => {
  pgm.createTable('learning_items', {
    id: id(pgm),
    kind: { type: 'text', notNull: true, check: "kind in ('briefing','quiz')" },
    title: { type: 'text', notNull: true },
    description: { type: 'text', notNull: true, default: '' },
    world_slug: { type: 'text', references: 'worlds(slug)', onUpdate: 'cascade' },
    status: {
      type: 'text',
      notNull: true,
      default: 'draft',
      check: "status in ('draft','published','archived')",
    },
    current_version: { type: 'integer', notNull: true, default: 0 },
    pass_mark: { type: 'integer', check: 'pass_mark between 1 and 100' },
    max_attempts: { type: 'integer', check: 'max_attempts between 1 and 10' }, // null = unlimited (owner decision)
    estimated_minutes: 'integer',
    created_by: { type: 'uuid', references: 'users' },
    updated_by: { type: 'uuid', references: 'users' },
    created_at: now(pgm),
    updated_at: now(pgm),
    published_at: 'timestamptz',
    deleted_at: 'timestamptz',
  });
  pgm.createIndex('learning_items', ['kind', 'status']);
  pgm.createIndex('learning_items', 'world_slug');

  pgm.createTable('learning_item_versions', {
    id: id(pgm),
    item_id: { type: 'uuid', notNull: true, references: 'learning_items', onDelete: 'cascade' },
    version: { type: 'integer', notNull: true },
    snapshot: { type: 'jsonb', notNull: true }, // { item: LearningItem, sourceVersions: [{documentId, version}] }
    author_id: { type: 'uuid', references: 'users' },
    label: { type: 'text', notNull: true, default: '' },
    created_at: now(pgm),
  });
  pgm.addConstraint('learning_item_versions', 'learning_item_versions_unique', {
    unique: ['item_id', 'version'],
  });

  pgm.createTable('briefing_entries', {
    id: id(pgm),
    item_id: { type: 'uuid', notNull: true, references: 'learning_items', onDelete: 'cascade' },
    position: { type: 'integer', notNull: true },
    document_id: { type: 'uuid', notNull: true, references: 'documents' },
    step_key: 'text',
    note: { type: 'text', notNull: true, default: '' },
  });
  pgm.createIndex('briefing_entries', 'item_id');
  pgm.createIndex('briefing_entries', 'document_id');

  pgm.createTable('quiz_questions', {
    id: id(pgm),
    item_id: { type: 'uuid', notNull: true, references: 'learning_items', onDelete: 'cascade' },
    position: { type: 'integer', notNull: true },
    document_id: { type: 'uuid', notNull: true, references: 'documents' },
    step_key: 'text',
    stem: { type: 'text', notNull: true },
    kind: { type: 'text', notNull: true, check: "kind in ('single','multi','order','free')" },
    options: { type: 'jsonb', notNull: true, default: '[]' }, // [{ id, text, correct }]
    explanation: { type: 'text', notNull: true, default: '' },
    generated: { type: 'boolean', notNull: true, default: false },
    model_conf: 'numeric(4,3)',
  });
  pgm.createIndex('quiz_questions', 'item_id');
  pgm.createIndex('quiz_questions', 'document_id');
};

exports.down = (pgm) => {
  pgm.dropTable('quiz_questions');
  pgm.dropTable('briefing_entries');
  pgm.dropTable('learning_item_versions');
  pgm.dropTable('learning_items');
};
