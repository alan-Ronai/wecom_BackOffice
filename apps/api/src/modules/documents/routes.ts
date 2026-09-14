import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ModelClient } from '@wecom/model';
import { z } from 'zod';
import {
  CreateDocumentBodySchema,
  DeleteResponseSchema,
  DiffQuerySchema,
  DiffResponseSchema,
  DocumentSchema,
  LinksResponseSchema,
  RelatedResponseSchema,
  IdSchema,
  LinkTypeSchema,
  ListDocumentsQuerySchema,
  ListDocumentsResponseSchema,
  PatchDocumentBodySchema,
  PublishBodySchema,
  PublishResponseSchema,
  SetStatusBodySchema,
  SourceReviewClearBodySchema,
  StructureBodySchema,
  VersionListSchema,
  makeEvent,
} from '@wecom/shared';
import { withTransaction } from '../../lib/sql.js';
import { audit } from '../../lib/audit.js';
import { forbidden, httpError, notFound } from '../../lib/http.js';
import { hasScope, requireUser } from '../../lib/user.js';
import { canReadUnpublished } from '../../lib/visibility.js';
import * as repo from './repo.js';
import { annotateBlame, diffDocuments, diffStats } from './diff.js';
import { inboundFor } from '../graph/repo.js';
import { clearSourceReview } from './sourceReview.js';
import { updateEmbedding } from '../search/repo.js';
import { resolveFeedback } from '../feedback/repo.js'; // W3: close reports with the published version
import { applyChangeFlag } from '../learning/tracking/refresh.js'; // V2: knowledge refresh on publish

const Params = z.object({ id: IdSchema });

/**
 * `body.worlds` and `body.topics` are full replacements, not additions: `syncMemberships`
 * deletes every `document_worlds` row outside `{category} ∪ worlds`, and every
 * `document_topics` row outside `topics`. Checking only the memberships being *added*
 * therefore let an editor scoped to one world send `worlds: []` and strip a document out of a
 * world they cannot see — that team loses it from their list, topic view, search and graph.
 *
 * The check is on the **difference**, in both directions, and never on a membership the write
 * leaves alone. Requiring scope on every world in the resulting set instead would be
 * over-restriction, and a worse bug than the one it fixes: a `sim`-scoped editor patching only
 * `topics` on a `{billing(primary), sim}` document would be refused for a world they are not
 * touching, even though `config.scope: 'document'` and the caller's `hasScope(user,
 * before.worlds)` intersection have already established that they may edit this document.
 *
 * `body.topics` was not checked at all before. Beyond the add/remove scope rule, every topic
 * the caller *names* must live in the document's resulting world set — a topic in a third
 * world would pull the item onto a topic page nobody expected it on. That is a 400 about the
 * request rather than a permission, so it is checked over all named topics and answered first.
 */
async function assertTaxonomyScope(
  tx: Parameters<typeof audit>[0],
  user: ReturnType<typeof requireUser>,
  before: { category: string; worlds: string[]; topics: string[] },
  body: { category?: string; worlds?: string[]; topics?: string[] },
): Promise<void> {
  if (body.category === undefined && body.worlds === undefined && body.topics === undefined) return;
  const primary = body.category ?? before.category;
  const resulting = new Set([primary, ...(body.worlds ?? before.worlds)]);
  /** Only what this write actually changes; a retained membership is not the caller's to justify. */
  const changed = <T>(a: Iterable<T>, b: ReadonlySet<T>) => [...a].filter((x) => !b.has(x));
  const beforeWorlds = new Set(before.worlds);
  for (const w of [...changed(resulting, beforeWorlds), ...changed(before.worlds, resulting)])
    if (!hasScope(user, w)) throw forbidden();

  if (body.topics === undefined) return;
  const named = body.topics;
  const beforeTopics = new Set(before.topics);
  const resultingTopics = new Set(named);
  const touched = [...changed(named, beforeTopics), ...changed(before.topics, resultingTopics)];
  if (!named.length && !touched.length) return;
  const worldOf = new Map(
    (
      await tx.query<{ id: string; world_slug: string }>(
        'select t.id, w.slug world_slug from topics t join worlds w on w.id = t.world_id where t.id = any($1::uuid[])',
        [[...new Set([...named, ...touched])]],
      )
    ).rows.map((x) => [x.id, x.world_slug]),
  );
  for (const t of named) {
    const world = worldOf.get(t);
    if (!world) throw httpError(400, 'UNKNOWN_TOPIC', 'הנושא אינו קיים', { topicId: t });
    if (!resulting.has(world))
      throw httpError(400, 'TOPIC_OUT_OF_WORLD', 'הנושא שייך לעולם תוכן שהפריט אינו נמצא בו', {
        topicId: t,
        worldSlug: world,
      });
  }
  // A topic being added or removed is a membership change, so it takes the same scope rule as a
  // world; a topic the write keeps is left alone, for the same reason a retained world is.
  for (const t of touched) {
    const world = worldOf.get(t);
    if (world && !hasScope(user, world)) throw forbidden();
  }
}

