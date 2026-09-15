import type { Block, CrmField, Document } from '@wecom/shared';
import type { Tx } from '../../lib/sql.js';
import { publishAndFlag, publishFlagDeps } from '../documents/publishWithFlag.js';
import { getDocument, insertDocument, loadDocRefs, saveStructure, type Q } from '../documents/repo.js';
import { getBlock, listBlocks, updateBlock } from '../blocks/repo.js';
import { listFields, upsertField } from '../fields/repo.js';
import type { ContentApi } from './content-api.js';

/**
 * The real binding of L5's `ContentApi` onto L2's content modules — the seam the
 * lanes agreed on, resolved statically so a rename is a compile error rather than
 * a 503 at runtime (it used to be a dynamic `import('../content/index.js')` of a
 * module that was never created; every pipeline call fell through to a stub).
 *
 * Two shape mismatches are absorbed here rather than in either lane:
 *
 * 1. L2's `publishDocument`/`publishBlock` snapshot what is **in the database**;
 *    L5 mutates an assembled `Document`/`Block` in memory and expects the publish
 *    to persist it. So the adapter writes the structure first (`saveStructure` /
 *    `updateBlock`) and only then freezes the version.
 * 2. `ContentApi.publishDocument` must return the new `document_versions.id`
 *    (`suggestions.applied_version_id` is looked up by it — a missing id silently
 *    drops the attribution), which L2's repo now returns as `versionId`.
 */

/** Writes are always handed a transaction client; reads may use the pool. */
const tx = (c: Q): Tx => c as Tx;

export const contentAdapter: ContentApi = {
  getDocument: (client, id) => getDocument(client, id),

  async publishDocument(client, doc, opts) {
    // Persist the caller's in-memory edits before the snapshot is frozen.
    if (doc.phases.length)
      await saveStructure(tx(client), doc.id, { phases: doc.phases, related: doc.related }, opts.actorId);
    /**
     * A-C2: an accepted suggestion is an editorial publish. A model-applied change that removes
     * a step is the textbook significant change, so it records §1.5's flag and fans out the
     * refresh like any other — `override: undefined`, because there is no editor at a checkbox
     * here either. The notifier and the bus come from the ambient holder: `ContentApi` hands
     * this method a database client and nothing else.
     */
    const r = await publishAndFlag(tx(client), publishFlagDeps(), {
      doc: doc.id,
      actorId: opts.actorId,
      label: opts.label,
      suggestionId: opts.suggestionId ?? null,
      kind: opts.kind ?? 'published',
    });
    return { document: r.doc, versionId: r.versionId, version: r.version };
  },

  async createDocument(client, input, actorId) {
    const created = await insertDocument(tx(client), input, actorId);
    if (input.sourceId || input.sourceRef)
      await client.query(
        'update documents set source_id=coalesce($2, source_id), source_ref=coalesce($3, source_ref) where id=$1',
        [created.id, input.sourceId ?? null, input.sourceRef ?? null],
      );
    if (input.phases?.length) await saveStructure(tx(client), created.id, { phases: input.phases }, actorId);
    return (await getDocument(client, created.id)) as Document;
  },

  listDocumentRefs: (client) => loadDocRefs(client),

  getBlock: (client, id) => getBlock(client, id),

  async publishBlock(client, block, opts) {
    // `updateBlock` rewrites actions/outcomes, publishes a block version and
    // recomputes the derived text of every document that embeds the block.
    const r = await updateBlock(
      tx(client),
      block.id,
      {
        slug: block.slug,
        title: block.title,
        kind: block.kind,
        description: block.description,
        script: block.script,
        actions: block.actions,
        outcomes: block.outcomes,
        label: opts.label,
      },
      opts.actorId,
    );
    return { block: r.block as Block, version: r.block.currentVersion };
  },

  listBlocks: (client) => listBlocks(client),

  listFields: (client) => listFields(client) as Promise<CrmField[]>,

  upsertField: (client, input, actorId) => upsertField(tx(client), input, actorId),
};
