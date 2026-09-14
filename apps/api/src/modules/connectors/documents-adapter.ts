import type pg from 'pg';
import type { Block, Document } from '@wecom/shared';
import { withTransaction } from '../../lib/sql.js';
import { publishDocument } from '../documents/publish.js';
import { getDocument, getVersion, loadBlocksMap, saveStructure } from '../documents/repo.js';
import { getSourceDocument, saveSourceDocument } from '../sourcedocs/repo.js';
import type { DocumentsService } from './sync.js';

/** `sources.kind` values a connector can own; anything else is stored as a generic json source. */
const SOURCE_KIND: Record<string, string> = { wordpress: 'wordpress', json: 'json' };

/**
 * The real binding of L6's `DocumentsService` onto L2's content modules. L6 used
 * to fall back to a stub whose `getById` returned null, which made every
 * reconciliation a silent no-op and every import a throw — `runConnector` then
 * reported `{imported:0}` and marked the connector healthy.
 */
export function documentsAdapter(pool: pg.Pool): DocumentsService {
  return {
    getById: (id) => getDocument(pool, id),

    getVersionSnapshot: (id, version) => getVersion(pool, id, version),

    async getBlocksFor(doc: Document): Promise<Block[]> {
      const ids = new Set<string>();
      for (const step of doc.phases.flatMap((p) => p.steps)) {
        if (step.blockId) ids.add(step.blockId);
        for (const ref of step.blockRefs ?? []) ids.add(ref);
      }
      if (!ids.size) return [];
      const map = await loadBlocksMap(pool);
      return [...ids].map((id) => map.get(id)).filter((b): b is Block => !!b);
    },

    async ensureSourceForConnector(connectorId, externalId, title) {
      const existing = await pool.query<{ id: string }>(
        'select id from sources where connector_id=$1 and external_id=$2 and deleted_at is null',
        [connectorId, externalId],
      );
      if (existing.rows[0]) return { sourceId: existing.rows[0].id };
      const type = await pool.query<{ type: string }>('select type from connectors where id=$1', [
        connectorId,
      ]);
      const r = await pool.query<{ id: string }>(
        'insert into sources(kind, connector_id, external_id, title) values ($1,$2,$3,$4) returning id',
        [SOURCE_KIND[type.rows[0]?.type ?? ''] ?? 'json', connectorId, externalId, title],
      );
      return { sourceId: r.rows[0].id };
    },

    getSourceHtml: async (id) => (await getSourceDocument(pool, id))?.html ?? null,

    putSourceFromRemote: (id, html, label) =>
      withTransaction(pool, async (tx) => {
        await saveSourceDocument(tx, id, { html, label, authorId: null });
      }),

    /** Conflict resolution `merged`: write the merged tree and freeze it as a `sync` version. */
    replaceStructure: (id, doc, actorId, label) =>
      withTransaction(pool, async (tx) => {
        await saveStructure(tx, id, { phases: doc.phases, related: doc.related }, actorId);
        const { doc: published } = await publishDocument(tx, id, { actorId, label, kind: 'sync' });
        return published;
      }),
  };
}
