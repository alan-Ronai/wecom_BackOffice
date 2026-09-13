import type pg from 'pg';
import type { z } from 'zod';
import type { Source, SourceKindSchema, SourceRevision } from '@wecom/shared';
import type { SourceContent } from '@wecom/connectors';
import { QUEUES } from '../../plugins/boss.js';

export type SourceKind = z.infer<typeof SourceKindSchema>;

/** The slice of pg-boss this service needs; the real one is `app.boss` (L1). */
export interface JobQueue {
  send(name: string, data: { revisionId: string }, opts?: { singletonKey?: string }): Promise<string | null>;
}

const rowToSource = (r: Record<string, unknown>): Source => ({
  id: r.id as string,
  kind: r.kind as Source['kind'],
  connectorId: (r.connector_id as string) ?? null,
  externalId: (r.external_id as string) ?? null,
  title: r.title as string,
  ext: (r.ext as string) ?? undefined,
  mapping: (r.mapping as Record<string, string>) ?? undefined,
  syncState: r.sync_state as Source['syncState'],
  lastHash: (r.last_hash as string) ?? null,
  lastSyncedAt: r.last_synced_at ? (r.last_synced_at as Date).toISOString() : null,
  linkedDocuments: Number(r.linked_documents ?? 0),
  pendingSuggestions: Number(r.pending_suggestions ?? 0),
  updatedAt: (r.updated_at as Date).toISOString(),
});

const rowToRevision = (r: Record<string, unknown>): SourceRevision => ({
  id: r.id as string,
  sourceId: r.source_id as string,
  hash: r.hash as string,
  paragraphs: r.paragraphs as SourceRevision['paragraphs'],
  importedAt: (r.imported_at as Date).toISOString(),
  importedBy: (r.imported_by as string) ?? null,
  accepted: r.accepted as boolean,
  meta: (r.meta as Record<string, unknown>) ?? undefined,
});

/**
 * The pipeline entry point for every lane: L5's uploads, L6's connectors and the
 * watched-folder job all land here. Ingest is idempotent on the content hash.
 */
export class SourceRevisionService {
  constructor(
    readonly pool: pg.Pool,
    private readonly queue: JobQueue,
  ) {}

  async createSource(
    input: {
      kind: SourceKind;
      title: string;
      ext?: string;
      connectorId?: string | null;
      externalId?: string | null;
      mapping?: Record<string, string>;
    },
    actorId: string | null,
  ): Promise<{ id: string }> {
    const r = await this.pool.query(
      `insert into sources(kind, title, ext, connector_id, external_id, mapping, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$7) returning id`,
      [
        input.kind,
        input.title,
        input.ext ?? null,
        input.connectorId ?? null,
        input.externalId ?? null,
        input.mapping ? JSON.stringify(input.mapping) : null,
        actorId,
      ],
    );
    return { id: r.rows[0].id as string };
  }

  /**
   * Stores a new revision unless an identical hash already exists for the source, then
   * marks the source pending and enqueues `pipeline.process` keyed on the revision id.
   */
  async ingest(
    sourceId: string,
    content: SourceContent,
    actorId: string | null,
    raw?: Buffer,
  ): Promise<{ revisionId: string; duplicate: boolean }> {
    const dup = await this.pool.query(`select id from source_revisions where source_id=$1 and hash=$2`, [
      sourceId,
      content.hash,
    ]);
    if (dup.rowCount) return { revisionId: dup.rows[0].id as string, duplicate: true };
    const client = await this.pool.connect();
    let revisionId: string;
    try {
      await client.query('begin');
      const r = await client.query(
        `insert into source_revisions(source_id, hash, raw, paragraphs, meta, imported_by)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [
          sourceId,
          content.hash,
          raw ?? (content.raw ? Buffer.from(content.raw) : null),
          JSON.stringify(content.paragraphs),
          JSON.stringify({ ...(content.meta ?? {}), title: content.title }),
          actorId,
        ],
      );
      await client.query(
        `update sources set sync_state='pending', last_hash=$2, updated_at=now(), updated_by=$3 where id=$1`,
        [sourceId, content.hash, actorId],
      );
      await client.query('commit');
      revisionId = r.rows[0].id as string;
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    await this.queue.send(QUEUES.pipelineProcess, { revisionId }, { singletonKey: revisionId });
    return { revisionId, duplicate: false };
  }

  async latestAccepted(sourceId: string): Promise<SourceRevision | null> {
    const r = await this.pool.query(
      `select * from source_revisions where source_id=$1 and accepted order by imported_at desc limit 1`,
      [sourceId],
    );
    return r.rowCount ? rowToRevision(r.rows[0]) : null;
  }

  async latestRevisionId(sourceId: string): Promise<string | null> {
    const r = await this.pool.query(
      `select id from source_revisions where source_id=$1 order by imported_at desc limit 1`,
      [sourceId],
    );
    return r.rowCount ? (r.rows[0].id as string) : null;
  }

  async getRevision(id: string): Promise<SourceRevision | null> {
    const r = await this.pool.query(`select * from source_revisions where id=$1`, [id]);
    return r.rowCount ? rowToRevision(r.rows[0]) : null;
  }

  async listSources(): Promise<Source[]> {
    const r = await this.pool.query(
      `select s.*,
         (select count(distinct from_document_id) from document_links l where l.to_source_id=s.id) as linked_documents,
         (select count(*) from suggestions g join source_revisions sr on sr.id=g.source_revision_id
            where sr.source_id=s.id and g.status='pending') as pending_suggestions
       from sources s where s.deleted_at is null order by s.updated_at desc`,
    );
    return r.rows.map(rowToSource);
  }
}
