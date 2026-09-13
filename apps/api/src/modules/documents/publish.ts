/**
 * Cross-lane publish entry point (canonical name, L2-owned):
 *   publishDocument(tx, doc, { actorId, label, suggestionId? })
 * `doc` may be the assembled document or just its id. Runs inside the caller's transaction,
 * bumps `documents.current_version`, writes the `document_versions` snapshot and returns it.
 */
export { publishDocument, type PublishOptions } from './repo.js';
