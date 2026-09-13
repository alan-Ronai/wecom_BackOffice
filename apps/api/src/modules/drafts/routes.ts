import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DraftBodySchema, DraftListSchema, DraftResponseSchema, IdSchema } from '@wecom/shared';
import { notFound } from '../../lib/http.js';
import { withTransaction } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import * as repo from './repo.js';

const DocParams = z.object({ id: IdSchema });
const NewParams = z.object({ draftId: z.string().min(1).max(80) });

export default async function routes(app: FastifyInstance) {
  app.get(
    '/drafts',
    { config: { requires: ['docs.read'] }, schema: { tags: ['drafts'], response: { 200: DraftListSchema } } },
    async (req) => {
      const user = requireUser(req);
      return { items: await repo.listDrafts(app.db, user.id) };
    },
  );

  app.get(
    '/documents/:id/draft',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['drafts'], params: DocParams, response: { 200: DraftResponseSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const draft = await repo.getDraft(app.db, (req.params as { id: string }).id, user.id);
      if (!draft) throw notFound('הטיוטה');
      return draft;
    },
  );

  app.put(
    '/documents/:id/draft',
    {
      config: { requires: ['docs.edit'], scope: 'document' },
      schema: {
        tags: ['drafts'],
        params: DocParams,
        body: DraftBodySchema,
        response: { 200: DraftResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof DraftBodySchema>;
      return withTransaction(app.db, (tx) => repo.putDraft(tx, id, id, user.id, body.payload));
    },
  );

  app.delete(
    '/documents/:id/draft',
    {
      config: { requires: ['docs.edit'], scope: 'document' },
      schema: { tags: ['drafts'], params: DocParams },
    },
    async (req, reply) => {
      const user = requireUser(req);
      await withTransaction(app.db, (tx) => repo.deleteDraft(tx, (req.params as { id: string }).id, user.id));
      reply.code(204);
      return null;
    },
  );

  app.get(
    '/drafts/new/:draftId',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['drafts'], params: NewParams, response: { 200: DraftResponseSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const key = 'new:' + (req.params as { draftId: string }).draftId;
      const draft = await repo.getDraft(app.db, key, user.id);
      if (!draft) throw notFound('הטיוטה');
      return draft;
    },
  );

  app.put(
    '/drafts/new/:draftId',
    {
      config: { requires: ['docs.create'] },
      schema: {
        tags: ['drafts'],
        params: NewParams,
        body: DraftBodySchema,
        response: { 200: DraftResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const key = 'new:' + (req.params as { draftId: string }).draftId;
      const body = req.body as z.infer<typeof DraftBodySchema>;
      return withTransaction(app.db, (tx) => repo.putDraft(tx, key, null, user.id, body.payload));
    },
  );

  app.delete(
    '/drafts/new/:draftId',
    { config: { requires: ['docs.create'] }, schema: { tags: ['drafts'], params: NewParams } },
    async (req, reply) => {
      const user = requireUser(req);
      const key = 'new:' + (req.params as { draftId: string }).draftId;
      await withTransaction(app.db, (tx) => repo.deleteDraft(tx, key, user.id));
      reply.code(204);
      return null;
    },
  );
}
