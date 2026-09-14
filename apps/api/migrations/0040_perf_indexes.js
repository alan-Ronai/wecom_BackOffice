/**
 * §11 non-functional requirement: library reads < 300 ms and search < 500 ms p95 at
 * 5,000 documents (`apps/api/scripts/perf-check.ts`, run against fixture data from
 * `apps/api/scripts/load-fixture.ts`). None of these columns had an index — every join
 * against them (assembleMany's per-document phases/steps/actions/outcomes/branch-options
 * fetch, listCards' step-count/shared-block card aggregate) was a sequential scan that
 * gets slower as the library grows, even though the query shape itself already batches
 * with `= any($1)` instead of one row at a time.
 */
exports.up = (pgm) => {
  pgm.createIndex('phases', 'document_id');
  pgm.createIndex('steps', 'document_id');
  pgm.createIndex('steps', 'phase_id');
  pgm.createIndex('steps', 'block_id');
  pgm.createIndex('step_actions', 'step_id');
  pgm.createIndex('step_outcomes', 'step_id');
  pgm.createIndex('step_branch_options', 'branch_id');
  pgm.createIndex('document_versions', 'document_id');
  pgm.createIndex('crm_fields', ['status']);
  // listCards' `updated` sort and `status` filter.
  pgm.createIndex('documents', 'updated_at');
  pgm.createIndex('documents', 'status');
};

exports.down = (pgm) => {
  pgm.dropIndex('documents', 'status');
  pgm.dropIndex('documents', 'updated_at');
  pgm.dropIndex('crm_fields', ['status']);
  pgm.dropIndex('document_versions', 'document_id');
  pgm.dropIndex('step_branch_options', 'branch_id');
  pgm.dropIndex('step_outcomes', 'step_id');
  pgm.dropIndex('step_actions', 'step_id');
  pgm.dropIndex('steps', 'block_id');
  pgm.dropIndex('steps', 'phase_id');
  pgm.dropIndex('steps', 'document_id');
  pgm.dropIndex('phases', 'document_id');
};
