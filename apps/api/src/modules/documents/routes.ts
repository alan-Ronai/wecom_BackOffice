import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ModelClient } from '@wecom/model';
import { z } from 'zod';
import {
  CreateDocumentBodySchema,
  DeleteResponseSchema,
  DiffQuerySchema,
  DiffResponseSchema,
  DocumentSchema,
  LinksResponseSchema,
  RelatedResponseSchema,
  IdSchema,
  LinkTypeSchema,
  ListDocumentsQuerySchema,
  ListDocumentsResponseSchema,
  PatchDocumentBodySchema,
  PublishBodySchema,
  PublishResponseSchema,
  StructureBodySchema,
  VersionListSchema,
  makeEvent,
} from '@wecom/shared';
import { withTransaction } from '../../lib/sql.js';
import { audit } from '../../lib/audit.js';
import { forbidden, httpError, notFound } from '../../lib/http.js';
import { hasScope, requireUser } from '../../lib/user.js';
import * as repo from './repo.js';
import { annotateBlame, diffDocuments, diffStats } from './diff.js';
import { inboundFor } from '../graph/repo.js';
import { updateEmbedding } from '../search/repo.js';

const Params = z.object({ id: IdSchema });
/** Stage 4 `/documents/:id/backlinks`; the contract spells this response inline. */
const BacklinksResponseSchema = z.object({
  items: z.array(
    z.object({
      documentId: IdSchema,
      title: z.string(),
      stepKey: z.string().nullable(),
      type: LinkTypeSchema,
    }),
  ),
});
const VersionParams = z.object({ id: IdSchema, v: z.coerce.number().int().min(0) });
/** Optional optimistic-concurrency precondition on `PUT /documents/:id/structure`. */
const IfMatchHeaders = z.object({ 'if-match': z.string().optional() });

/**
 * Closes the KB -> remote half of the two-way sync (L6's `pushOnPublish`). Called
 * *after* the publish transaction commits, so a WordPress outage can never roll
 * back a local publish: a failure is logged and emitted as `job.failed` instead of
 * failing the response. Links in `conflict` are skipped by `pushOnPublish` itself.
 */
