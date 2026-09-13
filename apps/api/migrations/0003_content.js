const ts = (pgm) => ({
  created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  created_by: { type: 'uuid', references: 'users' },
  updated_by: { type: 'uuid', references: 'users' },
  deleted_at: 'timestamptz',
  deleted_by: { type: 'uuid', references: 'users' },
});
const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
exports.up = (pgm) => {
  pgm.createTable('sources', {
    id: id(pgm),
    kind: { type: 'text', notNull: true, check: "kind in ('docx','wordpress','json','csv','text')" },
    connector_id: 'uuid',
    external_id: 'text',
    title: { type: 'text', notNull: true },
    ext: 'text',
    mapping: 'jsonb',
    sync_state: { type: 'text', notNull: true, default: 'synced' },
    last_hash: 'text',
    last_synced_at: 'timestamptz',
    ...ts(pgm),
  });
  pgm.createTable('documents', {
    id: id(pgm),
    slug: { type: 'text', notNull: true, unique: true },
    code: 'text',
    title: { type: 'text', notNull: true },
    description: { type: 'text', notNull: true, default: '' },
    category: {
      type: 'text',
      notNull: true,
      check: "category in ('sim','tech','billing','plans','intl','ops')",
    },
    wave: { type: 'smallint', notNull: true, check: 'wave between 1 and 3' },
    priority: { type: 'text', notNull: true, check: "priority in ('hh','h','m','l')" },
    kind: { type: 'text', notNull: true, default: 'steps' },
    status: { type: 'text', notNull: true, default: 'draft' },
    current_version: { type: 'integer', notNull: true, default: 0 },
    source_id: { type: 'uuid', references: 'sources' },
    source_ref: 'text',
    topic_id: 'integer',
    related: { type: 'jsonb', notNull: true, default: '[]' },
    etag: { type: 'text', notNull: true, default: pgm.func('gen_random_uuid()::text') },
    search_vector: 'tsvector',
    embedding: 'vector(768)',
    ...ts(pgm),
  });
  pgm.createIndex('documents', ['category', 'wave']);
  pgm.createIndex('documents', 'search_vector', { method: 'gin' });
  pgm.createTable('document_versions', {
    id: id(pgm),
    document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' },
    version: { type: 'integer', notNull: true },
    snapshot: { type: 'jsonb', notNull: true },
    author_id: { type: 'uuid', references: 'users' },
    label: { type: 'text', notNull: true, default: '' },
    kind: { type: 'text', notNull: true, default: 'published' },
    suggestion_id: 'uuid',
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('document_versions', 'document_versions_unique', { unique: ['document_id', 'version'] });
  pgm.createTable('blocks', {
    id: id(pgm),
    slug: { type: 'text', notNull: true, unique: true },
    title: { type: 'text', notNull: true },
    kind: { type: 'text', notNull: true, default: 'step' },
    description: 'text',
    script: 'text',
    current_version: { type: 'integer', notNull: true, default: 1 },
    ...ts(pgm),
  });
  pgm.createTable('block_actions', {
    id: id(pgm),
    block_id: { type: 'uuid', notNull: true, references: 'blocks', onDelete: 'cascade' },
    position: { type: 'integer', notNull: true },
    text: { type: 'text', notNull: true },
  });
  pgm.createTable('block_outcomes', {
    id: id(pgm),
    block_id: { type: 'uuid', notNull: true, references: 'blocks', onDelete: 'cascade' },
    position: { type: 'integer', notNull: true },
    kind: { type: 'text', notNull: true },
    text: { type: 'text', notNull: true },
    goto_step_key: 'text',
  });
  pgm.createTable('block_versions', {
    id: id(pgm),
    block_id: { type: 'uuid', notNull: true, references: 'blocks', onDelete: 'cascade' },
    version: { type: 'integer', notNull: true },
    snapshot: { type: 'jsonb', notNull: true },
    author_id: { type: 'uuid', references: 'users' },
    label: { type: 'text', notNull: true, default: '' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createTable('phases', {
    id: id(pgm),
    document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' },
    position: { type: 'integer', notNull: true },
    phase_key: { type: 'text', notNull: true },
    label: { type: 'text', notNull: true, default: '' },
    note: 'text',
    route: 'text',
  });
  pgm.createTable('steps', {
    id: id(pgm),
    phase_id: { type: 'uuid', notNull: true, references: 'phases', onDelete: 'cascade' },
    document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' },
    position: { type: 'integer', notNull: true },
    step_key: { type: 'text', notNull: true },
    num: { type: 'text', notNull: true },
    title: { type: 'text', notNull: true, default: '' },
    description: 'text',
    hint: 'text',
    tone: 'text',
    block_id: { type: 'uuid', references: 'blocks' },
    block_refs: { type: 'uuid[]', notNull: true, default: '{}' },
    script: 'text',
    source_ref: 'text',
    deps: { type: 'text[]', notNull: true, default: '{}' },
    extras: 'jsonb',
  });
  pgm.addConstraint('steps', 'steps_document_key_unique', { unique: ['document_id', 'step_key'] });
  pgm.createTable('step_actions', {
    id: id(pgm),
    step_id: { type: 'uuid', notNull: true, references: 'steps', onDelete: 'cascade' },
    position: { type: 'integer', notNull: true },
    action_key: { type: 'text', notNull: true },
    text: { type: 'text', notNull: true },
  });
  pgm.createTable('step_outcomes', {
    id: id(pgm),
    step_id: { type: 'uuid', notNull: true, references: 'steps', onDelete: 'cascade' },
    position: { type: 'integer', notNull: true },
    kind: { type: 'text', notNull: true },
    text: { type: 'text', notNull: true },
    goto_step_key: 'text',
  });
  pgm.createTable('step_branches', {
    id: id(pgm),
    step_id: { type: 'uuid', notNull: true, references: 'steps', onDelete: 'cascade', unique: true },
    question: { type: 'text', notNull: true },
  });
  pgm.createTable('step_branch_options', {
    id: id(pgm),
    branch_id: { type: 'uuid', notNull: true, references: 'step_branches', onDelete: 'cascade' },
    position: { type: 'integer', notNull: true },
    kind: { type: 'text', notNull: true },
    label: { type: 'text', notNull: true },
    text: { type: 'text', notNull: true },
    goto_step_key: 'text',
  });
  pgm.createTable('crm_fields', {
    name: { type: 'text', primaryKey: true },
    status: { type: 'text', notNull: true, default: 'ok' },
    renamed_to: 'text',
    path: { type: 'text', notNull: true, default: '' },
    effective_from: 'timestamptz',
    note: 'text',
    ...ts(pgm),
  });
  pgm.createTable(
    'step_field_refs',
    {
      step_id: { type: 'uuid', notNull: true, references: 'steps', onDelete: 'cascade' },
      field_name: { type: 'text', notNull: true, references: 'crm_fields', onDelete: 'cascade' },
    },
    { constraints: { primaryKey: ['step_id', 'field_name'] } },
  );
  pgm.createTable('scripts', {
    id: id(pgm),
    title: { type: 'text', notNull: true },
    text: { type: 'text', notNull: true },
    tags: { type: 'text[]', notNull: true, default: '{}' },
    ...ts(pgm),
  });
  pgm.createTable(
    'script_refs',
    {
      script_id: { type: 'uuid', notNull: true, references: 'scripts', onDelete: 'cascade' },
      document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' },
      step_key: 'text',
    },
    { constraints: { primaryKey: ['script_id', 'document_id'] } },
  );
};
exports.down = (pgm) => {
  for (const t of [
    'script_refs',
    'scripts',
    'step_field_refs',
    'crm_fields',
    'step_branch_options',
    'step_branches',
    'step_outcomes',
    'step_actions',
    'steps',
    'phases',
    'block_versions',
    'block_outcomes',
    'block_actions',
    'blocks',
    'document_versions',
    'documents',
    'sources',
  ])
    pgm.dropTable(t);
};
