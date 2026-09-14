import type { FastifyInstance } from 'fastify';
import type { ModelClient } from '@wecom/model';
import { SearchQuerySchema, SearchResponseSchema } from '@wecom/shared';
import { requireUser } from '../../lib/user.js';
import { canReadUnpublished } from '../../lib/visibility.js';
import { search } from './repo.js';
import { labelHits } from './label.js';

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
      const query = req.query as Parameters<typeof search>[1] & {
        world?: string;
        topic?: string;
        docType?: string;
        tag?: string[];
      };
      const found = await search(app.db, query, model, user.worldScopes, canReadUnpublished(user));
      // A-2: attach the knowledge item behind each hit (type, world, title) so the palette can
      // label a result the way a library card does instead of showing the ingest filename.
      const result = await labelHits(app.db, found);
      // W5: usage log. Not awaited on purpose — the response must not wait for, or fail on, the insert.
      const filters: Record<string, unknown> = {};
      for (const k of ['types', 'world', 'topic', 'docType', 'tag'] as const)
        if (query[k] !== undefined) filters[k] = query[k];
      void app.usage
        .recordSearch({ userId: user.id, q: query.q, filters, results: result.total, tookMs: result.tookMs })
        .catch(() => undefined);
      return result;
    },
  );
}
