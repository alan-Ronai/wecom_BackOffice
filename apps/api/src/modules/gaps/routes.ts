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
import { hasScope, requireUser } from '../../lib/user.js';
import { runDetection, type DetectDeps } from './detect.js';
import * as repo from './repo.js';

const Params = z.object({ id: IdSchema });

/** V3 gap routes. `deps` is resolved lazily so the notifier/taxonomy in force at call time is used. */
export default function gapsRoutes(deps: () => DetectDeps) {
  return async function routes(instance: FastifyInstance) {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    /**
     * A-I6: the reads were scoped and the writes were not.
     *
     * `listGaps` narrows by `worldScopes` (treating a world-less gap as visible to all, because a
     * zero-result search carries no world and those are the most actionable kind). `dismiss` and
     * `resolve` took only `gaps.manage` and acted on the row by id, so a `billing` lead could
     * dismiss a `tech` gap they cannot see in their own list — and `resolve` read the row back
     * afterwards, leaking the out-of-scope gap's title in the response, which is exactly what
     * `scope-leak.test.ts` was extended to prevent on the list route.
     *
     * 404 rather than 403, matching the list: a gap the caller may not see does not exist for them.
     */
    const visibleGap = async (tx: Parameters<typeof repo.getGap>[0], id: string, user: ReturnType<typeof requireUser>) => {
      const gap = await repo.getGap(tx, id);
      if (!gap) throw notFound('הפער');
      if (user.worldScopes && gap.worldSlug && !hasScope(user, gap.worldSlug)) throw notFound('הפער');
      return gap;
    };

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
          const before = await visibleGap(tx, id, user);
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
          const before = await visibleGap(tx, id, user);
          /**
           * A-I6: the *document* is scope-checked too. `resolve` only asked that the row exist,
           * so a lead could link a gap to a document in a world they cannot read — and the gap's
           * `resolved_document_id` is what `autoResolvePublished` then watches.
           */
          const doc = await tx.query<{ id: string; worlds: string[] }>(
            `select d.id, coalesce(array_agg(dw.world_slug) filter (where dw.world_slug is not null), '{}') worlds
               from documents d left join document_worlds dw on dw.document_id = d.id
              where d.id=$1 and d.deleted_at is null group by d.id`,
            [documentId],
          );
          if (!doc.rowCount) throw notFound('המסמך');
          const worlds = doc.rows[0].worlds ?? [];
          if (worlds.length && !hasScope(user, worlds)) throw notFound('המסמך');
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
