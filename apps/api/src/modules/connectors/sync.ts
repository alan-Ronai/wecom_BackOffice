import type pg from 'pg';
import type { Connector, ConnectorRegistry, RemoteChange, RemoteItem, RemoteRef } from '@wecom/connectors';
import type { SourceContent } from '@wecom/connectors';
import { makeEvent, type Block, type Document, type Event } from '@wecom/shared';
import type { ConnectorsRepo, SyncLinkRow } from './repo.js';

/**
 * L5 owns the real implementation (`apps/api/src/modules/sources/revisions.ts`);
 * L6 depends only on this shape, and tests supply a fake.
 */
export interface SourceRevisionService {
  ingest(
    sourceId: string,
    content: SourceContent,
    actorId: string | null,
    raw?: Buffer,
  ): Promise<{ revisionId: string }>;
}

/** L2 owns the real implementation; L6 depends only on this shape. */
export interface DocumentsService {
  getById(id: string): Promise<Document | null>;
  getVersionSnapshot(id: string, version: number): Promise<Document | null>;
  getBlocksFor(doc: Document): Promise<Block[]>;
  ensureSourceForConnector(
    connectorId: string,
    externalId: string,
    title: string,
  ): Promise<{ sourceId: string }>;
  replaceStructure(id: string, doc: Document, actorId: string | null, label: string): Promise<Document>;
}

export interface EventBus {
  publish(e: Event): void;
}

export interface SyncDeps {
  repo: ConnectorsRepo;
  registry: ConnectorRegistry;
  db: pg.Pool;
  revisions: SourceRevisionService;
  documents: DocumentsService;
  events: EventBus;
}

export interface RunResult {
  imported: number;
  pushed: number;
  conflicts: number;
  linked: number;
}

/** Result of `syncLink`: either the requested direction ran, or both sides had moved. */
export type SyncLinkOutcome =
  /** `errors` explains a zero result the caller would otherwise have to guess at. */
  | { conflict: false; result: RunResult; link: SyncLinkRow; errors?: string[] }
  | { conflict: true; link: SyncLinkRow };

export interface ResolveBody {
  resolution: 'ours' | 'theirs' | 'merged';
  merged?: Document;
  /** Version label for the merge commit; the sync UI passes the reviewer's wording. */
  label?: string;
}

/**
 * Two-way sync between the library and a remote connector.
 *
 * States of a `sync_links` row: `synced`, `pending_import`, `pending_push`,
 * `conflict`. On every reconciliation both sides are compared against the
 * recorded baseline (`base_remote_hash`, `base_local_version`); the remote is
 * never overwritten while both sides have moved — that becomes a `conflict` a
 * lead resolves through the review queue.
 */
export class SyncService {
  constructor(private d: SyncDeps) {}

  /** Read-through for callers that need the assembled document without the DB shape. */
  documentOf(documentId: string): Promise<Document | null> {
    return this.d.documents.getById(documentId);
  }

  private async connectorFor(connectorId: string): Promise<{ conn: Connector<unknown>; cfg: unknown }> {
    const row = await this.d.repo.get(connectorId);
    if (!row) throw new Error('connector not found: ' + connectorId);
    return { conn: this.d.registry.get(row.type), cfg: this.d.repo.config(row) };
  }

  async runConnector(connectorId: string, actorId: string | null): Promise<RunResult> {
    const { conn, cfg } = await this.connectorFor(connectorId);
    const result: RunResult = { imported: 0, pushed: 0, conflicts: 0, linked: 0 };
    const remote = await conn.listRemote(cfg);
    const links = await this.d.repo.links(connectorId);
    const byExternal = new Map<string, SyncLinkRow>(links.map((l) => [l.external_id, l]));
    for (const r of remote) {
      const link = byExternal.get(r.externalId);
      if (!link) {
        await this.linkNew(connectorId, conn, cfg, r, actorId);
        result.linked++;
        continue;
      }
      await this.reconcile(conn, cfg, link, r, actorId, result);
      byExternal.delete(r.externalId);
    }
    // Links whose remote item disappeared (deleted in WordPress) stay in place;
    // a lead sees them in the parity report.
    for (const l of byExternal.values())
      if (l.state !== 'conflict') await this.reconcile(conn, cfg, l, null, actorId, result);
    await this.d.repo.setRun(connectorId, 'ok', { lastRun: result });
    this.d.events.publish(
      makeEvent('sync.completed', {
        connectorId,
        imported: result.imported,
        pushed: result.pushed,
        conflicts: result.conflicts,
      }),
    );
    return result;
  }