async function pushOnPublish(
  app: FastifyInstance,
  req: FastifyRequest,
  documentId: string,
  actorId: string,
): Promise<void> {
  const sync = app.connectors?.sync;
  if (!sync) return;
  try {
    const refs = await sync.pushOnPublish(documentId, actorId);
    if (refs.length) req.log.info({ documentId, pushed: refs.length }, 'push-on-publish');
  } catch (err) {
    req.log.error({ err, documentId }, 'push-on-publish failed');
    await withTransaction(app.db, (tx) =>
      app.events.publish(
        tx,
        makeEvent('job.failed', {
          jobName: 'sync.pushOnPublish',
          jobId: documentId,
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
    );
  }
}

export default async function routes(app: FastifyInstance) {
  app.get(
    '/documents',
    {
      config: { requires: ['docs.read'] },
      schema: {
        tags: ['documents'],
        querystring: ListDocumentsQuerySchema,
        response: { 200: ListDocumentsResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const q = req.query as z.infer<typeof ListDocumentsQuerySchema>;
      const { items, total } = await repo.listCards(app.db, q, user.id, user.worldScopes);
      return { items, total, page: q.page, pageSize: q.pageSize };
    },
  );

  app.get(
    '/documents/:id',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['documents'], params: Params, response: { 200: DocumentSchema } },
    },
    async (req, reply) => {
      requireUser(req);
      const doc = await repo.getDocument(app.db, (req.params as { id: string }).id);
      if (!doc) throw notFound('המסמך');
      reply.header('etag', doc.etag!);
      return doc;
    },
  );

  app.post(
    '/documents',
    {
      config: { requires: ['docs.create'] },
      schema: { tags: ['documents'], body: CreateDocumentBodySchema, response: { 201: DocumentSchema } },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const body = req.body as z.infer<typeof CreateDocumentBodySchema>;
      for (const w of [body.category, ...(body.worlds ?? [])]) if (!hasScope(user, w)) throw forbidden();
      const doc = await withTransaction(app.db, async (tx) => {
        const d = await repo.insertDocument(tx, body, user.id);
        await audit(tx, {
          actorId: user.id,
          action: 'docs.create',
          entityType: 'document',
          entityId: d.id,
          before: null,
          after: { title: d.title, category: d.category },
          requestId: req.id,
          ip: req.ip,
        });
        return d;
      });
      reply.code(201);
      return doc;
    },
  );

  app.patch(
    '/documents/:id',
    {
      config: { requires: ['docs.edit'], scope: 'document' },
      schema: {
        tags: ['documents'],
        params: Params,
        body: PatchDocumentBodySchema,
        response: { 200: DocumentSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof PatchDocumentBodySchema>;
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getDocument(tx, id);
        if (!before) throw notFound('המסמך');
        if (!hasScope(user, before.worlds)) throw forbidden();
        for (const w of [body.category, ...(body.worlds ?? [])])
          if (w && !hasScope(user, w)) throw forbidden();
        const after = await repo.patchDocument(
          tx,
          id,
          body,
          user.id,
          req.headers['if-match'] as string | undefined,
        );
        await audit(tx, {
          actorId: user.id,
          action: 'docs.edit',
          entityType: 'document',
          entityId: id,
          before: {
            title: before.title,
            wave: before.wave,
            category: before.category,
            docType: before.docType,
            tags: before.tags,
          },
          after: {
            title: after.title,
            wave: after.wave,
            category: after.category,
            docType: after.docType,
            tags: after.tags,
          },
          requestId: req.id,
          ip: req.ip,
        });
        return after;
      });
    },
  );

  app.put(
    '/documents/:id/structure',
    {
      config: { requires: ['docs.edit'], scope: 'document' },
      schema: {
        tags: ['documents'],
        params: Params,
        // Optimistic concurrency: the handler compares this against the stored etag, so it has
        // to be part of the published contract for clients to be able to send it.
        headers: IfMatchHeaders,
        body: StructureBodySchema,
        response: { 200: DocumentSchema },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      // The etag exists precisely so a structure save cannot silently clobber a
      // concurrent editor; making it optional made that guarantee opt-in.
      const ifMatch = req.headers['if-match'] as string | undefined;
      if (!ifMatch) throw httpError(428, 'IF_MATCH_REQUIRED', 'נדרשת כותרת If-Match עם ה-etag של המסמך');
      const countSteps = (d: { phases: { steps: unknown[] }[] }) =>
        d.phases.reduce((a, p) => a + p.steps.length, 0);
      const doc = await withTransaction(app.db, async (tx) => {
        const before = await repo.getDocument(tx, id);
        if (!before) throw notFound('המסמך');
        if (!hasScope(user, before.worlds)) throw forbidden();
        const after = await repo.saveStructure(
          tx,
          id,
          req.body as z.infer<typeof StructureBodySchema>,
          user.id,
          ifMatch,
        );
        await audit(tx, {
          actorId: user.id,
          action: 'docs.edit',
          entityType: 'document',
          entityId: id,
          before: { steps: countSteps(before) },
          after: { steps: countSteps(after) },
          requestId: req.id,
          ip: req.ip,
        });
        await app.events.publish(
          tx,
          makeEvent('document.updated', { documentId: id, actorId: user.id, etag: after.etag }),
        );
        return after;
      });
      reply.header('etag', doc.etag!);
      return doc;
    },
  );

  app.post(
    '/documents/:id/publish',
    {
      config: { requires: ['docs.publish'], scope: 'document' },
      schema: {
        tags: ['documents'],
        params: Params,
        body: PublishBodySchema,
        response: { 200: PublishResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof PublishBodySchema>;
      const result = await withTransaction(app.db, async (tx) => {
        const before = await repo.getDocument(tx, id);
        if (!before) throw notFound('המסמך');
        if (!hasScope(user, before.worlds)) throw forbidden();
        const { doc, version } = await repo.publishDocument(tx, id, {
          actorId: user.id,
          label: body.label,
          markPartial: body.markPartial,
        });
        const auditId = await audit(tx, {
          actorId: user.id,
          action: 'docs.publish',
          entityType: 'document',
          entityId: id,
          before: { version: before.currentVersion, status: before.status },
          after: { version, status: doc.status },
          requestId: req.id,
          ip: req.ip,
        });
        await app.events.publish(
          tx,
          makeEvent('document.published', { documentId: id, version, actorId: user.id }),
        );
        return { document: doc, version, auditId };
      });
      await pushOnPublish(app, req, id, user.id);
      // Best-effort, outside the transaction: a model outage must never fail a publish.
      const model = (app as unknown as { model?: ModelClient | null }).model;
      if (model?.embed)
        updateEmbedding(app.db, id, model).catch((err) =>
          req.log.warn({ err, id }, 'embed on publish failed'),
        );
      return result;
    },
  );

  app.get(
    '/documents/:id/versions',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['documents'], params: Params, response: { 200: VersionListSchema } },
    },
    async (req) => {
      requireUser(req);
      return { items: await repo.listVersions(app.db, (req.params as { id: string }).id) };
    },
  );

  app.get(
    '/documents/:id/versions/:v',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['documents'], params: VersionParams, response: { 200: DocumentSchema } },
    },
    async (req) => {
      requireUser(req);
      const { id, v } = req.params as { id: string; v: number };
      const doc = await repo.getVersion(app.db, id, v);
      if (!doc) throw notFound('הגרסה');
      return doc;
    },
  );

  app.get(
    '/documents/:id/diff',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: {
        tags: ['documents'],
        params: Params,
        querystring: DiffQuerySchema,
        response: { 200: DiffResponseSchema },
      },
    },
    async (req) => {
      requireUser(req);
      const { id } = req.params as { id: string };
      const { from, to } = req.query as z.infer<typeof DiffQuerySchema>;
      const current = await repo.getDocument(app.db, id);
      if (!current) throw notFound('המסמך');
      const oldDoc = await repo.getVersion(app.db, id, from);
      if (!oldDoc) throw notFound('הגרסה');
      const toVersion = to ?? current.currentVersion;
      const newDoc = to === undefined ? current : await repo.getVersion(app.db, id, to);
      if (!newDoc) throw notFound('הגרסה');
      const blocks = await repo.loadBlocksMap(app.db);
      const rows = diffDocuments(oldDoc, newDoc, blocks);
      // Blame: the first version between `from` and `to` in which each row's step changed.
      const versions = await repo.listVersions(app.db, id);
      const inRange = versions.filter((v) => v.version >= from && v.version <= toVersion);
      // One query for every snapshot in range instead of `getVersion` per version.
      const need = inRange.filter((v) => v.version !== from).map((v) => v.version);
      const snapshots = await repo.getVersionsBatch(app.db, id, need);
      const history: { version: number; author: string; doc: typeof current }[] = [];
      for (const v of inRange) {
        const doc = v.version === from ? oldDoc : snapshots.get(v.version);
        if (doc) history.push({ version: v.version, author: v.authorName, doc });
      }
      annotateBlame(rows, history, blocks);
      return { from, to: toVersion, rows, stats: diffStats(rows) };
    },
  );

  app.post(
    '/documents/:id/restore/:v',
    {
      config: { requires: ['docs.restore'], scope: 'document' },
      schema: { tags: ['documents'], params: VersionParams, response: { 200: PublishResponseSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const { id, v } = req.params as { id: string; v: number };
      const result = await withTransaction(app.db, async (tx) => {
        const before = await repo.getDocument(tx, id);
        if (!before) throw notFound('המסמך');
        if (!hasScope(user, before.worlds)) throw forbidden();
        const { doc, version } = await repo.restoreVersion(tx, id, v, user.id);
        const auditId = await audit(tx, {
          actorId: user.id,
          action: 'docs.restore',
          entityType: 'document',
          entityId: id,
          before: { version: before.currentVersion },
          after: { version, restoredFrom: v },
          requestId: req.id,
          ip: req.ip,
        });
        await app.events.publish(
          tx,
          makeEvent('document.published', { documentId: id, version, actorId: user.id }),
        );
        return { document: doc, version, auditId };
      });
      await pushOnPublish(app, req, id, user.id);
      const model = (app as unknown as { model?: ModelClient | null }).model;
      if (model?.embed)
        updateEmbedding(app.db, id, model).catch((err) =>
          req.log.warn({ err, id }, 'embed on restore failed'),
        );
      return result;
    },
  );

  app.delete(
    '/documents/:id',
    {
      config: { requires: ['docs.delete'], scope: 'document' },
      schema: { tags: ['documents'], params: Params, response: { 200: DeleteResponseSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getDocument(tx, id);
        if (!before) throw notFound('המסמך');
        if (!hasScope(user, before.worlds)) throw forbidden();
        await repo.softDelete(tx, id, user.id);
        const restoreUntil = new Date(Date.now() + app.config.TRASH_DAYS * 86400_000).toISOString();
        const auditId = await audit(tx, {
          actorId: user.id,
          action: 'docs.delete',
          entityType: 'document',
          entityId: id,
          before: { title: before.title, status: before.status },
          after: null,
          requestId: req.id,
          ip: req.ip,
        });
        await app.events.publish(
          tx,
          makeEvent('document.deleted', {
            documentId: id,
            actorId: user.id,
            restoredUntil: restoreUntil,
          }),
        );
        return { auditId, restoreUntil };
      });
    },
  );

  app.post(
    '/documents/:id/pin',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['documents'], params: Params },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      if (!(await repo.getDocument(app.db, id))) throw notFound('המסמך');
      await repo.setPin(app.db, user.id, id, true);
      reply.code(204);
      return null;
    },
  );

  app.delete(
    '/documents/:id/pin',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['documents'], params: Params },
    },
    async (req, reply) => {
      const user = requireUser(req);
      await repo.setPin(app.db, user.id, (req.params as { id: string }).id, false);
      reply.code(204);
      return null;
    },
  );

  app.post(
    '/documents/:id/view',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['documents'], params: Params },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      if (!(await repo.getDocument(app.db, id))) throw notFound('המסמך');
      await repo.recordView(app.db, user.id, id);
      reply.code(204);
      return null;
    },
  );

  app.get(
    '/documents/:id/links',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['documents'], params: Params, response: { 200: LinksResponseSchema } },
    },
    async (req) => {
      requireUser(req);
      return repo.linksFor(app.db, (req.params as { id: string }).id);
    },
  );

  app.get(
    '/documents/:id/related',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['documents'], params: Params, response: { 200: RelatedResponseSchema } },
    },
    async (req) => {
      requireUser(req);
      const doc = await repo.getDocument(app.db, (req.params as { id: string }).id);
      if (!doc) throw notFound('המסמך');
      return { items: await repo.relatedFor(app.db, doc) };
    },
  );

  // Stage 4 (connected data): the inbound half of `/documents/:id/links`, shaped like the
  // graph's impact rows so the UI can render "what points at this card" the same way.
  app.get(
    '/documents/:id/backlinks',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['documents'], params: Params, response: { 200: BacklinksResponseSchema } },
    },
    async (req) => {
      requireUser(req);
      const { id } = req.params as { id: string };
      if (!(await repo.getDocument(app.db, id))) throw notFound('המסמך');
      return { items: await inboundFor(app.db, { kind: 'document', key: id }) };
    },
  );
}
