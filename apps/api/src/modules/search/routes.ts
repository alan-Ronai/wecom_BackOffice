import type { FastifyInstance } from 'fastify';
import type { ModelClient } from '@wecom/model';
import { SearchQuerySchema, SearchResponseSchema } from '@wecom/shared';
import { requireUser } from '../../lib/user.js';
import { search } from './repo.js';

export default async function routes(app: FastifyInstance) {
  app.get(
    '/search',
    {
      config: { requires: ['docs.read'] },
      schema: {
        tags: ['search'],
        querystring: SearchQuerySchema,
        response: { 200: SearchResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      // L5 sets `app.model` when the local model is wired up; absent, search stays text-only.
      const model = (app as unknown as { model?: ModelClient | null }).model ?? null;
      return search(app.db, req.query as Parameters<typeof search>[1], model, user.worldScopes);
    },
  );
}
