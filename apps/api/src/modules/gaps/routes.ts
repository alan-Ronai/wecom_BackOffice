import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  GapDetectResultSchema,
  GapDismissBodySchema,
  GapResolveBodySchema,
  GapSchema,
  GapsQuerySchema,
  GapsResponseSchema,
  IdSchema,
  makeEvent,
} from '@wecom/shared';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/http.js';
import { withTransaction } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import { runDetection, type DetectDeps } from './detect.js';
import * as repo from './repo.js';

const Params = z.object({ id: IdSchema });

/** V3 gap routes. `deps` is resolved lazily so the notifier/taxonomy in force at call time is used. */
export default function gapsRoutes(deps: () => DetectDeps) {
  return async function routes(instance: FastifyInstance) {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.get(
      '/gaps',
      {
        config: { requires: ['gaps.read'] },
        schema: { tags: ['gaps'], querystring: GapsQuerySchema, response: { 200: GapsResponseSchema } },
      },
      async (req) => {
        const user = requireUser(req);
        const query = req.query;
        const { items, total } = await repo.listGaps(app.db, query, user.worldScopes);
        return {
          items,
          total,
          page: query.page,
          pageSize: query.pageSize,
          lastRunAt: await repo.lastRunAt(app.db),
        };
      },
    );

    app.post(
      '/gaps/:id/dismiss',
      {
        config: { requires: ['gaps.manage'] },
        schema: { tags: ['gaps'], params: Params, body: GapDismissBodySchema, response: { 200: GapSchema } },
      },
      async (req) => {
        const user = requireUser(req);
        const { id } = req.params;
        const { reason } = req.body;
        return withTransaction(app.db, async (tx) => {
          const before = await repo.getGap(tx, id);
          if (!before) throw notFound('הפער');
          const g = await repo.dismissGap(tx, id, reason, user.id);
          if (!g) throw notFound('הפער');
          await audit(tx, {
            actorId: user.id,
            action: 'gaps.dismiss',
            entityType: 'gap',
            entityId: id,
            before: { status: before.status },
            after: { status: 'dismissed', reason },
            requestId: req.id,
            ip: req.ip,
          });
          return g;
        });
      },
    );

    app.post(
      '/gaps/:id/resolve',
      {
        config: { requires: ['gaps.manage'] },
        schema: { tags: ['gaps'], params: Params, body: GapResolveBodySchema, response: { 200: GapSchema } },
      },
      async (req) => {
        const user = requireUser(req);
        const { id } = req.params;
        const { documentId } = req.body;
        return withTransaction(app.db, async (tx) => {
          const doc = await tx.query('select id from documents where id=$1 and deleted_at is null', [
            documentId,
          ]);
          if (!doc.rowCount) throw notFound('המסמך');
          const before = await repo.getGap(tx, id);
          if (!before) throw notFound('הפער');
          const g = await repo.resolveGap(tx, id, documentId);
          if (!g) throw notFound('הפער');
          await audit(tx, {
            actorId: user.id,
            action: 'gaps.resolve',
            entityType: 'gap',
            entityId: id,
            before: { status: before.status },
            after: { status: g.status, documentId },
            requestId: req.id,
            ip: req.ip,
          });
          return g;
        });
      },
    );

    app.post(
      '/gaps/detect',
      {
        config: { requires: ['gaps.manage'] },
        schema: { tags: ['gaps'], response: { 200: GapDetectResultSchema } },
      },
      async (req) => {
        const user = requireUser(req);
        const r = await runDetection({
          ...deps(),
          publish: (tx, gapId, kind) => app.events.publish(tx, makeEvent('gap.detected', { gapId, kind })),
        });
        await app.audit(req, 'gaps.detect', 'gap_run', null, null, { ...r, by: user.id });
        return r;
      },
    );
  };
}
