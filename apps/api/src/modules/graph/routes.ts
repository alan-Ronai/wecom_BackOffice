import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  GraphNodeKindSchema,
  GraphQuerySchema,
  GraphResponseSchema,
  ImpactResponseSchema,
  LinkTypeSchema,
} from '@wecom/shared';
import { notFound } from '../../lib/http.js';
import { requireUser } from '../../lib/user.js';
import * as repo from './repo.js';

const Params = z.object({ nodeId: z.string().min(3) });

/** Hebrew field names arrive percent-encoded; find-my-way decodes once, guard against the rest. */
const decodeId = (raw: string) => (/%[0-9A-Fa-f]{2}/.test(raw) ? decodeURIComponent(raw) : raw);

const commaList = <T extends string>(raw: string | undefined, allowed: readonly T[]): T[] =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is T => (allowed as readonly string[]).includes(s));

export default async function routes(app: FastifyInstance) {
  app.get(
    '/graph',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['graph'], querystring: GraphQuerySchema, response: { 200: GraphResponseSchema } },
    },
    async (req) => {
      requireUser(req);
      const q = req.query as z.infer<typeof GraphQuerySchema>;
      const data = await repo.loadGraph(app.db, {
        types: commaList(q.types, LinkTypeSchema.options),
        kinds: commaList(q.kinds, GraphNodeKindSchema.options),
        category: q.category,
      });
      const focus = q.focus ? decodeId(q.focus) : undefined;
      if (focus && !data.nodes.has(focus)) throw notFound('הצומת');
      return repo.selectGraph(data, { focus, depth: q.depth, limit: q.limit });
    },
  );

  app.get(
    '/graph/impact/:nodeId',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['graph'], params: Params, response: { 200: ImpactResponseSchema } },
    },
    async (req) => {
      requireUser(req);
      const raw = decodeId((req.params as { nodeId: string }).nodeId);
      const ref = repo.parseNodeId(raw);
      if (!ref) throw notFound('הצומת');
      const data = await repo.loadGraph(app.db);
      const node = data.nodes.get(repo.nodeId(ref.kind, ref.key));
      if (!node) throw notFound('הצומת');
      const [inbound, brokenLinks] = await Promise.all([
        repo.inboundFor(app.db, ref),
        repo.brokenLinkCount(app.db, ref),
      ]);
      return {
        node,
        inbound,
        brokenLinks,
        affectedDocuments: new Set(inbound.map((i) => i.documentId)).size,
      };
    },
  );
}
