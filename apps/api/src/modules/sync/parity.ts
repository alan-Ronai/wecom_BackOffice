import type pg from 'pg';
import type { ConnectorRegistry, RemoteItem } from '@wecom/connectors';
import type { ParityConnector, ParityLinkRow } from '@wecom/shared';
import type { ConnectorRow, ConnectorsRepo } from '../connectors/repo.js';
import { localContentHash } from './hash.js';
import type { RemoteCache } from './remote-cache.js';

/**
 * The link rows the report is built from: the same join `GET /sync/links` uses, plus the published
 * snapshot the local hash is taken over.
 *
 * `current_version` is the join's, not the snapshot's: a snapshot row is written at publish time
 * and the document's row is the authority on which version is current.
 */
const LINK_SELECT = `
  select l.id, l.document_id, l.connector_id, l.external_id, l.remote_url, l.state,
         l.base_remote_hash, l.base_local_version, l.last_synced_at,
         c.name as connector_name, d.title, d.current_version,
         (select v.snapshot from document_versions v
           where v.document_id = d.id and v.version = d.current_version) as snapshot
    from sync_links l
    join connectors c on c.id = l.connector_id
    join documents d on d.id = l.document_id
   where l.connector_id = $1 and d.deleted_at is null
   order by d.title`;

interface LinkQueryRow {
  id: string;
  document_id: string;
  connector_id: string;
  external_id: string;
  remote_url: string | null;
  state: ParityLinkRow['state'];
  base_remote_hash: string | null;
  base_local_version: number | null;
  last_synced_at: Date | null;
  connector_name: string;
  title: string;
  current_version: number;
  snapshot: unknown;
}

const iso = (v: Date | string | null | undefined): string | null =>
  v == null ? null : new Date(v).toISOString();

/**
 * Which content worlds a connector owns, and therefore which published documents "should" have a
 * link to it.
 *
 * A WordPress connector declares this directly: `categoryMap` maps each remote category slug onto a
 * KB world, so its values *are* the answer. Connector types that declare nothing (the JSON file
 * connector maps a column, not a fixed world) fall back to the worlds of the documents already
 * linked to this connector — an observation rather than a declaration, but a correct one, and far
 * better than the alternative of treating "no declaration" as "the whole library", which would
 * list every unrelated document as missing a link.
 *
 * `known` is the set of world slugs that exist. Wave 4 turned worlds into rows, so a declared
 * value can no longer be validated against a static enum — a typo in `categoryMap` would
 * otherwise widen the report to a world nobody has, and the operator would read the noise as a
 * missing link. Pass `null` to accept whatever is declared (the caller has no list).
 */
export function connectorCategories(
  config: Record<string, unknown>,
  linked: string[],
  known: readonly string[] | null = null,
): string[] {
  const declared = config.categoryMap;
  const ok = (v: unknown): v is string =>
    typeof v === 'string' && v.length > 0 && (!known || known.includes(v));
  const fromConfig =
    declared && typeof declared === 'object' && !Array.isArray(declared)
      ? Object.values(declared as Record<string, unknown>).filter(ok)
      : [];
  const source = fromConfig.length ? fromConfig : linked;
  return [...new Set(source)].sort();
}

export interface ParityDeps {
  db: pg.Pool;
  repo: ConnectorsRepo;
  registry: ConnectorRegistry;
  cache: RemoteCache;
}

/** Builds one connector's parity report: every link with both sides' hashes, plus what has none. */
export async function parityFor(deps: ParityDeps, connector: ConnectorRow): Promise<ParityConnector> {
  const links = (await deps.db.query<LinkQueryRow>(LINK_SELECT, [connector.id])).rows;

  // The remote listing is fetched once per connector per window and shared by every row below.
  // A connector type that is no longer registered (a deployment rollback, a removed plugin) is a
  // listing failure, not a crash: its rows still have a local side worth showing.
  const listing = await deps.cache.get(connector.id, async () => {
    const conn = deps.registry.get(connector.type);
    return conn.listRemote(deps.repo.config(connector));
  });
  const remoteAvailable = listing.ok;
  const remoteById = new Map<string, RemoteItem>(
    listing.ok ? listing.items.map((i) => [i.externalId, i]) : [],
  );

  const items: ParityLinkRow[] = links.map((r) => {
    const remote = remoteById.get(r.external_id);
    const baseLocalVersion = r.base_local_version ?? null;
    return {
      id: r.id,
      connectorId: r.connector_id,
      connectorName: r.connector_name,
      documentId: r.document_id,
      title: r.title,
      externalId: r.external_id,
      remoteUrl: r.remote_url ?? remote?.url ?? null,
      state: r.state,
      baseLocalVersion,
      currentLocalVersion: r.current_version ?? 0,
      remoteChanged: remote ? remote.hash !== r.base_remote_hash : r.state === 'pending_import',
      localChanged: baseLocalVersion !== null && (r.current_version ?? 0) !== baseLocalVersion,
      lastSyncedAt: iso(r.last_synced_at),
      localHash: localContentHash(r.snapshot),
      remoteHash: remote?.hash ?? null,
      baseRemoteHash: r.base_remote_hash,
      remoteUpdatedAt: remote?.updatedAt ? iso(remote.updatedAt) : null,
      // An outage and a deletion both leave `remoteHash` null, and the difference decides whether
      // the right response is "wait" or "this page is gone from the CMS".
      ...(remote
        ? {}
        : {
            unlinkedReason: remoteAvailable ? ('remote_missing' as const) : ('remote_unavailable' as const),
          }),
    };
  });

  const linkedDocIds = new Set(links.map((l) => l.document_id));
  const linkedExternalIds = new Set(links.map((l) => l.external_id));
  const categories = connectorCategories(
    deps.repo.config(connector) as Record<string, unknown>,
    (
      await deps.db.query<{ category: string }>(
        `select distinct d.category from sync_links l join documents d on d.id = l.document_id
          where l.connector_id = $1 and d.deleted_at is null`,
        [connector.id],
      )
    ).rows.map((r) => r.category),
    (await deps.db.query<{ slug: string }>('select slug from worlds')).rows.map((r) => r.slug),
  );

  const documents = categories.length
    ? (
        await deps.db.query<{
          id: string;
          title: string;
          category: string;
          current_version: number;
          updated_at: Date | null;
        }>(
          `select d.id, d.title, d.category, d.current_version, d.updated_at
             from documents d
            where d.status = 'published' and d.deleted_at is null and d.category = any($1::text[])
              and not exists (select 1 from sync_links l where l.document_id = d.id and l.connector_id = $2)
            order by d.title`,
          [categories, connector.id],
        )
      ).rows.map((d) => ({
        documentId: d.id,
        title: d.title,
        category: d.category as ParityConnector['unlinked']['documents'][number]['category'],
        currentVersion: d.current_version,
        updatedAt: iso(d.updated_at),
      }))
    : [];

  return {
    connectorId: connector.id,
    connectorName: connector.name,
    remoteAvailable,
    items,
    unlinked: {
      documents: documents.filter((d) => !linkedDocIds.has(d.documentId)),
      remote: (listing.ok ? listing.items : [])
        .filter((i) => !linkedExternalIds.has(i.externalId))
        .map((i) => ({
          externalId: i.externalId,
          title: i.title,
          hash: i.hash,
          kind: i.kind,
          url: i.url ?? null,
          updatedAt: iso(i.updatedAt),
        })),
    },
  };
}