  private async linkNew(
    connectorId: string,
    conn: Connector<unknown>,
    cfg: unknown,
    r: RemoteItem,
    actorId: string | null,
  ): Promise<void> {
    const { sourceId } = await this.d.documents.ensureSourceForConnector(connectorId, r.externalId, r.title);
    const content = await conn.fetch(cfg, r.externalId);
    await this.d.revisions.ingest(sourceId, content, actorId);
    // No document yet: the link row is created by afterSuggestionsApplied once
    // the new-card suggestion is applied.
  }

  private async reconcile(
    conn: Connector<unknown>,
    cfg: unknown,
    link: SyncLinkRow,
    r: RemoteItem | null,
    actorId: string | null,
    result: RunResult,
  ): Promise<void> {
    const doc = await this.d.documents.getById(link.document_id);
    if (!doc) return;
    const remoteChanged = !!r && r.hash !== link.base_remote_hash;
    const localChanged = doc.currentVersion !== link.base_local_version;
    if (!remoteChanged && !localChanged) {
      if (link.state !== 'synced') await this.d.repo.setLinkState(link.id, 'synced');
      return;
    }
    if (remoteChanged && !localChanged) {
      const content = await conn.fetch(cfg, r!.externalId);
      if (link.source_id) await this.d.revisions.ingest(link.source_id, content, actorId);
      await this.d.repo.setLinkState(link.id, 'pending_import');
      result.imported++;
      return;
    }
    if (!remoteChanged && localChanged) {
      if (!conn.describe().capabilities.write) {
        await this.d.repo.setLinkState(link.id, 'pending_push');
        return;
      }
      await this.pushLink(conn, cfg, link, doc);
      result.pushed++;
      return;
    }
    const base = await this.d.documents.getVersionSnapshot(doc.id, link.base_local_version);
    const content = await conn.fetch(cfg, r!.externalId);
    await this.d.repo.setLinkState(link.id, 'conflict', {
      base,
      remote: content.paragraphs,
      local: doc,
      remoteHash: r!.hash,
      remoteUpdatedAt: r!.updatedAt,
      detectedAt: new Date().toISOString(),
    });
    this.d.events.publish(
      makeEvent('sync.conflict', {
        connectorId: link.connector_id,
        documentId: doc.id,
        externalId: link.external_id,
      }),
    );
    result.conflicts++;
  }

