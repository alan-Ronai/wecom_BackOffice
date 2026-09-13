/**
 * Hot lookups on every connector reconcile that had no index:
 * `sources.connector_id` (ConnectorsRepo + the documents adapter's
 * ensureSourceForConnector) and `sync_links.document_id` (pushOnPublish, which now
 * runs on every publish).
 */
exports.up = (pgm) => {
  pgm.createIndex('sources', 'connector_id', { name: 'sources_connector_idx' });
  pgm.createIndex('sources', ['connector_id', 'external_id'], { name: 'sources_connector_external_idx' });
  pgm.createIndex('sync_links', 'document_id', { name: 'sync_links_document_idx' });
};

exports.down = (pgm) => {
  pgm.dropIndex('sync_links', 'document_id', { name: 'sync_links_document_idx' });
  pgm.dropIndex('sources', ['connector_id', 'external_id'], { name: 'sources_connector_external_idx' });
  pgm.dropIndex('sources', 'connector_id', { name: 'sources_connector_idx' });
};
