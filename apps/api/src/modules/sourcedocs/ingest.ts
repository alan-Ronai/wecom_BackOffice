import type { FastifyInstance } from 'fastify';
import { htmlToParagraphs } from '@wecom/shared';
import { contentHash } from '@wecom/connectors';
import type { SourceRevisionService } from '../sources/revisions.js';

declare module 'fastify' {
  interface FastifyInstance {
    revisions: SourceRevisionService;
  }
}

/**
 * Every source save enters the same pipeline as a Word upload or a WordPress pull:
 * a `source_revisions` row, `sources.sync_state = 'pending'`, a `pipeline.process` job.
 * Documents with no source yet get a `kind='text'` source owned by this document.
 */
export async function ingestSourceHtml(
  app: FastifyInstance,
  documentId: string,
  html: string,
  actorId: string | null,
): Promise<{ revisionId: string; duplicate: boolean; sourceId: string }> {
  const d = await app.db.query(
    'select title, source_id from documents where id=$1 and deleted_at is null',
    [documentId],
  );
  if (!d.rowCount)
    throw Object.assign(new Error('document not found'), { statusCode: 404, code: 'NOT_FOUND' });
  let sourceId = d.rows[0].source_id as string | null;
  if (!sourceId) {
    sourceId = (
      await app.revisions.createSource(
        { kind: 'text', title: d.rows[0].title as string, externalId: 'sourcedoc:' + documentId },
        actorId,
      )
    ).id;
    await app.db.query('update documents set source_id=$2 where id=$1 and source_id is null', [
      documentId,
      sourceId,
    ]);
  }
  const paragraphs = htmlToParagraphs(html);
  const r = await app.revisions.ingest(
    sourceId,
    { title: d.rows[0].title as string, paragraphs, raw: html, hash: contentHash(paragraphs) },
    actorId,
    Buffer.from(html, 'utf8'),
  );
  return { ...r, sourceId };
}