  /**
   * `POST /sync/links/:id/sync` — the per-row "ייבא עכשיו" / "דחוף עכשיו". Unlike
   * `runConnector`, the operator picked a direction, but the conflict rule still
   * applies first: if both sides moved since the baseline, neither direction may
   * overwrite the other silently, so this records the conflict (same shape
   * `reconcile` writes, visible through `GET /sync/links/:id/conflict`) and hands
   * the caller the link row back rather than the requested result.
   */
  async syncLink(
    link: SyncLinkRow,
    direction: 'import' | 'push',
    actorId: string | null,
  ): Promise<SyncLinkOutcome> {
    const { conn, cfg } = await this.connectorFor(link.connector_id);
    const doc = await this.d.documents.getById(link.document_id);
    if (!doc) throw new Error('document not found');
    const content = await conn.fetch(cfg, link.external_id);
    const remoteChanged = content.hash !== link.base_remote_hash;
    const localChanged = doc.currentVersion !== link.base_local_version;
    const result: RunResult = { imported: 0, pushed: 0, conflicts: 0, linked: 0 };
    const errors: string[] = [];

    if (remoteChanged && localChanged) {
      const base = await this.d.documents.getVersionSnapshot(doc.id, link.base_local_version);
      const remoteUpdatedAt = (content.meta?.modifiedAt as string | undefined) ?? new Date().toISOString();
      await this.d.repo.setLinkState(link.id, 'conflict', {
        base,
        remote: content.paragraphs,
        local: doc,
        remoteHash: content.hash,
        remoteUpdatedAt,
        detectedAt: new Date().toISOString(),
      });
      this.d.events.publish(
        makeEvent('sync.conflict', {
          connectorId: link.connector_id,
          documentId: doc.id,
          externalId: link.external_id,
        }),
      );
      const fresh = (await this.d.repo.linkById(link.id)) ?? { ...link, state: 'conflict' as const };
      return { conflict: true, link: fresh };
    }

    if (direction === 'import') {
      if (remoteChanged) {
        if (link.source_id) await this.d.revisions.ingest(link.source_id, content, actorId);
        await this.d.repo.setLinkState(link.id, 'pending_import');
        result.imported = 1;
      } else if (!localChanged && link.state !== 'synced') {
        await this.d.repo.setLinkState(link.id, 'synced');
      }
    } else {
      if (localChanged) {
        await this.pushLink(conn, cfg, link, doc);
        result.pushed = 1;
      } else if (!remoteChanged && link.state !== 'synced') {
        await this.d.repo.setLinkState(link.id, 'synced');
      } else if (remoteChanged) {
        // Asked to push, but the local side has nothing new and the *remote* moved. Pushing
        // would overwrite that change with an identical local version, so this does nothing —
        // and used to say nothing either, returning `{pushed: 0}` with no explanation.
        errors.push('הצד המרוחק השתנה ואין שינוי מקומי לדחוף — ייבא אותו או פתור את הקונפליקט');
      }
    }

    this.d.events.publish(
      makeEvent('sync.completed', {
        connectorId: link.connector_id,
        imported: result.imported,
        pushed: result.pushed,
        conflicts: result.conflicts,
      }),
    );
    const fresh = (await this.d.repo.linkById(link.id)) ?? link;
    return { conflict: false, result, link: fresh, errors };
  }

  private async pushLink(
    conn: Connector<unknown>,
    cfg: unknown,
    link: SyncLinkRow,
    doc: Document,
  ): Promise<SyncLinkRow> {
    const blocks = await this.d.documents.getBlocksFor(doc);
    const ref = await conn.push(cfg, link.external_id, { document: doc, html: '', blocks });
    return this.d.repo.upsertLink({
      documentId: doc.id,
      connectorId: link.connector_id,
      externalId: ref.externalId,
      sourceId: link.source_id,
      baseRemoteHash: ref.hash,
      baseLocalVersion: doc.currentVersion,
      remoteUrl: ref.url ?? null,
      state: 'synced',
    });
  }

  /** Called by L2 after a publish when the document already has a link. */
  async pushDocument(connectorId: string, documentId: string, _actorId: string | null): Promise<RemoteRef> {
    const { conn, cfg } = await this.connectorFor(connectorId);
    const doc = await this.d.documents.getById(documentId);
    if (!doc) throw new Error('document not found');
    const existing = await this.d.repo.linkByDocument(connectorId, documentId);
    if (existing && existing.state === 'conflict') throw new Error('link in conflict; resolve first');
    // No link yet: if the document came from this connector's source, update
    // that remote item rather than creating a duplicate post.
    const src = await this.sourceOfDocument(documentId, connectorId);
    const sourceId = existing?.source_id ?? src.sourceId;
    const target = existing ? existing.external_id : src.externalId;
    const blocks = await this.d.documents.getBlocksFor(doc);
    const ref = await conn.push(cfg, target, { document: doc, html: '', blocks });
    await this.d.repo.upsertLink({
      documentId,
      connectorId,
      externalId: ref.externalId,
      sourceId,
      baseRemoteHash: ref.hash,
      baseLocalVersion: doc.currentVersion,
      remoteUrl: ref.url ?? null,
      state: 'synced',
    });
    return ref;
  }

  /**
   * L2's publish hook: after a successful publish, push the new version to every
   * connector whose link is in parity. Links in `conflict` are left alone — the
   * remote is never overwritten until a lead resolves them.
   */
  async pushOnPublish(documentId: string, actorId: string | null): Promise<RemoteRef[]> {
    const links = await this.d.repo.linksForDocument(documentId);
    const out: RemoteRef[] = [];
    for (const l of links)
      if (l.state === 'synced') out.push(await this.pushDocument(l.connector_id, documentId, actorId));
    return out;
  }

