/**
 * Wave 6 (X3): field-level suggestion editing and partial apply.
 *
 * `edit_diff` is the server-derived row diff between `payload` and `edited_payload`
 * (analytics counts "edited then accepted" from it, not from the client). `applied_parts`
 * records which row ids a partial accept applied. `parent_id` links a remainder suggestion
 * (the rows a partial accept left out, re-queued as a pending suggestion) to its original —
 * `on delete set null` so purging a parent never cascades into an editor's pending work.
 *
 * `suggestions_status_decided_idx` is what the acceptance analytics aggregate reads: every
 * bucket filters on `status` and averages over `decided_at`.
 */
exports.up = (pgm) => {
  pgm.addColumns('suggestions', {
    edit_diff: { type: 'jsonb' },
    applied_parts: { type: 'jsonb' },
    parent_id: { type: 'uuid', references: 'suggestions', onDelete: 'SET NULL' },
  });
  pgm.createIndex('suggestions', ['status', 'decided_at'], { name: 'suggestions_status_decided_idx' });
  pgm.createIndex('suggestions', 'parent_id', { name: 'suggestions_parent_idx' });
};

exports.down = (pgm) => {
  pgm.dropIndex('suggestions', 'parent_id', { name: 'suggestions_parent_idx' });
  pgm.dropIndex('suggestions', ['status', 'decided_at'], { name: 'suggestions_status_decided_idx' });
  pgm.dropColumns('suggestions', ['edit_diff', 'applied_parts', 'parent_id']);
};
