import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DraftBodySchema, DraftResponseSchema } from '@wecom/shared';
import { withTransaction } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import * as drafts from '../drafts/repo.js';

/**
 * The server-side draft behind `/edit/new`. The existing `/drafts/new/:draftId` routes
 * keep working for a named scratch document; this pair is the single unnamed one the
 * editor opens when nobody picked an id yet, so "new card" survives a reload.
 */
const KEY = 'new:default';

export default async function newDraftRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/drafts/new',
    {
      config: { requires: ['docs.create'] },
      schema: { tags: ['collab'], response: { 200: DraftResponseSchema, 204: z.null() } },
    },
    // Nobody has started a new card yet is a normal state, not an error.
    async (req, reply) => {
      const user = requireUser(req);
      const draft = await drafts.getDraft(app.db, KEY, user.id);
      if (!draft) return reply.code(204).send(null);
      return draft;
    },
  );

  app.put(
    '/drafts/new',
    {
      config: { requires: ['docs.create'] },
      schema: { tags: ['collab'], body: DraftBodySchema, response: { 200: DraftResponseSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      return withTransaction(app.db, (tx) => drafts.putDraft(tx, KEY, null, user.id, req.body.payload));
    },
  );

  app.delete(
    '/drafts/new',
    {
      config: { requires: ['docs.create'] },
      schema: { tags: ['collab'], response: { 204: z.null() } },
    },
    async (req, reply) => {
      const user = requireUser(req);
      await withTransaction(app.db, (tx) => drafts.deleteDraft(tx, KEY, user.id));
      reply.code(204);
      return null;
    },
  );
}
