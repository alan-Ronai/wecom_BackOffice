import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateDocumentBodySchema,
  DocumentSchema,
  IdSchema,
  ListDocumentsQuerySchema,
  ListDocumentsResponseSchema,
  PatchDocumentBodySchema,
} from '@wecom/shared';
import { withTransaction } from '../../lib/sql.js';
import { audit } from '../../lib/audit.js';
import { forbidden, notFound } from '../../lib/http.js';
import { hasScope, requireUser } from '../../lib/user.js';
import * as repo from './repo.js';

const Params = z.object({ id: IdSchema });

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
}
