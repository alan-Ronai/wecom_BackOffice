/**
 * Wave 5 (V1) — the "Learning content" half of spec §4: authoring briefings and quizzes over
 * published documents, generating questions, and publishing a snapshot that pins the referenced
 * documents' versions. V2 registers assignments, the player and tracking in the same prefix.
 *
 * Visibility is one decision, `repo.canSee`: without `learning.manage` only published items
 * exist, and a world-scoped manager sees only items in their worlds. A hidden item is a 404,
 * never a 403 — the same reasoning as documents: a 403 would confirm the item exists.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  GenerateQuestionsBodySchema,
  GenerateQuestionsResponseSchema,
  IdSchema,
  LearningItemCreateSchema,
  LearningItemPatchSchema,
  LearningItemSchema,
  LearningItemsQuerySchema,
  LearningItemsResponseSchema,
  LearningPreviewSchema,
  LearningPublishBodySchema,
  LearningPublishResponseSchema,
  LearningVersionsResponseSchema,
  PutEntriesBodySchema,
  PutQuestionsBodySchema,
} from '@wecom/shared';
import type { ModelClient } from '@wecom/model';
import { audit } from '../../lib/audit.js';
import { forbidden, httpError, notFound } from '../../lib/http.js';
import { withTransaction } from '../../lib/sql.js';
import { hasScope, requireUser } from '../../lib/user.js';
import * as repo from './repo.js';
import { generateQuestions } from './generate.js';

const Params = z.object({ id: IdSchema });
const NOT_FOUND = 'פריט הלמידה';

export default async function learningRoutes(app: FastifyInstance) {
  /** The item, or a 404 for anyone who may not see it. */
  const visible = async (id: string, user: ReturnType<typeof requireUser>) => {
    const item = await repo.getItem(app.db, id);
    if (!item) throw notFound(NOT_FOUND);
    if (!(await repo.canSee(app.db, item, repo.viewerOf(user)))) throw notFound(NOT_FOUND);
    return item;
  };
  /** A world-scoped manager may only author inside their own worlds. */
  const assertScope = async (id: string, user: ReturnType<typeof requireUser>) => {
    const worlds = await repo.worldsOfItem(app.db, id);
    if (worlds.length && !hasScope(user, worlds)) throw forbidden();
  };

  app.get(
    '/learning/items',
    {
      config: { requires: ['learning.read'] },
      schema: {
        tags: ['learning'],
        querystring: LearningItemsQuerySchema,
        response: { 200: LearningItemsResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const query = req.query as z.infer<typeof LearningItemsQuerySchema>;
      const { items, total } = await repo.listCards(app.db, query, repo.viewerOf(user));
      return { items, total, page: query.page, pageSize: query.pageSize };
    },
  );

  app.post(
    '/learning/items',
    {
      config: { requires: ['learning.manage'] },
      schema: {
        tags: ['learning'],
        body: LearningItemCreateSchema,
        response: { 201: LearningItemSchema },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const body = req.body as z.infer<typeof LearningItemCreateSchema>;
      if (body.worldSlug && !hasScope(user, body.worldSlug)) throw forbidden();
      const item = await withTransaction(app.db, async (tx) => {
        const created = await repo.createItem(tx, body, user.id);
        await audit(tx, {
          actorId: user.id,
          action: 'learning.create',
          entityType: 'learning_item',
          entityId: created.id,
          before: null,
          after: { kind: created.kind, title: created.title, worldSlug: created.worldSlug },
          requestId: req.id,
          ip: req.ip,
        });
        return created;
      });
      reply.code(201);
      return item;
    },
  );

  app.get(
    '/learning/items/:id',
    {
      config: { requires: ['learning.read'] },
      schema: { tags: ['learning'], params: Params, response: { 200: LearningItemSchema } },
    },
    async (req) => visible((req.params as z.infer<typeof Params>).id, requireUser(req)),
  );

  app.patch(
    '/learning/items/:id',
    {
      config: { requires: ['learning.manage'] },
      schema: {
        tags: ['learning'],
        params: Params,
        body: LearningItemPatchSchema,
        response: { 200: LearningItemSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as z.infer<typeof Params>;
      const body = req.body as z.infer<typeof LearningItemPatchSchema>;
      const before = await visible(id, user);
      await assertScope(id, user);
      if (body.worldSlug && !hasScope(user, body.worldSlug)) throw forbidden();
      return withTransaction(app.db, async (tx) => {
        const after = await repo.patchItem(tx, id, body, user.id);
        await audit(tx, {
          actorId: user.id,
          action: 'learning.patch',
          entityType: 'learning_item',
          entityId: id,
          before: {
            title: before.title,
            worldSlug: before.worldSlug,
            passMark: before.passMark,
            maxAttempts: before.maxAttempts,
          },
          after: {
            title: after.title,
            worldSlug: after.worldSlug,
            passMark: after.passMark,
            maxAttempts: after.maxAttempts,
          },
          requestId: req.id,
          ip: req.ip,
        });
        return after;
      });
    },
  );

  app.delete(
    '/learning/items/:id',
    {
      config: { requires: ['learning.manage'] },
      schema: { tags: ['learning'], params: Params },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { id } = req.params as z.infer<typeof Params>;
      const item = await visible(id, user);
      await assertScope(id, user);
      // A published item has learners against its snapshot, so it is archived rather than
      // deleted; a draft nobody ever saw is soft-deleted; an archived item is already there.
      if (item.status !== 'archived')
        await withTransaction(app.db, async (tx) => {
          const archive = item.status === 'published';
          if (archive) await repo.archiveItem(tx, id, user.id);
          else await repo.softDeleteItem(tx, id, user.id);
          await audit(tx, {
            actorId: user.id,
            action: archive ? 'learning.archive' : 'learning.delete',
            entityType: 'learning_item',
            entityId: id,
            before: { status: item.status },
            after: { status: archive ? 'archived' : 'deleted' },
            requestId: req.id,
            ip: req.ip,
          });
        });
      reply.code(204);
      return null;
    },
  );

  app.put(
    '/learning/items/:id/entries',
    {
      config: { requires: ['learning.manage'] },
      schema: {
        tags: ['learning'],
        params: Params,
        body: PutEntriesBodySchema,
        response: { 200: LearningItemSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as z.infer<typeof Params>;
      const body = req.body as z.infer<typeof PutEntriesBodySchema>;
      const item = await visible(id, user);
      await assertScope(id, user);
      if (item.kind !== 'briefing') throw httpError(400, 'WRONG_KIND', 'הפעולה מתאימה לתדריך בלבד');
      if (item.status === 'archived') throw httpError(409, 'ITEM_ARCHIVED', 'פריט בארכיון אינו ניתן לעריכה');
      return withTransaction(app.db, async (tx) => {
        const after = await repo.replaceEntries(tx, id, body.entries, user.id);
        await audit(tx, {
          actorId: user.id,
          action: 'learning.entries',
          entityType: 'learning_item',
          entityId: id,
          before: { count: item.entries.length },
          after: { count: after.entries.length },
          requestId: req.id,
          ip: req.ip,
        });
        return after;
      });
    },
  );

  app.put(
    '/learning/items/:id/questions',
    {
      config: { requires: ['learning.manage'] },
      schema: {
        tags: ['learning'],
        params: Params,
        body: PutQuestionsBodySchema,
        response: { 200: LearningItemSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as z.infer<typeof Params>;
      const body = req.body as z.infer<typeof PutQuestionsBodySchema>;
      const item = await visible(id, user);
      await assertScope(id, user);
      if (item.kind !== 'quiz') throw httpError(400, 'WRONG_KIND', 'הפעולה מתאימה לבוחן בלבד');
      if (item.status === 'archived') throw httpError(409, 'ITEM_ARCHIVED', 'פריט בארכיון אינו ניתן לעריכה');
      return withTransaction(app.db, async (tx) => {
        const after = await repo.replaceQuestions(tx, id, body.questions, user.id);
        await audit(tx, {
          actorId: user.id,
          action: 'learning.questions',
          entityType: 'learning_item',
          entityId: id,
          before: { count: item.questions.length },
          after: { count: after.questions.length },
          requestId: req.id,
          ip: req.ip,
        });
        return after;
      });
    },
  );

  app.post(
    '/learning/items/:id/generate',
    {
      config: { requires: ['learning.manage'] },
      schema: {
        tags: ['learning'],
        params: Params,
        body: GenerateQuestionsBodySchema,
        response: { 200: GenerateQuestionsResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as z.infer<typeof Params>;
      const body = req.body as z.infer<typeof GenerateQuestionsBodySchema>;
      const item = await visible(id, user);
      await assertScope(id, user);
      if (item.kind !== 'quiz') throw httpError(400, 'WRONG_KIND', 'הפעולה מתאימה לבוחן בלבד');
      // `app.model` is read at call time: the plugin decorates it on this scope, and tests swap it.
      const model = (app as FastifyInstance & { model?: ModelClient }).model ?? null;
      // Nothing is saved — the editor curates and then PUTs the questions.
      return generateQuestions({ db: app.db, model, log: app.log }, body);
    },
  );

  app.post(
    '/learning/items/:id/publish',
    {
      config: { requires: ['learning.publish'] },
      schema: {
        tags: ['learning'],
        params: Params,
        body: LearningPublishBodySchema,
        response: { 200: LearningPublishResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as z.infer<typeof Params>;
      const body = req.body as z.infer<typeof LearningPublishBodySchema>;
      await visible(id, user);
      await assertScope(id, user);
      return withTransaction(app.db, async (tx) => {
        const { item, version } = await repo.publishItem(tx, id, body.label, user.id);
        await audit(tx, {
          actorId: user.id,
          action: 'learning.publish',
          entityType: 'learning_item',
          entityId: id,
          before: null,
          after: { version, label: body.label, sourceVersions: item.sourceVersions },
          requestId: req.id,
          ip: req.ip,
        });
        return { item, version };
      });
    },
  );

  app.get(
    '/learning/items/:id/versions',
    {
      config: { requires: ['learning.read'] },
      schema: { tags: ['learning'], params: Params, response: { 200: LearningVersionsResponseSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as z.infer<typeof Params>;
      await visible(id, user);
      return { items: await repo.listVersions(app.db, id) };
    },
  );

  app.get(
    '/learning/items/:id/preview',
    {
      config: { requires: ['learning.read'] },
      schema: { tags: ['learning'], params: Params, response: { 200: LearningPreviewSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as z.infer<typeof Params>;
      const live = await visible(id, user);
      // A manager previews what they are building; everyone else previews the published
      // snapshot, which is exactly what a learner would be served.
      const viewer = repo.viewerOf(user);
      let item = live;
      if (!viewer.manage) {
        const published = await repo.getPublishedItem(app.db, id);
        if (!published) throw notFound(NOT_FOUND);
        item = published.item;
      }
      return {
        item: {
          id: item.id,
          kind: item.kind,
          title: item.title,
          description: item.description,
          worldSlug: item.worldSlug,
          currentVersion: item.currentVersion,
          passMark: item.passMark,
          maxAttempts: item.maxAttempts,
          estimatedMinutes: item.estimatedMinutes,
        },
        entries: await repo.documentSnapshotFor(app.db, item.entries),
        // The player must never receive the answer key, preview included.
        questions: item.questions.map((q) => ({
          id: q.id!,
          documentId: q.documentId,
          stepKey: q.stepKey,
          stem: q.stem,
          kind: q.kind,
          explanation: q.explanation,
          options: q.options.map((o) => ({ id: o.id, text: o.text })),
        })),
      };
    },
  );
}
