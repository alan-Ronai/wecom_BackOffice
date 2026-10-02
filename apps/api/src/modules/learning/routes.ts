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
import { withTransaction, type Tx } from '../../lib/sql.js';
import { hasAllScopes, hasScope, requireUser } from '../../lib/user.js';
import { getDocument } from '../documents/repo.js';
import * as repo from './repo.js';
import { generateQuestions } from './generate.js';
import { invalidateForArchivedItem } from './tracking/repo.js'; // A-I4: archiving withdraws the obligation

const Params = z.object({ id: IdSchema });
const NOT_FOUND = 'פריט הלמידה';

export default async function learningRoutes(app: FastifyInstance) {
  /**
   * The item's head (row + worlds, not the assembled item — A-M8), or a 404 for anyone who may
   * not see it. Handlers that need entries, questions or source versions load them themselves.
   */
  const visible = async (id: string, user: ReturnType<typeof requireUser>) => {
    const head = await repo.canSeeById(app.db, id, repo.viewerOf(user));
    if (!head) throw notFound(NOT_FOUND);
    return head;
  };
  /**
   * Wave Y (A-M6): a world-scoped manager may only change an item whose *every* world they hold —
   * a briefing citing one `billing` and four `tech` documents is readable by a `billing` manager
   * and writable by nobody short of `billing` + `tech`. An item with no world is everybody's.
   */
  const assertScope = (head: repo.ItemHead, user: ReturnType<typeof requireUser>) => {
    if (head.worlds.length && !hasAllScopes(user, head.worlds)) throw forbidden();
  };
  const loadItem = async (id: string) => {
    const item = await repo.getItem(app.db, id);
    if (!item) throw notFound(NOT_FOUND);
    return item;
  };
  /**
   * A-I5: the documents a generate call may read.
   *
   * `generateQuestions` checks only that each id is published, so a `billing`-scoped manager
   * could pass any published `tech` document id and get its step titles, action texts, outcome
   * texts, branch labels and CRM field names back rendered as question stems and options — a
   * content read `GET /documents/:id` would refuse them. 404, not 403, for the same reason the
   * document routes do it: a 403 would confirm the document exists.
   *
   * Wave Y: the entries and questions PUTs run it too — a saved reference is served back in the
   * item (and in its preview), so citing a document is reading it.
   */
  const assertDocumentsInScope = async (ids: string[], user: ReturnType<typeof requireUser>) => {
    if (user.worldScopes === null) return;
    for (const id of new Set(ids)) {
      const doc = await getDocument(app.db, id);
      if (!doc || !hasScope(user, doc.worlds)) throw notFound('המסמך');
    }
  };
  /**
   * Wave Y (review of A-M6): the write rule, applied to the item *as the write leaves it*.
   *
   * An item with no world of its own spans the worlds of the documents it cites (`worldsOfItem`),
   * so replacing its entries or questions — or clearing its `worldSlug` — can move it into worlds
   * the caller does not hold: a `billing` manager creating a world-less briefing and citing `tech`
   * documents would end up owning a `tech` briefing. `assertScope` only looks at the item before
   * the write, so this runs inside the transaction after it and the 403 rolls the write back.
   */
  const assertWritableAfter = async (tx: Tx, id: string, user: ReturnType<typeof requireUser>) => {
    if (user.worldScopes === null) return;
    const worlds = await repo.worldsOfItem(tx, id);
    if (worlds.length && !hasAllScopes(user, worlds))
      throw httpError(403, 'SCOPE_DENIED', 'ההרשאה שלך מוגבלת לעולמות תוכן אחרים');
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
      if (body.worldSlug && !hasAllScopes(user, body.worldSlug)) throw forbidden();
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
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as z.infer<typeof Params>;
      await visible(id, user);
      const item = await loadItem(id);
      // A-C1: a non-manager reads the authoring view through the player projection — no answer
      // key, no explanation, no model provenance. Managers see the item they are building.
      return repo.viewerOf(user).manage ? item : repo.projectForLearner(item);
    },
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
      assertScope(before, user);
      if (body.worldSlug && !hasAllScopes(user, body.worldSlug)) throw forbidden();
      return withTransaction(app.db, async (tx) => {
        const after = await repo.patchItem(tx, id, body, user.id);
        // `worldSlug: null` hands the item to its cited documents' worlds.
        if (body.worldSlug !== undefined) await assertWritableAfter(tx, id, user);
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
      assertScope(item, user);
      // A published item has learners against its snapshot, so it is archived rather than
      // deleted; a draft nobody ever saw is soft-deleted; an archived item is already there.
      if (item.status !== 'archived')
        await withTransaction(app.db, async (tx) => {
          const archive = item.status === 'published';
          if (archive) await repo.archiveItem(tx, id, user.id);
          else await repo.softDeleteItem(tx, id, user.id);
          /**
           * A-I4: and the open assignments go with it. Archiving used to leave them `open`, so
           * learners kept owing an item that no longer exists for anyone else and the reminder
           * job kept nagging them about it. Completed rows are history and stay.
           */
          const withdrawn = await invalidateForArchivedItem(
            tx,
            id,
            archive ? 'פריט הלמידה הועבר לארכיון' : 'פריט הלמידה נמחק',
          );
          await audit(tx, {
            actorId: user.id,
            action: archive ? 'learning.archive' : 'learning.delete',
            entityType: 'learning_item',
            entityId: id,
            before: { status: item.status },
            after: { status: archive ? 'archived' : 'deleted', withdrawnAssignments: withdrawn },
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
      assertScope(item, user);
      if (item.kind !== 'briefing') throw httpError(400, 'WRONG_KIND', 'הפעולה מתאימה לתדריך בלבד');
      if (item.status === 'archived') throw httpError(409, 'ITEM_ARCHIVED', 'פריט בארכיון אינו ניתן לעריכה');
      await assertDocumentsInScope(
        body.entries.map((x) => x.documentId),
        user,
      );
      return withTransaction(app.db, async (tx) => {
        const after = await repo.replaceEntries(tx, id, body.entries, user.id);
        await assertWritableAfter(tx, id, user);
        await audit(tx, {
          actorId: user.id,
          action: 'learning.entries',
          entityType: 'learning_item',
          entityId: id,
          before: { count: item.entryCount },
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
      assertScope(item, user);
      if (item.kind !== 'quiz') throw httpError(400, 'WRONG_KIND', 'הפעולה מתאימה לבוחן בלבד');
      if (item.status === 'archived') throw httpError(409, 'ITEM_ARCHIVED', 'פריט בארכיון אינו ניתן לעריכה');
      await assertDocumentsInScope(
        body.questions.map((x) => x.documentId),
        user,
      );
      return withTransaction(app.db, async (tx) => {
        const after = await repo.replaceQuestions(tx, id, body.questions, user.id);
        await assertWritableAfter(tx, id, user);
        await audit(tx, {
          actorId: user.id,
          action: 'learning.questions',
          entityType: 'learning_item',
          entityId: id,
          before: { count: item.questionCount },
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
      assertScope(item, user);
      if (item.kind !== 'quiz') throw httpError(400, 'WRONG_KIND', 'הפעולה מתאימה לבוחן בלבד');
      await assertDocumentsInScope(body.documentIds, user);
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
      assertScope(await visible(id, user), user);
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
      await visible(id, user);
      // A manager previews what they are building; everyone else previews the published
      // snapshot, which is exactly what a learner would be served.
      const viewer = repo.viewerOf(user);
      let item: Awaited<ReturnType<typeof loadItem>>;
      if (viewer.manage) item = await loadItem(id);
      else {
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