  /** Webhook path: the same rules, but only for the listed external ids. */
  async handleRemoteChanges(connectorId: string, changes: RemoteChange[]): Promise<void> {
    const { conn, cfg } = await this.connectorFor(connectorId);
    const result: RunResult = { imported: 0, pushed: 0, conflicts: 0, linked: 0 };
    for (const ch of changes) {
      const link = await this.d.repo.linkByRemote(connectorId, ch.externalId);
      if (ch.kind === 'deleted') {
        if (link) await this.d.repo.setLinkState(link.id, 'pending_push', { remoteDeleted: true, at: ch.at });
        continue;
      }
      const items = await conn.listRemote(cfg, new Date(Date.parse(ch.at) - 60_000).toISOString());
      const r =
        items.find((i) => i.externalId === ch.externalId) ??
        (await (async () => {
          const c = await conn.fetch(cfg, ch.externalId);
          return {
            externalId: ch.externalId,
            title: c.title,
            hash: c.hash,
            updatedAt: ch.at,
            kind: '',
          } as RemoteItem;
        })());
      if (!link) {
        await this.linkNew(connectorId, conn, cfg, r, null);
        result.linked++;
      } else await this.reconcile(conn, cfg, link, r, null, result);
    }
    this.d.events.publish(
      makeEvent('sync.completed', {
        connectorId,
        imported: result.imported,
        pushed: result.pushed,
        conflicts: result.conflicts,
      }),
    );
  }

  async resolveConflict(link: SyncLinkRow, body: ResolveBody, actorId: string | null): Promise<SyncLinkRow> {
    const { conn, cfg } = await this.connectorFor(link.connector_id);
    const doc = await this.d.documents.getById(link.document_id);
    if (!doc) throw new Error('document not found');
    if (body.resolution === 'ours') return this.pushLink(conn, cfg, link, doc);
    if (body.resolution === 'theirs') {
      const content = await conn.fetch(cfg, link.external_id);
      if (link.source_id) await this.d.revisions.ingest(link.source_id, content, actorId);
      const row = await this.d.repo.upsertLink({
        documentId: doc.id,
        connectorId: link.connector_id,
        externalId: link.external_id,
        sourceId: link.source_id,
        baseRemoteHash: content.hash,
        baseLocalVersion: doc.currentVersion,
        remoteUrl: link.remote_url,
        state: 'pending_import',
      });
      await this.d.repo.setLinkState(link.id, 'pending_import');
      return { ...row, state: 'pending_import' };
    }
    if (!body.merged) throw new Error('merged document required');
    const merged = await this.d.documents.replaceStructure(
      doc.id,
      body.merged,
      actorId,
      body.label ?? 'מיזוג סנכרון WordPress',
    );
    return this.pushLink(conn, cfg, link, merged);
  }

  /** L5 calls this after applying accepted suggestions from a connector-backed source. */
  async afterSuggestionsApplied(sourceId: string, documentId: string, newVersion: number): Promise<void> {
    const rows = await this.d.db.query<{ connector_id: string | null; external_id: string | null }>(
      'select s.connector_id, s.external_id from sources s where s.id=$1',
      [sourceId],
    );
    const row = rows.rows[0];
    if (!row || !row.connector_id || !row.external_id) return;
    const { conn, cfg } = await this.connectorFor(row.connector_id);
    const content = await conn.fetch(cfg, row.external_id);
    await this.d.repo.upsertLink({
      documentId,
      connectorId: row.connector_id,
      externalId: row.external_id,
      sourceId,
      baseRemoteHash: content.hash,
      baseLocalVersion: newVersion,
      state: 'synced',
    });
  }

  private async sourceOfDocument(
    documentId: string,
    connectorId: string,
  ): Promise<{ sourceId: string | null; externalId: string | null }> {
    const r = await this.d.db.query<{ source_id: string | null; external_id: string | null }>(
      'select s.id as source_id, s.external_id from documents d join sources s on s.id=d.source_id and s.connector_id=$2 where d.id=$1',
      [documentId, connectorId],
    );
    const row = r.rows[0];
    return { sourceId: row?.source_id ?? null, externalId: row?.external_id ?? null };
  }
}
