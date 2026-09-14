import type { FastifyInstance, FastifyRequest } from 'fastify';
import { QUEUES } from '../../plugins/boss.js';
import { ingestSourceHtml } from './ingest.js';

/** What the retry job carries: enough to find the saved version and re-run its ingest. */
export interface IngestRetryJob {
  documentId: string;
  version: number;
  actorId: string | null;
}

/**
 * Ingest one saved source version and stamp the revision id onto it.
 *
 * Idempotent: `revisions.ingest` dedupes on the content hash, and the stamp only fills a
 * `source_revision_id` that is still null, so running this twice is a no-op the second time.
 */
export async function runIngest(
  app: FastifyInstance,
  documentId: string,
  version: number,
  html: string,
  actorId: string | null,
): Promise<void> {
  const ing = await ingestSourceHtml(app, documentId, html, actorId);
  if (ing.duplicate) return;
  await app.db.query(
    `update source_document_versions v set source_revision_id=$3 from source_documents s
      where v.source_document_id=s.id and s.document_id=$1 and v.version=$2 and v.source_revision_id is null`,
    [documentId, version, ing.revisionId],
  );
}

/** Re-read the stored HTML for a version and ingest it. Used by the retry worker. */
export async function retrySourceIngest(app: FastifyInstance, job: IngestRetryJob): Promise<void> {
  const r = await app.db.query<{ html: string }>(
    `select v.html from source_document_versions v join source_documents s on s.id = v.source_document_id
      where s.document_id = $1 and v.version = $2`,
    [job.documentId, job.version],
  );
  if (!r.rowCount) return; // the version is gone (document deleted); nothing to ingest
  await runIngest(app, job.documentId, job.version, r.rows[0].html, job.actorId);
}

/**
 * A failed ingest must never fail the save (the version row is already committed), so the
 * failure becomes a retryable job rather than a 500. With no queue configured — tests, and a
 * single-process dev server — it is logged and left to the next save, the same visibility the
 * push-on-publish path settles for.
 */
export async function queueIngestRetry(
  app: FastifyInstance,
  req: FastifyRequest,
  documentId: string,
  version: number,
  actorId: string | null,
): Promise<void> {
  const payload: IngestRetryJob = { documentId, version, actorId };
  try {
    if (app.boss) {
      await app.boss.send(QUEUES.sourceIngestRetry, payload, {
        retryLimit: 5,
        retryBackoff: true,
        singletonKey: `${documentId}:${version}`,
      });
      return;
    }
  } catch (err) {
    req.log.error({ err, documentId, version }, 'could not queue the source ingest retry');
  }
  req.log.warn({ documentId, version }, 'source ingest not retried: no queue');
}

/** Registers the retry worker. Inert under test, like every other job in this package. */
export async function startIngestRetryWorker(app: FastifyInstance): Promise<void> {
  const boss = app.boss;
  if (!boss || app.config.NODE_ENV === 'test') return;
  await boss.work<IngestRetryJob>(QUEUES.sourceIngestRetry, async ([job]) => {
    await retrySourceIngest(app, job.data);
  });
}
