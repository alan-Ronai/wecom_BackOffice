import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateDocumentBodySchema,
  DiffQuerySchema,
  DiffResponseSchema,
  DocumentSchema,
  IdSchema,
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
import { forbidden, notFound } from '../../lib/http.js';
import { hasScope, requireUser } from '../../lib/user.js';
import * as repo from './repo.js';
import { annotateBlame, diffDocuments, diffStats } from './diff.js';

const Params = z.object({ id: IdSchema });
const VersionParams = z.object({ id: IdSchema, v: z.coerce.number().int().min(0) });

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
      const { items, total } = await repo.listCards(app.db, q, user.id);
      return { items, total, page: q.page, pageSize: q.pageSize };
    },
  );

  app.get(
    '/documents/:id',
    {
      config: { requires: ['docs.read'] },
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
      if (!hasScope(user, body.category)) throw forbidden();
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
        if (!hasScope(user, before.category) || (body.category && !hasScope(user, body.category)))
          throw forbidden();
        const after = await repo.patchDocument(tx, id, body, user.id);
        await audit(tx, {
          actorId: user.id,
          action: 'docs.edit',
          entityType: 'document',
          entityId: id,
          before: { title: before.title, wave: before.wave, category: before.category },
          after: { title: after.title, wave: after.wave, category: after.category },
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
        body: StructureBodySchema,
        response: { 200: DocumentSchema },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const countSteps = (d: { phases: { steps: unknown[] }[] }) =>
        d.phases.reduce((a, p) => a + p.steps.length, 0);
      const doc = await withTransaction(app.db, async (tx) => {
        const before = await repo.getDocument(tx, id);
        if (!before) throw notFound('המסמך');
        if (!hasScope(user, before.category)) throw forbidden();
        const after = await repo.saveStructure(
          tx,
          id,
          req.body as z.infer<typeof StructureBodySchema>,
          user.id,
          req.headers['if-match'] as string | undefined,
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
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getDocument(tx, id);
        if (!before) throw notFound('המסמך');
        if (!hasScope(user, before.category)) throw forbidden();
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
    },
  );

  app.get(
    '/documents/:id/versions',
    {
      config: { requires: ['docs.read'] },
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
      config: { requires: ['docs.read'] },
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
      config: { requires: ['docs.read'] },
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
      const history: { version: number; author: string; doc: typeof current }[] = [];
      for (const v of versions) {
        if (v.version < from || v.version > toVersion) continue;
        const doc = v.version === from ? oldDoc : await repo.getVersion(app.db, id, v.version);
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
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getDocument(tx, id);
        if (!before) throw notFound('המסמך');
        if (!hasScope(user, before.category)) throw forbidden();
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
    },
  );
}
