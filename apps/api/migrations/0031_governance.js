/**
 * Wave 4 (W2): status 'invalid', ownership, published_at, source-review flag,
 * and the source-document version a working version was derived from.
 * `documents.status` had no check constraint (0003); one is added now that the enum is closed.
 */
exports.up = (pgm) => {
  pgm.addColumns('documents', {
    owner_id: { type: 'uuid', references: 'users' },
    editor_id: { type: 'uuid', references: 'users' },
    approver_id: { type: 'uuid', references: 'users' },
    published_at: 'timestamptz',
    source_review_needed: { type: 'boolean', notNull: true, default: false },
    source_review_reason: 'text',
    source_review_at: 'timestamptz',
  });
  pgm.addColumns('document_versions', { source_version: 'integer' });
  pgm.addConstraint('documents', 'documents_status_check', {
    check: "status in ('draft','review','published','partial','invalid','archived')",
  });
  // Backfill: whoever last touched the row is its owner and editor; the last published version dates it.
  pgm.sql(`update documents set owner_id = updated_by, editor_id = updated_by where owner_id is null`);
  pgm.sql(`update documents d set published_at = v.at
             from (select document_id, max(created_at) at from document_versions where kind='published' group by 1) v
            where v.document_id = d.id and d.published_at is null`);
  pgm.sql(`update documents d set approver_id = v.author_id
             from (select distinct on (document_id) document_id, author_id from document_versions
                    where kind='published' order by document_id, version desc) v
            where v.document_id = d.id and d.approver_id is null`);
  pgm.createIndex('documents', 'source_review_needed', {
    where: 'source_review_needed',
    name: 'documents_source_review_idx',
  });
};
exports.down = (pgm) => {
  pgm.dropIndex('documents', 'source_review_needed', { name: 'documents_source_review_idx' });
  pgm.dropConstraint('documents', 'documents_status_check');
  pgm.dropColumns('document_versions', ['source_version']);
  pgm.dropColumns('documents', [
    'owner_id',
    'editor_id',
    'approver_id',
    'published_at',
    'source_review_needed',
    'source_review_reason',
    'source_review_at',
  ]);
};
