import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AssignBodySchema,
  AssignResultSchema,
  AssignmentSchema,
  AttemptAnswersSchema,
  AttemptResultSchema,
  AudienceCreateSchema,
  AudienceOptionsSchema,
  AudienceSchema,
  ChangePreviewSchema,
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
import { forbidden, httpError, notFound } from '../../../lib/http.js';
import { withTransaction, type Queryable } from '../../../lib/sql.js';
import { hasScope, requireUser } from '../../../lib/user.js';
import { getWorkflowSettings } from '../../../lib/workflowSettings.js';
import { assertVisibleDocument } from '../../../lib/visibility.js';
import * as repo from './repo.js';
import { createAssignments, isAssignable, type TrackingDeps } from './audiences.js';
import { getPublishedItem } from './itemsPort.js';
import { previewChangeFlag } from './refresh.js';
import { worldsOfItem } from '../repo.js';

const Id = z.object({ id: IdSchema });
const AssignmentId = z.object({ assignmentId: IdSchema });

/** The eleven V2 routes of `docs/api/CONTRACTS-wave5.md`. */
export default function trackingRoutes(deps: () => TrackingDeps) {
  return async function routes(app: FastifyInstance) {
    /**
     * A-I1: V1's routes have this; V2's equivalents never adopted it.
     *
     * `learning.manage` alone let a manager scoped to `billing` assign a `tech` item to arbitrary
     * users, delete an audience belonging to any item, and read the completion state — title,
     * description, counts and rate — of a quiz they cannot see in their own list. The item's
     * worlds are its own `world_slug` or, when it has none, the union of its referenced
     * documents' worlds, which is exactly what V1's `assertScope` compares. An item with no
     * world at all stays visible to everyone, as it is in V1.
     */
    const assertItemScope = async (q: Queryable, id: string, user: ReturnType<typeof requireUser>) => {
      const worlds = await worldsOfItem(q, id);
      if (worlds.length && !hasScope(user, worlds)) throw forbidden();
    };
    /**
     * A-I4: spec §1.8 — an item whose referenced document is invalid or archived is "hidden from
     * new assignments". `createAssignments` enforces it silently for the nightly job; a manager
     * asking for it by hand gets told why.
     */
    const assertAssignable = async (q: Queryable, id: string) => {
      if (!(await isAssignable(q, id)))
        throw httpError(409, 'ITEM_NEEDS_UPDATE', 'הפריט מסומן "דורש עדכון" ואינו ניתן להקצאה חדשה', {
          itemId: id,
        });
    };
    app.post(
      '/learning/items/:id/audiences',
      {
        config: { requires: ['learning.manage'] },
        schema: {
          tags: ['learning'],
          params: Id,
          body: AudienceCreateSchema,
          response: { 200: AudienceSchema },
        },
      },
      async (req) => {
        const user = requireUser(req);
        const { id } = req.params as { id: string };
        const body = req.body as z.infer<typeof AudienceCreateSchema>;
        return withTransaction(app.db, async (tx) => {
          await assertItemScope(tx, id, user);
          await assertAssignable(tx, id);
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
          // A-I1: the audience is addressed by its own id, so its item has to be resolved before
          // the delete to know whose it is.
          const itemId = await repo.audienceItemId(tx, id);
          if (!itemId) throw notFound('קהל היעד');
          await assertItemScope(tx, itemId, user);
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
        schema: {
          tags: ['learning'],
          params: Id,
          body: AssignBodySchema,
          response: { 200: AssignResultSchema },
        },
      },
      async (req) => {
        const user = requireUser(req);
        const { id } = req.params as { id: string };
        const body = req.body as z.infer<typeof AssignBodySchema>;
        return withTransaction(app.db, async (tx) => {
          await assertItemScope(tx, id, user);
          await assertAssignable(tx, id);
          const pub = await getPublishedItem(tx, id);
          if (!pub) throw notFound('פריט הלמידה');
          // A-I1: and the recipients. Scoping the item alone still let a `billing` manager hand a
          // `billing` item to 500 arbitrary user ids, the `tech` floor included.
          const out = await repo.userIdsOutOfScope(tx, body.userIds, user.worldScopes);
          if (out.length)
            throw httpError(403, 'USER_OUT_OF_SCOPE', 'חלק מהמשתמשים אינם בעולמות התוכן שלך', {
              userIds: out.slice(0, 10),
              count: out.length,
            });
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
      {
        config: { requires: ['learning.read'] },
        schema: { tags: ['learning'], response: { 200: MyLearningResponseSchema } },
      },
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
        schema: {
          tags: ['learning'],
          params: Id,
          body: AttemptAnswersSchema,
          response: { 200: AttemptResultSchema },
        },
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
      async (req) => {
        const user = requireUser(req);
        const { id } = req.params as { id: string };
        // A-I1: `completionFor` filters the *rows* to users in the caller's worlds, but the item
        // itself was never checked — so its card (title, description, counts, completion rate)
        // came back for a quiz in a world the caller cannot see.
        await assertItemScope(app.db, id, user);
        return repo.completionFor(app.db, id, user.worldScopes);
      },
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

    /**
     * V6 seam. The assign dialog needs the role names and the world list; `GET /admin/roles` would
     * have served, but it is `roles.manage`, so a lead holding only `learning.manage` saw an empty
     * audience picker against the real API. Names and labels only — no permission grants.
     */
    app.get(
      '/learning/audience-options',
      {
        config: { requires: ['learning.manage'] },
        schema: { tags: ['learning'], response: { 200: AudienceOptionsSchema } },
      },
      async () => {
        const roles = await app.db.query(
          `select name, coalesce(nullif(description,''), name) as label from roles order by system desc, name`,
        );
        const worlds = await app.db.query(
          `select slug, name from worlds where active order by position, slug`,
        );
        return {
          roles: roles.rows.map((r) => ({ name: r.name as string, label: r.label as string })),
          worlds: worlds.rows.map((w) => ({ slug: w.slug as string, name: w.name as string })),
        };
      },
    );

    /**
     * V6 seam (the plan's Task 4 decision): the publish dialog pre-ticks "שינוי מהותי" from the
     * detector rather than from a client-side diff, so the checkbox and the flag the publish
     * actually records are the same verdict. Read-only — nothing is written until the publish.
     */
    app.get(
      '/documents/:id/change-preview',
      {
        config: { requires: ['docs.publish'], scope: 'document' },
        schema: { tags: ['learning'], params: Id, response: { 200: ChangePreviewSchema } },
      },
      async (req) => {
        const user = requireUser(req);
        const { id } = req.params as { id: string };
        await assertVisibleDocument(app.db, id, user);
        return previewChangeFlag(app.db, id);
      },
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
