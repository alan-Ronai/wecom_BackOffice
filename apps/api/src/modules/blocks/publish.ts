/**
 * Cross-lane block publish entry point (canonical name, L2-owned):
 *   publishBlock(tx, block, { actorId, label })
 * `block` may be the assembled block or just its id. Runs inside the caller's transaction,
 * bumps `blocks.current_version` and writes the `block_versions` snapshot.
 */
export { publishBlock, type PublishBlockOptions } from './repo.js';
