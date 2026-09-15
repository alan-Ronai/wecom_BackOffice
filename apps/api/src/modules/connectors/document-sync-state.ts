import type { Pool, PoolClient } from 'pg';
import type { DocumentSyncState, DocumentSyncLinkState } from '@wecom/shared';

/** Worst-first, the order the article badge and the source-review flag care about. */
const RANK: Record<DocumentSyncLinkState['state'], number> = {
  conflict: 0,
  pending_push: 1,
  pending_import: 2,
  synced: 3,
};

export const syncFlagReason = (overall: DocumentSyncState['overall']): string | null =>
  overall === 'conflict'
    ? 'קונפליקט בסנכרון – המקור המרוחק והפריט השתנו שניהם'
    : overall === 'pending_push'
      ? 'ממתין לדחיפה למקור המרוחק'
      : null;

/**
 * `GET /documents/:id/sync-state` and the wave-5 source-review flag both read this. It does not
 * check visibility — callers that answer to a user must `assertVisibleDocument` first.
 */
/**
 * Strips the connector-operations fields from a state, for a caller who may read the document
 * but does not hold `sources.manage` (post-pilot L4).
 *
 * `GET /documents/:id/sync-state` answers to `docs.read` — every agent in the building — because
 * the article header needs its badge. The badge needs the *state*; it does not need the
 * connector's name and type, the remote URL, or how the connector's last run went. Those
 * describe the integration rather than the article, and they are the things an agent has no
 * business knowing and `sources.manage` exists to gate.
 */
export const redactSyncState = (state: DocumentSyncState): DocumentSyncState => ({
  ...state,
  links: state.links.map((l) => ({
    ...l,
    connectorName: null,
    connectorType: null,
    remoteUrl: null,
    connectorLastStatus: null,
    connectorLastRunAt: null,
  })),
});

export async function getDocumentSyncState(
  db: Pool | PoolClient,
  documentId: string,
): Promise<DocumentSyncState> {
  const r = await db.query<Record<string, unknown>>(
    `select l.id, l.connector_id, l.external_id, l.remote_url, l.state, l.base_local_version,
            l.last_synced_at, c.name as connector_name, c.type as connector_type,
            c.last_status as connector_last_status, c.last_run_at as connector_last_run_at,
            d.current_version
       from sync_links l
       join connectors c on c.id = l.connector_id
       join documents d on d.id = l.document_id
      where l.document_id = $1
      order by l.created_at`,
    [documentId],
  );
  const iso = (v: unknown) => (v ? new Date(v as Date).toISOString() : null);
  const links: DocumentSyncLinkState[] = r.rows
    .map((row) => {
      const state = row.state as DocumentSyncLinkState['state'];
      const baseLocalVersion = (row.base_local_version as number | null) ?? null;
      const currentLocalVersion = (row.current_version as number) ?? 0;
      return {
        linkId: row.id as string,
        connectorId: row.connector_id as string,
        connectorName: row.connector_name as string,
        connectorType: row.connector_type as string,
        externalId: row.external_id as string,
        remoteUrl: (row.remote_url as string | null) ?? null,
        state,
        localChanged: baseLocalVersion !== null && currentLocalVersion !== baseLocalVersion,
        remoteChanged: state === 'pending_import' || state === 'conflict',
        currentLocalVersion,
        baseLocalVersion,
        lastSyncedAt: iso(row.last_synced_at),
        connectorLastStatus: (row.connector_last_status as string | null) ?? null,
        connectorLastRunAt: iso(row.connector_last_run_at),
      };
    })
    .sort((a, b) => RANK[a.state] - RANK[b.state]);
  const overall: DocumentSyncState['overall'] = links[0]?.state ?? 'unlinked';
  return { documentId, overall, flagReason: syncFlagReason(overall), links };
}
