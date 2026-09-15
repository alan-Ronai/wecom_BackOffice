/**
 * Wave 5 (V2): audiences, assignments, attempts, acknowledgements, document change flags.
 * Spec §3. `item_id` is a plain uuid: `learning_items` is V1's table (0046) and may land in a
 * different worktree; V6 adds the foreign keys in 0049 once both migrations are on main.
 */
const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });

exports.up = (pgm) => {
  pgm.createTable('learning_audiences', {
    id: id(pgm),
    item_id: { type: 'uuid', notNull: true },
    role_names: { type: 'text[]', notNull: true, default: '{}' },
    world_slugs: { type: 'text[]', notNull: true, default: '{}' },
    user_ids: { type: 'uuid[]', notNull: true, default: '{}' },
    due_days: { type: 'integer', notNull: true, default: 14 },
    created_by: { type: 'uuid', references: 'users' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('learning_audiences', 'item_id');

  pgm.createTable('learning_assignments', {
    id: id(pgm),
    item_id: { type: 'uuid', notNull: true },
    item_version: { type: 'integer', notNull: true },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
    audience_id: { type: 'uuid', references: 'learning_audiences', onDelete: 'set null' },
    reason: { type: 'text', notNull: true, check: "reason in ('audience','manual','refresh')" },
    assigned_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    due_at: { type: 'timestamptz', notNull: true },
    status: {
      type: 'text',
      notNull: true,
      default: 'open',
      check: "status in ('open','completed','overdue','invalidated')",
    },
    completed_at: 'timestamptz',
    invalidated_at: 'timestamptz',
    invalidated_reason: 'text',
    refresh_reason: 'text',
    reminded_at: 'timestamptz',
  });
  pgm.addConstraint('learning_assignments', 'learning_assignments_unique', {
    unique: ['item_id', 'user_id', 'item_version', 'reason'],
  });
  pgm.createIndex('learning_assignments', ['user_id', 'status']);
  pgm.createIndex('learning_assignments', ['item_id', 'status']);
  pgm.createIndex('learning_assignments', 'due_at', { where: "status in ('open','overdue')" });

  pgm.createTable('learning_attempts', {
    id: id(pgm),
    assignment_id: {
      type: 'uuid',
      notNull: true,
      references: 'learning_assignments',
      onDelete: 'cascade',
    },
    attempt_no: { type: 'integer', notNull: true },
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    finished_at: 'timestamptz',
    score: 'integer',
    passed: 'boolean',
    // { [questionId]: { selected, correct } } — the shape V3's failed-question heuristic reads.
    answers: { type: 'jsonb', notNull: true, default: '{}' },
  });
  pgm.addConstraint('learning_attempts', 'learning_attempts_unique', {
    unique: ['assignment_id', 'attempt_no'],
  });

  pgm.createTable('learning_acknowledgements', {
    id: id(pgm),
    assignment_id: {
      type: 'uuid',
      notNull: true,
      references: 'learning_assignments',
      onDelete: 'cascade',
      unique: true,
    },
    acknowledged_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    item_version: { type: 'integer', notNull: true },
  });

  pgm.createTable('document_change_flags', {
    id: id(pgm),
    document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' },
    version: { type: 'integer', notNull: true },
    significant: { type: 'boolean', notNull: true },
    reasons: { type: 'jsonb', notNull: true, default: '[]' },
    decided_by: { type: 'uuid', references: 'users' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('document_change_flags', 'document_change_flags_unique', {
    unique: ['document_id', 'version'],
  });
  pgm.createIndex('document_change_flags', ['document_id', 'significant']);
};

exports.down = (pgm) => {
  for (const t of [
    'document_change_flags',
    'learning_acknowledgements',
    'learning_attempts',
    'learning_assignments',
    'learning_audiences',
  ])
    pgm.dropTable(t);
};
