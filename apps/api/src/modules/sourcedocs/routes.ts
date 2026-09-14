import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AssetSchema,
  IdSchema,
  PutSourceDocumentBodySchema,
  PutSourceDraftBodySchema,
  SourceDocumentSchema,
  SourceDocumentVersionsResponseSchema,
  SourceDraftSchema,
  htmlToDocx,
  makeEvent,
} from '@wecom/shared';
import { deleteDraft, getDraft, putDraft } from '../drafts/repo.js';
import { audit } from '../../lib/audit.js';
import { httpError, notFound } from '../../lib/http.js';
import { withTransaction } from '../../lib/sql.js';
import { hasScope, requireUser } from '../../lib/user.js';
import { assertVisibleDocument, canReadUnpublished, visibleStatusSql } from '../../lib/visibility.js';
import * as repo from './repo.js';
import { getAsset, putAsset } from './assets.js';
import { importDocx } from './import.js';
import { queueIngestRetry, runIngest } from './ingestRetry.js';
import { documentsForSource } from '../documents/sourceReview.js';

const Params = z.object({ id: IdSchema });
const VersionParams = z.object({ id: IdSchema, v: z.coerce.number().int().positive() });
const AssetParams = z.object({ id: IdSchema });
const RevParams = z.object({ id: IdSchema, rev: IdSchema });
const sourceDraftKey = (documentId: string) => 'source:' + documentId;