/** Stage 4 `/documents/:id/backlinks`; the contract spells this response inline. */
const BacklinksResponseSchema = z.object({
  items: z.array(
    z.object({
      documentId: IdSchema,
      title: z.string(),
      stepKey: z.string().nullable(),
      type: LinkTypeSchema,
    }),
  ),
});
const VersionParams = z.object({ id: IdSchema, v: z.coerce.number().int().min(0) });
/** Optional optimistic-concurrency precondition on `PUT /documents/:id/structure`. */
const IfMatchHeaders = z.object({ 'if-match': z.string().optional() });

/**
 * Closes the KB -> remote half of the two-way sync (L6's `pushOnPublish`). Called
 * *after* the publish transaction commits, so a WordPress outage can never roll
 * back a local publish: a failure is logged and emitted as `job.failed` instead of
 * failing the response. Links in `conflict` are skipped by `pushOnPublish` itself.
 */
async function pushOnPublish(
  app: FastifyInstance,
  req: FastifyRequest,
  documentId: string,
  actorId: string,
): Promise<void> {
  const sync = app.connectors?.sync;
  if (!sync) return;
  try {
    const refs = await sync.pushOnPublish(documentId, actorId);
    if (refs.length) req.log.info({ documentId, pushed: refs.length }, 'push-on-publish');
  } catch (err) {
    req.log.error({ err, documentId }, 'push-on-publish failed');
    await withTransaction(app.db, (tx) =>
      app.events.publish(
        tx,
        makeEvent('job.failed', {
          jobName: 'sync.pushOnPublish',
          jobId: documentId,
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
    );
  }
}

export default async function routes(app: FastifyInstance) {
  app.get(
    '/documents',
    {
      config: { requires: ['docs.read'] },
      schema: {
        tags: ['documents'],
        querystring: ListDocumentsQuerySchema,
        response: { 200: ListDocumentsResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const q = req.query as z.infer<typeof ListDocumentsQuerySchema>;
      const { items, total } = await repo.listCards(
        app.db,
        q,
        user.id,
        user.worldScopes,
        canReadUnpublished(user),
      );
      return { items, total, page: q.page, pageSize: q.pageSize };
    },
  );

  app.get(
    '/documents/:id',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['documents'], params: Params, response: { 200: DocumentSchema } },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const doc = await repo.getVisibleDocument(app.db, (req.params as { id: string }).id, user);
      if (!doc) throw notFound('המסמך');
      reply.header('etag', doc.etag!);
      return doc;
    },
  );

  app.post(
    '/documents',
    {
      config: { requires: ['docs.create'] },
      schema: { tags: ['documents'], body: CreateDocumentBodySchema, response: { 201: DocumentSchema } },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const body = req.body as z.infer<typeof CreateDocumentBodySchema>;
      const doc = await withTransaction(app.db, async (tx) => {
        // A create has no prior memberships, so every world and topic in the body is an addition.
        await assertTaxonomyScope(tx, user, { category: body.category, worlds: [], topics: [] }, body);
        const d = await repo.insertDocument(tx, body, user.id);
        await audit(tx, {
          actorId: user.id,
          action: 'docs.create',
          entityType: 'document',
          entityId: d.id,
          before: null,
          after: { title: d.title, category: d.category },
          requestId: req.id,
          ip: req.ip,
        });
        return d;
      });
      reply.code(201);
      return doc;
    },
  );

  app.patch(
    '/documents/:id',
    {
      config: { requires: ['docs.edit'], scope: 'document' },
      schema: {
        tags: ['documents'],
        params: Params,
        body: PatchDocumentBodySchema,
        response: { 200: DocumentSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof PatchDocumentBodySchema>;
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getDocument(tx, id);
        if (!before) throw notFound('המסמך');
        if (!hasScope(user, before.worlds)) throw forbidden();
        await assertTaxonomyScope(tx, user, before, body);
        const after = await repo.patchDocument(
          tx,
          id,
          body,
          user.id,
          req.headers['if-match'] as string | undefined,
        );
        await audit(tx, {
          actorId: user.id,
          action: 'docs.edit',
          entityType: 'document',
          entityId: id,
          // `worlds`/`topics` are in the payload because a membership change is otherwise
          // invisible in the audit — a document silently leaving a team's world left no trace.
          before: {
            title: before.title,
            wave: before.wave,
            category: before.category,
            docType: before.docType,
            tags: before.tags,
            worlds: before.worlds,
            topics: before.topics,
          },
          after: {
            title: after.title,
            wave: after.wave,
            category: after.category,
            docType: after.docType,
            tags: after.tags,
            worlds: after.worlds,
            topics: after.topics,
          },
          requestId: req.id,
          ip: req.ip,
        });
        return after;
      });
    },
  );

  app.put(
    '/documents/:id/structure',
    {
      config: { requires: ['docs.edit'], scope: 'document' },
      schema: {
        tags: ['documents'],
        params: Params,
        // Optimistic concurrency: the handler compares this against the stored etag, so it has
        // to be part of the published contract for clients to be able to send it.
        headers: IfMatchHeaders,
        body: StructureBodySchema,
        response: { 200: DocumentSchema },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      // The etag exists precisely so a structure save cannot silently clobber a
      // concurrent editor; making it optional made that guarantee opt-in.
      const ifMatch = req.headers['if-match'] as string | undefined;
      if (!ifMatch) throw httpError(428, 'IF_MATCH_REQUIRED', 'נדרשת כותרת If-Match עם ה-etag של המסמך');
      const countSteps = (d: { phases: { steps: unknown[] }[] }) =>
        d.phases.reduce((a, p) => a + p.steps.length, 0);
      const doc = await withTransaction(app.db, async (tx) => {
        const before = await repo.getDocument(tx, id);
        if (!before) throw notFound('המסמך');
        if (!hasScope(user, before.worlds)) throw forbidden();
        const after = await repo.saveStructure(
          tx,
          id,
          req.body as z.infer<typeof StructureBodySchema>,
          user.id,
          ifMatch,
        );
        await audit(tx, {
          actorId: user.id,
          action: 'docs.edit',
          entityType: 'document',
          entityId: id,
          before: { steps: countSteps(before) },
          after: { steps: countSteps(after) },
          requestId: req.id,
          ip: req.ip,
        });
        await app.events.publish(
          tx,
          makeEvent('document.updated', { documentId: id, actorId: user.id, etag: after.etag }),
        );
        return after;
      });
      reply.header('etag', doc.etag!);
      return doc;
    },
  );

  app.post(
    '/documents/:id/publish',
    {
      config: { requires: ['docs.publish'], scope: 'document' },
      schema: {
        tags: ['documents'],
        params: Params,
        body: PublishBodySchema,
        response: { 200: PublishResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof PublishBodySchema>;
      const result = await withTransaction(app.db, async (tx) => {
        const before = await repo.getDocument(tx, id);
        if (!before) throw notFound('המסמך');
        if (!hasScope(user, before.worlds)) throw forbidden();
        const { doc, version } = await repo.publishDocument(tx, id, {
          actorId: user.id,
          label: body.label,
          markPartial: body.markPartial,
        });
        // V2: knowledge refresh — record the change flag; a significant change fans out refresh assignments.
        const changeFlag = await applyChangeFlag(tx, { notifier: app.notifier, events: app.events }, {
          documentId: id, version, after: doc, override: body.significantChange, actorId: user.id,
        });
        if (body.resolveFeedbackIds?.length) {
          const closed = await resolveFeedback(tx, body.resolveFeedbackIds, id, version, user.id);
          for (const fid of closed)
            await app.events.publish(
              tx,
              makeEvent('feedback.updated', { feedbackId: fid, documentId: id, status: 'done' }),
            );
        }
        const auditId = await audit(tx, {
          actorId: user.id,
          action: 'docs.publish',
          entityType: 'document',
          entityId: id,
          before: { version: before.currentVersion, status: before.status },
          after: { version, status: doc.status },
          requestId: req.id,
          ip: req.ip,
        });
        await app.events.publish(
          tx,
          makeEvent('document.published', { documentId: id, version, actorId: user.id }),
        );
        return { document: doc, version, auditId, changeFlag };
      });
      await pushOnPublish(app, req, id, user.id);
      // Best-effort, outside the transaction: a model outage must never fail a publish.
      const model = (app as unknown as { model?: ModelClient | null }).model;
      if (model?.embed)
        updateEmbedding(app.db, id, model).catch((err) =>
          req.log.warn({ err, id }, 'embed on publish failed'),
        );
      return result;
    },
  );

  app.post(
    '/documents/:id/status',
    {
      config: { requires: ['docs.publish'], scope: 'document' },
      schema: {
        tags: ['documents'],
        params: Params,
        body: SetStatusBodySchema,
        response: { 200: DocumentSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof SetStatusBodySchema>;
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getDocument(tx, id);
        if (!before) throw notFound('המסמך');
        if (!hasScope(user, before.worlds)) throw forbidden();
        const after = await repo.setStatus(tx, id, body.status, user.id);
        await audit(tx, {
          actorId: user.id,
          action: 'docs.status',
          entityType: 'document',
          entityId: id,
          before: { status: before.status },
          after: { status: after.status, reason: body.reason },
          requestId: req.id,
          ip: req.ip,
        });
        await app.events.publish(
          tx,
          makeEvent('document.updated', { documentId: id, actorId: user.id, etag: after.etag }),
        );
        return after;
      });
    },
  );

  app.post(
    '/documents/:id/source-review/clear',
    {
      config: { requires: ['docs.edit'], scope: 'document' },
      schema: {
        tags: ['documents'],
        params: Params,
        body: SourceReviewClearBodySchema,
        response: { 200: DocumentSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const { note } = req.body as z.infer<typeof SourceReviewClearBodySchema>;
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getDocument(tx, id);
        if (!before) throw notFound('המסמך');
        if (!hasScope(user, before.worlds)) throw forbidden();
        await clearSourceReview(tx, id);
        await audit(tx, {
          actorId: user.id,
          action: 'docs.source_review_cleared',
          entityType: 'document',
          entityId: id,
          before: { reason: before.sourceReviewReason ?? null },
          after: { note },
          requestId: req.id,
          ip: req.ip,
        });
        const after = (await repo.getDocument(tx, id))!;
        await app.events.publish(
          tx,
          makeEvent('document.updated', { documentId: id, actorId: user.id, etag: after.etag }),
        );
        return after;
      });
    },
  );

  app.get(
    '/documents/:id/versions',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['documents'], params: Params, response: { 200: VersionListSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      if (!(await repo.getVisibleDocument(app.db, id, user))) throw notFound('המסמך');
      return { items: await repo.listVersions(app.db, id) };
    },
  );

  app.get(
    '/documents/:id/versions/:v',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['documents'], params: VersionParams, response: { 200: DocumentSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const { id, v } = req.params as { id: string; v: number };
      if (!(await repo.getVisibleDocument(app.db, id, user))) throw notFound('המסמך');
      const doc = await repo.getVersion(app.db, id, v);
      if (!doc) throw notFound('הגרסה');
      return doc;
    },
  );

  app.get(
    '/documents/:id/diff',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: {
        tags: ['documents'],
        params: Params,
        querystring: DiffQuerySchema,
        response: { 200: DiffResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const { from, to } = req.query as z.infer<typeof DiffQuerySchema>;
      const current = await repo.getVisibleDocument(app.db, id, user);
      if (!current) throw notFound('המסמך');
      const oldDoc = await repo.getVersion(app.db, id, from);
      if (!oldDoc) throw notFound('הגרסה');
      const toVersion = to ?? current.currentVersion;
      const newDoc = to === undefined ? current : await repo.getVersion(app.db, id, to);
      if (!newDoc) throw notFound('הגרסה');
      const blocks = await repo.loadBlocksMap(app.db);
      const rows = diffDocuments(oldDoc, newDoc, blocks);
      // Blame: the first version between `from` and `to` in which each row's step changed.
      const versions = await repo.listVersions(app.db, id);
      const inRange = versions.filter((v) => v.version >= from && v.version <= toVersion);
      // One query for every snapshot in range instead of `getVersion` per version.
      const need = inRange.filter((v) => v.version !== from).map((v) => v.version);
      const snapshots = await repo.getVersionsBatch(app.db, id, need);
      const history: { version: number; author: string; doc: typeof current }[] = [];
      for (const v of inRange) {
        const doc = v.version === from ? oldDoc : snapshots.get(v.version);
        if (doc) history.push({ version: v.version, author: v.authorName, doc });
      }
      annotateBlame(rows, history, blocks);
      return { from, to: toVersion, rows, stats: diffStats(rows) };
    },
  );

  app.post(
    '/documents/:id/restore/:v',
    {
      config: { requires: ['docs.restore'], scope: 'document' },
      schema: { tags: ['documents'], params: VersionParams, response: { 200: PublishResponseSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const { id, v } = req.params as { id: string; v: number };
      const result = await withTransaction(app.db, async (tx) => {
        const before = await repo.getDocument(tx, id);
        if (!before) throw notFound('המסמך');
        if (!hasScope(user, before.worlds)) throw forbidden();
        const { doc, version } = await repo.restoreVersion(tx, id, v, user.id);
        const auditId = await audit(tx, {
          actorId: user.id,
          action: 'docs.restore',
          entityType: 'document',
          entityId: id,
          before: { version: before.currentVersion },
          after: { version, restoredFrom: v },
          requestId: req.id,
          ip: req.ip,
        });
        await app.events.publish(
          tx,
          makeEvent('document.published', { documentId: id, version, actorId: user.id }),
        );
        return { document: doc, version, auditId };
      });
      await pushOnPublish(app, req, id, user.id);
      const model = (app as unknown as { model?: ModelClient | null }).model;
      if (model?.embed)
        updateEmbedding(app.db, id, model).catch((err) =>
          req.log.warn({ err, id }, 'embed on restore failed'),
        );
      return result;
    },
  );

  app.delete(
    '/documents/:id',
    {
      config: { requires: ['docs.delete'], scope: 'document' },
      schema: { tags: ['documents'], params: Params, response: { 200: DeleteResponseSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getDocument(tx, id);
        if (!before) throw notFound('המסמך');
        if (!hasScope(user, before.worlds)) throw forbidden();
        if (await repo.hasPublishedVersion(tx, id))
          throw httpError(
            409,
            'ONCE_PUBLISHED',
            'פריט שפורסם בעבר אינו נמחק; העבר אותו ל"לא בתוקף" או לארכיון',
            { allowed: ['invalid', 'archived'] },
          );
        await repo.softDelete(tx, id, user.id);
        const restoreUntil = new Date(Date.now() + app.config.TRASH_DAYS * 86400_000).toISOString();
        const auditId = await audit(tx, {
          actorId: user.id,
          action: 'docs.delete',
          entityType: 'document',
          entityId: id,
          before: { title: before.title, status: before.status },
          after: null,
          requestId: req.id,
          ip: req.ip,
        });
        await app.events.publish(
          tx,
          makeEvent('document.deleted', {
            documentId: id,
            actorId: user.id,
            restoredUntil: restoreUntil,
          }),
        );
        return { auditId, restoreUntil };
      });
    },
  );

  app.post(
    '/documents/:id/pin',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['documents'], params: Params },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      if (!(await repo.getVisibleDocument(app.db, id, user))) throw notFound('המסמך');
      await repo.setPin(app.db, user.id, id, true);
      reply.code(204);
      return null;
    },
  );

  app.delete(
    '/documents/:id/pin',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['documents'], params: Params },
    },
    async (req, reply) => {
      const user = requireUser(req);
      await repo.setPin(app.db, user.id, (req.params as { id: string }).id, false);
      reply.code(204);
      return null;
    },
  );

  app.post(
    '/documents/:id/view',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['documents'], params: Params },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      if (!(await repo.getVisibleDocument(app.db, id, user))) throw notFound('המסמך');
      await repo.recordView(app.db, user.id, id);
      reply.code(204);
      return null;
    },
  );

  app.get(
    '/documents/:id/links',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['documents'], params: Params, response: { 200: LinksResponseSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      if (!(await repo.getVisibleDocument(app.db, id, user))) throw notFound('המסמך');
      return repo.linksFor(app.db, id, canReadUnpublished(user));
    },
  );

  app.get(
    '/documents/:id/related',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['documents'], params: Params, response: { 200: RelatedResponseSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const doc = await repo.getVisibleDocument(app.db, (req.params as { id: string }).id, user);
      if (!doc) throw notFound('המסמך');
      return { items: await repo.relatedFor(app.db, doc, canReadUnpublished(user)) };
    },
  );

  // Stage 4 (connected data): the inbound half of `/documents/:id/links`, shaped like the
  // graph's impact rows so the UI can render "what points at this card" the same way.
  app.get(
    '/documents/:id/backlinks',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['documents'], params: Params, response: { 200: BacklinksResponseSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      if (!(await repo.getVisibleDocument(app.db, id, user))) throw notFound('המסמך');
      // `config.scope` above gates the *subject* document; the inbound titles are other
      // documents, so they carry the caller's world scope — and, for a reader, the
      // published-only visibility rule (W2) — of their own.
      return {
        items: await inboundFor(
          app.db,
          { kind: 'document', key: id },
          user.worldScopes,
          canReadUnpublished(user),
        ),
      };
    },
  );
}
