import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AssignBodySchema,
  AssignResultSchema,
  AssignmentSchema,
  AttemptAnswersSchema,
  AttemptResultSchema,
  AudienceCreateSchema,
  AudienceSchema,
  CompletionResponseSchema,
  DocumentLearningSchema,
  IdSchema,
  LearningDashboardQuerySchema,
  LearningDashboardSchema,
  MyLearningResponseSchema,
  PlayerItemSchema,
  StartAttemptResponseSchema,
} from '@wecom/shared';
import { audit } from '../../../lib/audit.js';
import { notFound } from '../../../lib/http.js';
import { withTransaction } from '../../../lib/sql.js';
import { requireUser } from '../../../lib/user.js';
import { getWorkflowSettings } from '../../../lib/workflowSettings.js';
import { assertVisibleDocument } from '../../../lib/visibility.js';
import * as repo from './repo.js';
import { createAssignments, type TrackingDeps } from './audiences.js';
import { getPublishedItem } from './itemsPort.js';

const Id = z.object({ id: IdSchema });
const AssignmentId = z.object({ assignmentId: IdSchema });

/** The eleven V2 routes of `docs/api/CONTRACTS-wave5.md`. */
export default function trackingRoutes(deps: () => TrackingDeps) {
  return async function routes(app: FastifyInstance) {
    app.post(
      '/learning/items/:id/audiences',
      {
        config: { requires: ['learning.manage'] },
        schema: { tags: ['learning'], params: Id, body: AudienceCreateSchema, response: { 200: AudienceSchema } },
      },
      async (req) => {
        const user = requireUser(req);
        const { id } = req.params as { id: string };
        const body = req.body as z.infer<typeof AudienceCreateSchema>;
        return withTransaction(app.db, async (tx) => {
          const a = await repo.createAudience(tx, deps(), id, body, user.id);
          await audit(tx, {
            actorId: user.id,
            action: 'learning.audience.create',
            entityType: 'learning_item',
            entityId: id,
            before: null,
            after: { audienceId: a.id, resolvedUsers: a.resolvedUsers },
            requestId: req.id,
            ip: req.ip,
          });
          return a;
        });
      },
    );

    app.delete(
      '/learning/audiences/:id',
      { config: { requires: ['learning.manage'] }, schema: { tags: ['learning'], params: Id } },
      async (req, reply) => {
        const user = requireUser(req);
        const { id } = req.params as { id: string };
        await withTransaction(app.db, async (tx) => {
          if (!(await repo.deleteAudience(tx, id))) throw notFound('קהל היעד');
          await audit(tx, {
            actorId: user.id,
            action: 'learning.audience.delete',
            entityType: 'learning_audience',
            entityId: id,
            before: null,
            after: null,
            requestId: req.id,
            ip: req.ip,
          });
        });
        reply.code(204);
        return null;
      },
    );

    app.post(
      '/learning/items/:id/assign',
      {
        config: { requires: ['learning.manage'] },
        schema: { tags: ['learning'], params: Id, body: AssignBodySchema, response: { 200: AssignResultSchema } },
      },
      async (req) => {
        const user = requireUser(req);
        const { id } = req.params as { id: string };
        const body = req.body as z.infer<typeof AssignBodySchema>;
        return withTransaction(app.db, async (tx) => {
          const pub = await getPublishedItem(tx, id);
          if (!pub) throw notFound('פריט הלמידה');
          const r = await createAssignments(tx, deps(), {
            item: pub.item,
            userIds: body.userIds,
            reason: 'manual',
            dueDays: body.dueDays ?? 14,
            actorId: user.id,
          });
          await audit(tx, {
            actorId: user.id,
            action: 'learning.assign',
            entityType: 'learning_item',
            entityId: id,
            before: null,
            after: { assigned: r.assigned, skipped: r.skipped },
            requestId: req.id,
            ip: req.ip,
          });
          return { assigned: r.assigned, skipped: r.skipped };
        });
      },
    );

    app.get(
      '/learning/my',
      { config: { requires: ['learning.read'] }, schema: { tags: ['learning'], response: { 200: MyLearningResponseSchema } } },
      async (req) => repo.myLearning(app.db, requireUser(req).id),
    );

    app.get(
      '/learning/my/:assignmentId',
      {
        config: { requires: ['learning.read'] },
        schema: { tags: ['learning'], params: AssignmentId, response: { 200: PlayerItemSchema } },
      },
      async (req) => {
        const user = requireUser(req);
        const p = await repo.playerItem(
          app.db,
          (req.params as { assignmentId: string }).assignmentId,
          user.id,
        );
        if (!p) throw notFound('המשימה');
        return p;
      },
    );

    app.post(
      '/learning/my/:assignmentId/acknowledge',
      {
        config: { requires: ['learning.read'] },
        schema: { tags: ['learning'], params: AssignmentId, response: { 200: AssignmentSchema } },
      },
      async (req) => {
        const user = requireUser(req);
        return withTransaction(app.db, (tx) =>
          repo.acknowledge(tx, deps(), (req.params as { assignmentId: string }).assignmentId, user.id),
        );
      },
    );

    app.post(
      '/learning/my/:assignmentId/attempts',
      {
        config: { requires: ['learning.read'] },
        schema: { tags: ['learning'], params: AssignmentId, response: { 201: StartAttemptResponseSchema } },
      },
      async (req, reply) => {
        const user = requireUser(req);
        const r = await withTransaction(app.db, async (tx) =>
          repo.startAttempt(
            tx,
            (req.params as { assignmentId: string }).assignmentId,
            user.id,
            await getWorkflowSettings(tx),
          ),
        );
        reply.code(201);
        return r;
      },
    );

    app.put(
      '/learning/attempts/:id',
      {
        config: { requires: ['learning.read'] },
        schema: { tags: ['learning'], params: Id, body: AttemptAnswersSchema, response: { 200: AttemptResultSchema } },
      },
      async (req) => {
        const user = requireUser(req);
        const body = req.body as z.infer<typeof AttemptAnswersSchema>;
        return withTransaction(app.db, async (tx) =>
          repo.submitAttempt(
            tx,
            deps(),
            (req.params as { id: string }).id,
            user.id,
            body.answers,
            await getWorkflowSettings(tx),
          ),
        );
      },
    );

    app.get(
      '/learning/items/:id/completion',
      {
        config: { requires: ['learning.manage'] },
        schema: { tags: ['learning'], params: Id, response: { 200: CompletionResponseSchema } },
      },
      async (req) =>
        repo.completionFor(app.db, (req.params as { id: string }).id, requireUser(req).worldScopes),
    );

    app.get(
      '/learning/dashboard',
      {
        config: { requires: ['learning.manage'] },
        schema: {
          tags: ['learning'],
          querystring: LearningDashboardQuerySchema,
          response: { 200: LearningDashboardSchema },
        },
      },
      async (req) =>
        repo.dashboard(app.db, (req.query as { world?: string }).world, requireUser(req).worldScopes),
    );

    app.get(
      '/documents/:id/learning',
      {
        config: { requires: ['docs.read'], scope: 'document' },
        schema: { tags: ['learning'], params: Id, response: { 200: DocumentLearningSchema } },
      },
      async (req) => {
        const user = requireUser(req);
        const { id } = req.params as { id: string };
        await assertVisibleDocument(app.db, id, user);
        return repo.documentLearning(app.db, id, user.id);
      },
    );
  };
}
