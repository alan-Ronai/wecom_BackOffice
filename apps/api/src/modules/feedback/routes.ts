import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateFeedbackBodySchema,
  DocumentFeedbackResponseSchema,
  FeedbackAnalyticsQuerySchema,
  FeedbackAnalyticsSchema,
  FeedbackDetailSchema,
  FeedbackListResponseSchema,
  FeedbackPatchBodySchema,
  FeedbackQuerySchema,
  FeedbackResolveBodySchema,
  FeedbackRowSchema,
  FeedbackSchema,
  IdSchema,
  makeEvent,
} from '@wecom/shared';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/http.js';
import { withTransaction } from '../../lib/sql.js';
import { hasScope, requireUser } from '../../lib/user.js';
import { assertVisibleDocument } from '../../lib/visibility.js';
import { TtlCache } from '../usage/cache.js';
import * as repo from './repo.js';
import { notifyOnCreate, type AlertDeps } from './alerts.js';

const Params = z.object({ id: IdSchema });

export default function feedbackRoutes(deps: () => AlertDeps) {
  return async function routes(app: FastifyInstance) {
    app.post(
      '/documents/:id/feedback',
      {
        config: { requires: ['docs.read'], scope: 'document' },
        schema: {
          tags: ['feedback'],
          params: Params,
          body: CreateFeedbackBodySchema,
          response: { 201: FeedbackSchema },
        },
      },
      async (req, reply) => {
        const user = requireUser(req);
        const { id } = req.params as { id: string };
        const body = req.body as z.infer<typeof CreateFeedbackBodySchema>;
        // `scope: 'document'` is the world half only, and `captureContext` loads any live
        // document regardless of status: without this a reader can file feedback against a
        // draft, and the 404-vs-201 difference tells them the draft exists.
        await assertVisibleDocument(app.db, id, user);
        const ctx = await repo.captureContext(app.db, app.taxonomy, id);
        if (!ctx) throw notFound('המסמך');
        const created = await withTransaction(app.db, async (tx) => {
          const f = await repo.createFeedback(tx, {
            documentId: id,
            kind: body.kind,
            text: body.text,
            stepKey: body.stepKey ?? null,
            userId: user.id,
            ctx,
          });
          await audit(tx, {
            actorId: user.id,
            action: 'feedback.create',
            entityType: 'feedback',
            entityId: f.id,
            before: null,
            after: { documentId: id, kind: f.kind, version: f.documentVersion, stepKey: f.stepKey },
            requestId: req.id,
            ip: req.ip,
          });
          await app.events.publish(
            tx,
            makeEvent('feedback.created', { feedbackId: f.id, documentId: id, kind: f.kind }),
          );
          return f;
        });
        // Alerts run after commit and never fail the report.
        try {
          await notifyOnCreate(deps(), created, ctx.title);
        } catch (err) {
          app.log.error({ err, feedbackId: created.id }, 'feedback alert failed');
        }
        reply.code(201);
        return created;
      },
    );

    app.get(
      '/documents/:id/feedback',
      {
        config: { requires: ['docs.edit'], scope: 'document' },
        schema: { tags: ['feedback'], params: Params, response: { 200: DocumentFeedbackResponseSchema } },
      },
      async (req) => {
        requireUser(req);
        return { items: await repo.openForDocument(app.db, (req.params as { id: string }).id) };
      },
    );

    app.get(
      '/feedback',
      {
        config: { requires: ['feedback.manage'] },
        schema: {
          tags: ['feedback'],
          querystring: FeedbackQuerySchema,
          response: { 200: FeedbackListResponseSchema },
        },
      },
      async (req) => {
        const user = requireUser(req);
        const q = req.query as z.infer<typeof FeedbackQuerySchema>;
        const r = await repo.listFeedback(app.db, q, user.worldScopes);
        return { ...r, page: q.page, pageSize: q.pageSize };
      },
    );

    // 60 s (spec §3), size-capped, and keyed on the caller's scope set as well as the query —
    // otherwise scoping the data would cross-serve one editor's snapshot to another.
    const cache = new TtlCache<unknown>(60_000);
    app.get(
      '/feedback/analytics',
      {
        config: { requires: ['feedback.manage'] },
        schema: {
          tags: ['feedback'],
          querystring: FeedbackAnalyticsQuerySchema,
          response: { 200: FeedbackAnalyticsSchema },
        },
      },
      async (req) => {
        const user = requireUser(req);
        const q = req.query as z.infer<typeof FeedbackAnalyticsQuerySchema>;
        const key = JSON.stringify([q, user.worldScopes ? [...user.worldScopes].sort() : null]);
        const hit = cache.get(key);
        if (hit !== undefined && app.config.NODE_ENV !== 'test') return hit;
        const value = await repo.feedbackAnalytics(app.db, q, user.worldScopes);
        cache.set(key, value);
        return value;
      },
    );

    app.get(
      '/feedback/:id',
      {
        config: { requires: ['feedback.manage'] },
        schema: { tags: ['feedback'], params: Params, response: { 200: FeedbackDetailSchema } },
      },
      async (req) => {
        const user = requireUser(req);
        const d = await repo.getFeedbackDetail(
          app.db,
          (req.params as { id: string }).id,
          user.worldScopes,
        );
        if (!d) throw notFound('המשוב');
        return d;
      },
    );

    app.patch(
      '/feedback/:id',
      {
        config: { requires: ['feedback.manage'] },
        schema: {
          tags: ['feedback'],
          params: Params,
          body: FeedbackPatchBodySchema,
          response: { 200: FeedbackRowSchema },
        },
      },
      async (req) => {
        const user = requireUser(req);
        const { id } = req.params as { id: string };
        const body = req.body as z.infer<typeof FeedbackPatchBodySchema>;
        return withTransaction(app.db, async (tx) => {
          const before = await repo.getFeedback(tx, id);
          // Same boundary as the queue that surfaced this row (B-I1): 404, not 403, so the
          // queue and the drawer cannot disagree about whether a report exists.
          if (!before || !hasScope(user, before.worldSlug)) throw notFound('המשוב');
          const after = (await repo.patchFeedback(tx, id, body, user.id))!;
          await audit(tx, {
            actorId: user.id,
            action: 'feedback.update',
            entityType: 'feedback',
            entityId: id,
            before: { status: before.status, assigneeId: before.assigneeId },
            after: { status: after.status, assigneeId: after.assigneeId, decisionNote: after.decisionNote },
            requestId: req.id,
            ip: req.ip,
          });
          await app.events.publish(
            tx,
            makeEvent('feedback.updated', {
              feedbackId: id,
              documentId: after.documentId,
              status: after.status,
            }),
          );
          return after;
        });
      },
    );

    app.post(
      '/feedback/:id/resolve',
      {
        config: { requires: ['feedback.manage'] },
        schema: {
          tags: ['feedback'],
          params: Params,
          body: FeedbackResolveBodySchema,
          response: { 200: FeedbackRowSchema },
        },
      },
      async (req) => {
        const user = requireUser(req);
        const { id } = req.params as { id: string };
        const body = req.body as z.infer<typeof FeedbackResolveBodySchema>;
        return withTransaction(app.db, async (tx) => {
          const before = await repo.getFeedback(tx, id);
          // Same boundary as the queue that surfaced this row (B-I1): 404, not 403, so the
          // queue and the drawer cannot disagree about whether a report exists.
          if (!before || !hasScope(user, before.worldSlug)) throw notFound('המשוב');
          const after = (await repo.resolveOne(tx, id, body.version, body.decisionNote, user.id))!;
          await audit(tx, {
            actorId: user.id,
            action: 'feedback.resolve',
            entityType: 'feedback',
            entityId: id,
            before: { status: before.status },
            after: { status: 'done', resolvedVersion: body.version },
            requestId: req.id,
            ip: req.ip,
          });
          await app.events.publish(
            tx,
            makeEvent('feedback.updated', { feedbackId: id, documentId: after.documentId, status: 'done' }),
          );
          return after;
        });
      },
    );
  };
}