export default async function routes(app: FastifyInstance) {
  /** Shared by PUT, import and restore: save + audit + ingest + event, one transaction for the DB part. */
  async function saveAndIngest(
    req: FastifyRequest,
    documentId: string,
    html: string,
    label: string | undefined,
    action: string,
    ifMatch?: string,
  ) {
    const user = requireUser(req);
    const before = await repo.getSourceDocument(app.db, documentId);
    const saved = await withTransaction(app.db, async (tx) => {
      const s = await repo.saveSourceDocument(tx, documentId, {
        html,
        label,
        authorId: user.id,
        ifMatch,
      });
      await audit(tx, {
        actorId: user.id,
        action,
        entityType: 'source_document',
        entityId: documentId,
        before: before ? { version: before.version } : null,
        after: { version: s.version, label: label ?? '' },
        requestId: req.id,
        ip: req.ip,
      });
      await app.events.publish(
        tx,
        makeEvent('source_document.saved', {
          documentId,
          version: s.version,
          actorId: user.id,
        }),
      );
      // a saved version supersedes this user's autosave; there may be none
      await deleteDraft(tx, sourceDraftKey(documentId), user.id).catch(() => undefined);
      return s;
    });
    /**
     * B-I4 — the version row above is already durable. `ingestSourceHtml` runs the revision
     * pipeline (`SourceRevisionService.ingest` → `onIngested` → `markSourceReviewNeeded`), and
     * a throw here used to answer 500 for a save that had committed: the source had moved, the
     * working view was never flagged "נדרשת לבדיקה", nobody was alerted, and the client would
     * very likely retry the PUT and write a second identical version.
     *
     * The ingest is not folded into the transaction — `SourceRevisionService` owns its own and
     * enqueues a `pipeline.process` job, and enlisting it would mean threading a `Tx` through
     * the whole revision service and holding a write transaction across a job enqueue. Instead
     * the save always succeeds and the ingest is retried, keyed on the version that is already
     * on disk: `retrySourceIngest` is idempotent because `revisions.ingest` dedupes on the
     * content hash, and it only stamps `source_revision_id` where it is still null.
     */
    try {
      await runIngest(app, documentId, saved.version, saved.html, user.id);
    } catch (err) {
      req.log.error({ err, documentId, version: saved.version }, 'source ingest failed; queued a retry');
      await queueIngestRetry(app, req, documentId, saved.version, user.id);
    }
    return saved;
  }

  app.get(
    '/documents/:id/source',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: {
        tags: ['sourcedocs'],
        params: Params,
        response: { 200: SourceDocumentSchema, 204: z.null() },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      // `scope: 'document'` is only the world half; §3 says the visibility rule applies here
      // too, and the source document is the fullest representation of an item.
      await assertVisibleDocument(app.db, id, requireUser(req));
      const s = await repo.getSourceDocument(app.db, id);
      if (!s) return reply.code(204).send(null);
      reply.header('etag', s.etag);
      return s;
    },
  );

  app.put(
    '/documents/:id/source',
    {
      config: { requires: ['docs.edit'], scope: 'document' },
      schema: {
        tags: ['sourcedocs'],
        params: Params,
        body: PutSourceDocumentBodySchema,
        response: { 200: SourceDocumentSchema },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof PutSourceDocumentBodySchema>;
      const ifMatch = typeof req.headers['if-match'] === 'string' ? req.headers['if-match'] : undefined;
      /**
       * The header was optional, so a client that omitted it overwrote whatever was there with
       * no 412 and the conflict dialog §5.1 assumes had nothing to fire on. It is required once
       * a source document exists; the first save has no etag to send, and the create path
       * handles that race itself (`on conflict do nothing` → 412). 428 matches the convention
       * `POST /documents/:id/publish` already uses for a missing precondition.
       */
      if (!ifMatch && (await repo.currentSourceVersion(app.db, id)) !== null)
        throw httpError(428, 'IF_MATCH_REQUIRED', 'נדרשת כותרת If-Match עם ה-etag של מסמך המקור');
      const s = await saveAndIngest(req, id, body.html, body.label, 'sourcedocs.save', ifMatch);
      reply.header('etag', s.etag);
      return s;
    },
  );

  /* ── source autosave (W4-owned contract addition) ─────────────────────── */
  app.get(
    '/documents/:id/source/draft',
    {
      config: { requires: ['docs.edit'], scope: 'document' },
      schema: {
        tags: ['sourcedocs'],
        params: Params,
        response: { 200: SourceDraftSchema, 204: z.null() },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const d = await getDraft(app.db, sourceDraftKey((req.params as { id: string }).id), user.id);
      if (!d) return reply.code(204).send(null);
      return { html: String((d.payload as { html?: unknown }).html ?? ''), updatedAt: d.updatedAt };
    },
  );

  app.put(
    '/documents/:id/source/draft',
    {
      config: { requires: ['docs.edit'], scope: 'document' },
      schema: { tags: ['sourcedocs'], params: Params, body: PutSourceDraftBodySchema },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof PutSourceDraftBodySchema>;
      if (!(await app.db.query('select 1 from documents where id=$1 and deleted_at is null', [id])).rowCount)
        throw notFound('המסמך');
      await withTransaction(app.db, (tx) =>
        putDraft(tx, sourceDraftKey(id), id, user.id, { html: body.html }),
      );
      reply.code(204);
      return null;
    },
  );

  app.delete(
    '/documents/:id/source/draft',
    {
      config: { requires: ['docs.edit'], scope: 'document' },
      schema: { tags: ['sourcedocs'], params: Params },
    },
    async (req, reply) => {
      const user = requireUser(req);
      await withTransaction(app.db, (tx) =>
        deleteDraft(tx, sourceDraftKey((req.params as { id: string }).id), user.id).catch(() => undefined),
      );
      reply.code(204);
      return null;
    },
  );

  app.get(
    '/documents/:id/source/versions',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: {
        tags: ['sourcedocs'],
        params: Params,
        response: { 200: SourceDocumentVersionsResponseSchema },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      await assertVisibleDocument(app.db, id, requireUser(req));
      return { items: await repo.listSourceVersions(app.db, id) };
    },
  );

  app.get(
    '/documents/:id/source/versions/:v',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: {
        tags: ['sourcedocs'],
        params: VersionParams,
        response: { 200: SourceDocumentSchema },
      },
    },
    async (req) => {
      const { id, v } = req.params as { id: string; v: number };
      await assertVisibleDocument(app.db, id, requireUser(req));
      const s = await repo.getSourceVersion(app.db, id, v);
      if (!s) throw notFound('גרסת המקור');
      return s;
    },
  );

  app.post(
    '/documents/:id/source/restore/:v',
    {
      config: { requires: ['docs.edit'], scope: 'document' },
      schema: {
        tags: ['sourcedocs'],
        params: VersionParams,
        response: { 200: SourceDocumentSchema },
      },
    },
    async (req, reply) => {
      const { id, v } = req.params as { id: string; v: number };
      const old = await repo.getSourceVersion(app.db, id, v);
      if (!old) throw notFound('גרסת המקור');
      const s = await saveAndIngest(req, id, old.html, `שוחזר מגרסה ${v}`, 'sourcedocs.restore');
      reply.header('etag', s.etag);
      return s;
    },
  );

  app.post(
    '/documents/:id/source/import',
    {
      config: { requires: ['docs.edit'], scope: 'document' },
      schema: { tags: ['sourcedocs'], params: Params, response: { 200: SourceDocumentSchema } },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      let file: { filename: string; buffer: Buffer } | null = null;
      for await (const part of req.parts())
        if (part.type === 'file') file = { filename: part.filename, buffer: await part.toBuffer() };
      if (!file) throw httpError(400, 'NO_FILE', 'חסר קובץ');
      if (!/\.docx$/i.test(file.filename)) throw httpError(400, 'BAD_DOCX', 'יש להעלות קובץ .docx');
      const { html } = await importDocx(file.buffer, {
        putAsset: async (bytes, mime) => putAsset(app.db, { bytes, mime, createdBy: user.id }),
      });
      const s = await saveAndIngest(req, id, html, 'יובא מ-Word: ' + file.filename, 'sourcedocs.import');
      reply.header('etag', s.etag);
      return s;
    },
  );

  app.get(
    '/documents/:id/source/export.docx',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['sourcedocs'], params: Params },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      await assertVisibleDocument(app.db, id, requireUser(req));
      const s = await repo.getSourceDocument(app.db, id);
      if (!s) throw notFound('מסמך המקור');
      const title = (await app.db.query('select title from documents where id=$1', [id])).rows[0]
        ?.title as string;
      const bytes = await htmlToDocx(s.html, {
        title,
        resolveAsset: async (assetId) => {
          const a = await getAsset(app.db, assetId);
          return a
            ? {
                bytes: new Uint8Array(a.bytes),
                mime: a.mime,
                width: a.width ?? undefined,
                height: a.height ?? undefined,
              }
            : null;
        },
      });
      reply
        .header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header(
          'content-disposition',
          `attachment; filename="source.docx"; filename*=UTF-8''${encodeURIComponent(title)}.docx`,
        )
        .header('cache-control', 'no-store');
      return reply.send(Buffer.from(bytes));
    },
  );

  app.get(
    '/sources/:id/revisions/:rev/raw',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['sourcedocs'], params: RevParams },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { id, rev } = req.params as { id: string; rev: string };
      /**
       * This route had neither `scope: 'document'` (there is no `:id` document to resolve — the
       * id is a *source*) nor a visibility check, so it served the original uploaded bytes of
       * any source in any world to any authenticated reader. A source is reachable only through
       * a document the caller may open: at least one owning document must be in their world
       * scope and visible to them.
       */
      const owners = await app.db.query<{ id: string; worlds: string[] }>(
        `select d.id,
                coalesce((select array_agg(dw.world_slug) from document_worlds dw where dw.document_id = d.id), '{}') worlds
           from documents d
          where d.id = any($1::uuid[])${canReadUnpublished(user) ? '' : ` and ${visibleStatusSql()}`}`,
        [await documentsForSource(app.db, id)],
      );
      if (!owners.rows.some((d) => hasScope(user, d.worlds))) throw notFound('קובץ המקור');
      const r = await app.db.query(
        `select r.raw, s.ext, s.kind, s.title from source_revisions r join sources s on s.id=r.source_id where r.source_id=$1 and r.id=$2`,
        [id, rev],
      );
      if (!r.rowCount || !r.rows[0].raw) throw notFound('קובץ המקור');
      const ext = (r.rows[0].ext as string | null) ?? (r.rows[0].kind === 'docx' ? '.docx' : '.html');
      const type =
        ext === '.docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'text/html; charset=utf-8';
      reply
        .header('content-type', type)
        .header(
          'content-disposition',
          `attachment; filename="source${ext}"; filename*=UTF-8''${encodeURIComponent(
            r.rows[0].title as string,
          )}${ext}`,
        );
      return reply.send(r.rows[0].raw as Buffer);
    },
  );

  app.post(
    '/assets',
    {
      config: { requires: ['docs.edit'] },
      schema: { tags: ['sourcedocs'], response: { 200: AssetSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      let file: { mime: string; buffer: Buffer } | null = null;
      for await (const part of req.parts())
        if (part.type === 'file') file = { mime: part.mimetype, buffer: await part.toBuffer() };
      if (!file) throw httpError(400, 'NO_FILE', 'חסר קובץ');
      return putAsset(app.db, { bytes: file.buffer, mime: file.mime, createdBy: user.id });
    },
  );

  app.get(
    '/assets/:id',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['sourcedocs'], params: AssetParams },
    },
    async (req, reply) => {
      requireUser(req);
      const a = await getAsset(app.db, (req.params as { id: string }).id);
      if (!a) throw notFound('הקובץ');
      reply
        .header('content-type', a.mime)
        .header('content-length', String(a.size))
        .header('cache-control', 'public, max-age=31536000, immutable')
        .header('x-content-type-options', 'nosniff');
      return reply.send(a.bytes);
    },
  );
}
