/**
 * Wave 6 (X2): persisted AI chat. Every conversation, message, tool call and proposed edit is
 * kept (spec §1.5) so transcripts can be exported for prompt tuning later. Nothing here is a
 * write path into documents: `ai_proposed_edits` is a proposal the user decides on.
 */
const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });

exports.up = (pgm) => {
  pgm.createTable('ai_conversations', {
    id: id(pgm),
    kind: { type: 'text', notNull: true, check: "kind in ('workspace','editor','article')" },
    document_id: { type: 'uuid', references: 'documents', onDelete: 'set null' },
    source_revision_id: { type: 'uuid', references: 'source_revisions', onDelete: 'set null' },
    user_id: { type: 'uuid', notNull: true, references: 'users' },
    title: { type: 'text', notNull: true, default: '' },
    model: { type: 'text', notNull: true, default: '' },
    prompt_version: { type: 'text', notNull: true, default: '' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    deleted_at: 'timestamptz',
  });
  pgm.createIndex('ai_conversations', ['user_id', 'updated_at']);
  pgm.createIndex('ai_conversations', ['document_id', 'kind']);

  pgm.createTable('ai_messages', {
    id: id(pgm),
    conversation_id: {
      type: 'uuid',
      notNull: true,
      references: 'ai_conversations',
      onDelete: 'cascade',
    },
    seq: { type: 'integer', notNull: true },
    role: { type: 'text', notNull: true, check: "role in ('user','assistant','tool','system')" },
    content: { type: 'text', notNull: true, default: '' },
    tool_calls: 'jsonb',
    tool_results: 'jsonb',
    /**
     * The `ai_proposed_edits` row this tool turn produced. Deliberately *not* a foreign key:
     * the proposal references the message, so the pair would be a cycle no insert order can
     * satisfy. `repo.insertMessage` writes it back after `createProposedEdits`.
     */
    proposed_edits_id: 'uuid',
    refined_suggestion_id: { type: 'uuid', references: 'suggestions', onDelete: 'set null' },
    tokens_in: { type: 'integer', notNull: true, default: 0 },
    tokens_out: { type: 'integer', notNull: true, default: 0 },
    latency_ms: { type: 'integer', notNull: true, default: 0 },
    model: { type: 'text', notNull: true, default: '' },
    prompt_version: { type: 'text', notNull: true, default: '' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('ai_messages', 'ai_messages_conversation_id_seq_key', {
    unique: ['conversation_id', 'seq'],
  });

  pgm.createTable(
    'ai_message_feedback',
    {
      message_id: { type: 'uuid', notNull: true, references: 'ai_messages', onDelete: 'cascade' },
      user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
      rating: { type: 'text', notNull: true, check: "rating in ('up','down')" },
      note: { type: 'text', notNull: true, default: '' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
    { constraints: { primaryKey: ['message_id', 'user_id'] } },
  );

  pgm.createTable('ai_proposed_edits', {
    id: id(pgm),
    message_id: { type: 'uuid', notNull: true, references: 'ai_messages', onDelete: 'cascade' },
    document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' },
    base_source_version: { type: 'integer', notNull: true },
    ops: { type: 'jsonb', notNull: true },
    status: {
      type: 'text',
      notNull: true,
      default: 'proposed',
      check: "status in ('proposed','accepted','rejected','partially_accepted')",
    },
    decided_by: { type: 'uuid', references: 'users' },
    decided_at: 'timestamptz',
    resulting_source_version: 'integer',
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('ai_proposed_edits', ['document_id', 'status']);
};

exports.down = (pgm) => {
  for (const t of ['ai_proposed_edits', 'ai_message_feedback', 'ai_messages', 'ai_conversations'])
    pgm.dropTable(t);
};
