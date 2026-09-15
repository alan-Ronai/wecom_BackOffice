/**
 * Wave 5 (V3): knowledge gaps found by the nightly heuristics (spec §1.7, §3) and their run log.
 *
 * `(kind, key)` is the identity of a gap, not the row id: the nightly run re-derives the same
 * candidates every night, so a repeat sighting has to land on the row the operator already
 * dismissed rather than create a second one. `topic_id` deliberately carries no foreign key —
 * `topics` is W1's and a deleted topic must not block the run, exactly as `topic_views` does.
 */
const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });

exports.up = (pgm) => {
  pgm.createTable('knowledge_gaps', {
    id: id(pgm),
    // The check lives in the explicit `addConstraint` below so its name is deterministic.
    kind: { type: 'text', notNull: true },
    key: { type: 'text', notNull: true },
    title: { type: 'text', notNull: true },
    evidence: { type: 'jsonb', notNull: true, default: '{}' },
    score: { type: 'numeric(10,3)', notNull: true, default: 0 },
    status: {
      type: 'text',
      notNull: true,
      default: 'open',
      check: "status in ('open','dismissed','resolved')",
    },
    suggested_action: {
      type: 'text',
      notNull: true,
      check: "suggested_action in ('create','update','add_question','review')",
    },
    document_id: { type: 'uuid', references: 'documents', onDelete: 'set null' },
    topic_id: 'uuid', // topics.id; no FK so V1/V2 ordering and topic deletion never block
    world_slug: 'text',
    first_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    dismissed_by: { type: 'uuid', references: 'users' },
    dismissed_reason: 'text',
    dismissed_at: 'timestamptz',
    resolved_document_id: { type: 'uuid', references: 'documents', onDelete: 'set null' },
    resolved_at: 'timestamptz',
  });
  pgm.addConstraint('knowledge_gaps', 'knowledge_gaps_kind_check', {
    check:
      "kind in ('zero_results','feedback_cluster','stale_high_traffic','topic_without_procedure','failed_question')",
  });
  pgm.createIndex('knowledge_gaps', ['kind', 'key'], {
    unique: true,
    name: 'knowledge_gaps_kind_key_uniq',
  });
  pgm.createIndex('knowledge_gaps', ['status', 'score'], { name: 'knowledge_gaps_status_score_idx' });
  pgm.createIndex('knowledge_gaps', 'document_id', { name: 'knowledge_gaps_document_idx' });

  pgm.createTable('gap_runs', {
    id: id(pgm),
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    finished_at: 'timestamptz',
    detected: { type: 'integer', notNull: true, default: 0 },
    updated: { type: 'integer', notNull: true, default: 0 },
    resolved: { type: 'integer', notNull: true, default: 0 },
    error: 'text',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('gap_runs');
  pgm.dropTable('knowledge_gaps');
};
