/**
 * Wave 6 (X6) — the seams between the lanes' own migrations.
 *
 * The plan reserved 0054 for the foreign keys 0052 and 0053 could not declare across lane
 * boundaries. They turned out to be declarable after all — 0052 carries
 * `ai_proposed_edits.document_id → documents`, `ai_messages.refined_suggestion_id → suggestions`
 * and `ai_conversations.source_revision_id → source_revisions`, and 0053 carries
 * `suggestions.parent_id → suggestions` — so nothing here re-declares them. What is left is the
 * indexing no single lane could see the need for, because each need spans two lanes:
 *
 * 1. `ai_proposed_edits.message_id` and `ai_message_feedback.message_id` are `on delete cascade`
 *    foreign keys with no index. Postgres does not index a referencing column automatically, so
 *    deleting a conversation — which `DELETE /admin/ai/conversations/:id` does, and which cascades
 *    through `ai_messages` — sequentially scanned both children once per message row.
 * 2. `suggestions(model, prompt_version)` is what `GET /suggestions/analytics` groups by. The
 *    columns are X1's (0051) and the query is X3's (0053); neither lane had both halves.
 * 3. `ai_conversations(deleted_at)` — every list route filters `deleted_at is null`, and X2's
 *    delete is a soft delete, so the dead rows accumulate in front of every scan.
 *
 * All four are `ifNotExists` so re-running on a database that already has them is a no-op.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createIndex('ai_proposed_edits', 'message_id', {
    name: 'ai_proposed_edits_message_idx',
    ifNotExists: true,
  });
  pgm.createIndex('ai_message_feedback', 'message_id', {
    name: 'ai_message_feedback_message_idx',
    ifNotExists: true,
  });
  pgm.createIndex('suggestions', ['model', 'prompt_version'], {
    name: 'suggestions_model_prompt_idx',
    ifNotExists: true,
  });
  pgm.createIndex('ai_conversations', 'deleted_at', {
    name: 'ai_conversations_deleted_idx',
    ifNotExists: true,
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('ai_conversations', 'deleted_at', {
    name: 'ai_conversations_deleted_idx',
    ifExists: true,
  });
  pgm.dropIndex('suggestions', ['model', 'prompt_version'], {
    name: 'suggestions_model_prompt_idx',
    ifExists: true,
  });
  pgm.dropIndex('ai_message_feedback', 'message_id', {
    name: 'ai_message_feedback_message_idx',
    ifExists: true,
  });
  pgm.dropIndex('ai_proposed_edits', 'message_id', {
    name: 'ai_proposed_edits_message_idx',
    ifExists: true,
  });
};
