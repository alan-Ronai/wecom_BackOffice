import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  IdSchema,
  ReorderBodySchema,
  TagsQuerySchema,
  TagsResponseSchema,
  TopicBodySchema,
  TopicPatchSchema,
  TopicSchema,
  TopicsResponseSchema,
  TopicViewSchema,
  WorldBodySchema,
  WorldPatchSchema,
  WorldSchema,
  WorldSlugSchema,
  WorldsQuerySchema,
  WorldsResponseSchema,
  makeEvent,
} from '@wecom/shared';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { withTransaction } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import * as repo from './repo.js';

const SlugParams = z.object({ slug: WorldSlugSchema });
const IdParams = z.object({ id: IdSchema });
const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);

export default async function routes(app: FastifyInstance) {
  const changed = (tx: Parameters<typeof audit>[0], entity: 'world' | 'topic', id: string) =>
    app.events.publish(tx, makeEvent('taxonomy.changed', { entity, id }));
  const log =
    (req: { user: { id: string } | null; id: string; ip: string }) =>
    (
      tx: Parameters<typeof audit>[0],
      action: string,
      entityType: string,
      entityId: string,
      before: unknown,
      after: unknown,
    ) =>
      audit(tx, {
        actorId: req.user?.id ?? null,
        action,
        entityType,
        entityId,
        before,
        after,
        requestId: req.id,
        ip: req.ip,
      });

  app.get(
    '/worlds',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['taxonomy'], querystring: WorldsQuerySchema, response: { 200: WorldsResponseSchema } },
    },
    async (req) => {
      requireUser(req);
      const { includeInactive } = req.query as z.infer<typeof WorldsQuerySchema>;
      return { items: await repo.listWorlds(app.db, includeInactive === true) };
    },
  );

  app.post(
    '/worlds',
    {
      config: { requires: ['taxonomy.manage'] },
      schema: { tags: ['taxonomy'], body: WorldBodySchema, response: { 201: WorldSchema } },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const w = await withTransaction(app.db, async (tx) => {
        const created = await repo.createWorld(tx, req.body as z.infer<typeof WorldBodySchema>, user.id);
        await log(req)(tx, 'taxonomy.world.create', 'world', created.id, null, {
          slug: created.slug,
          name: created.name,
        });
        await changed(tx, 'world', created.id);
        return created;
      });
      reply.code(201);
      return w;
    },
  );

  app.put(
    '/worlds/reorder',
    {
      config: { requires: ['taxonomy.manage'] },
      schema: { tags: ['taxonomy'], body: ReorderBodySchema, response: { 200: WorldsResponseSchema } },
    },
    async (req) => {
      requireUser(req);
      const { ids } = req.body as z.infer<typeof ReorderBodySchema>;
      return withTransaction(app.db, async (tx) => {
        const items = await repo.reorderWorlds(tx, ids);
        await log(req)(tx, 'taxonomy.world.reorder', 'world', ids[0]!, null, { ids });
        await changed(tx, 'world', ids[0]!);
        return { items };
      });
    },
  );

  app.patch(
    '/worlds/:slug',
    {
      config: { requires: ['taxonomy.manage'] },
      schema: {
        tags: ['taxonomy'],
        params: SlugParams,
        body: WorldPatchSchema,
        response: { 200: WorldSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { slug } = req.params as z.infer<typeof SlugParams>;
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getWorld(tx, slug);
        const after = await repo.patchWorld(tx, slug, req.body as z.infer<typeof WorldPatchSchema>, user.id);
        await log(req)(tx, 'taxonomy.world.edit', 'world', after.id, before, after);
        await changed(tx, 'world', after.id);
        return after;
      });
    },
  );

  app.delete(
    '/worlds/:slug',
    {
      config: { requires: ['taxonomy.manage'] },
      schema: {
        tags: ['taxonomy'],
        params: SlugParams,
        querystring: z.object({ force: bool.optional() }),
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { slug } = req.params as z.infer<typeof SlugParams>;
      const force = (req.query as { force?: boolean }).force === true;
      await withTransaction(app.db, async (tx) => {
        const w = await repo.deactivateWorld(tx, slug, force, user.id);
        await log(req)(tx, 'taxonomy.world.deactivate', 'world', w.id, { active: true }, {
          active: false,
          force,
        });
        await changed(tx, 'world', w.id);
      });
      reply.code(204);
      return null;
    },
  );

  app.get(
    '/worlds/:slug/topics',
    {
      config: { requires: ['docs.read'] },
      schema: {
        tags: ['taxonomy'],
        params: SlugParams,
        querystring: z.object({ includeInactive: bool.optional() }),
        response: { 200: TopicsResponseSchema },
      },
    },
    async (req) => {
      requireUser(req);
      const { slug } = req.params as z.infer<typeof SlugParams>;
      const inactive = (req.query as { includeInactive?: boolean }).includeInactive === true;
      return { items: await repo.listTopics(app.db, slug, inactive) };
    },
  );

  app.post(
    '/worlds/:slug/topics',
    {
      config: { requires: ['taxonomy.manage'] },
      schema: {
        tags: ['taxonomy'],
        params: SlugParams,
        body: TopicBodySchema,
        response: { 201: TopicSchema },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { slug } = req.params as z.infer<typeof SlugParams>;
      const t = await withTransaction(app.db, async (tx) => {
        const created = await repo.createTopic(
          tx,
          slug,
          req.body as z.infer<typeof TopicBodySchema>,
          user.id,
        );
        await log(req)(tx, 'taxonomy.topic.create', 'topic', created.id, null, {
          worldSlug: slug,
          slug: created.slug,
          name: created.name,
        });
        await changed(tx, 'topic', created.id);
        return created;
      });
      reply.code(201);
      return t;
    },
  );

  app.put(
    '/worlds/:slug/topics/reorder',
    {
      config: { requires: ['taxonomy.manage'] },
      schema: {
        tags: ['taxonomy'],
        params: SlugParams,
        body: ReorderBodySchema,
        response: { 200: TopicsResponseSchema },
      },
    },
    async (req) => {
      requireUser(req);
      const { slug } = req.params as z.infer<typeof SlugParams>;
      const { ids } = req.body as z.infer<typeof ReorderBodySchema>;
      return withTransaction(app.db, async (tx) => {
        const items = await repo.reorderTopics(tx, slug, ids);
        await log(req)(tx, 'taxonomy.topic.reorder', 'topic', ids[0]!, null, { worldSlug: slug, ids });
        await changed(tx, 'topic', ids[0]!);
        return { items };
      });
    },
  );

  app.patch(
    '/topics/:id',
    {
      config: { requires: ['taxonomy.manage'] },
      schema: {
        tags: ['taxonomy'],
        params: IdParams,
        body: TopicPatchSchema,
        response: { 200: TopicSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as z.infer<typeof IdParams>;
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getTopic(tx, id);
        const after = await repo.patchTopic(tx, id, req.body as z.infer<typeof TopicPatchSchema>, user.id);
        await log(req)(tx, 'taxonomy.topic.edit', 'topic', id, before, after);
        await changed(tx, 'topic', id);
        return after;
      });
    },
  );

  app.delete(
    '/topics/:id',
    { config: { requires: ['taxonomy.manage'] }, schema: { tags: ['taxonomy'], params: IdParams } },
    async (req, reply) => {
      const user = requireUser(req);
      const { id } = req.params as z.infer<typeof IdParams>;
      await withTransaction(app.db, async (tx) => {
        await repo.deactivateTopic(tx, id, user.id);
        await log(req)(tx, 'taxonomy.topic.deactivate', 'topic', id, { active: true }, { active: false });
        await changed(tx, 'topic', id);
      });
      reply.code(204);
      return null;
    },
  );

  app.get(
    '/topics/:id/items',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['taxonomy'], params: IdParams, response: { 200: TopicViewSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as z.infer<typeof IdParams>;
      const view = await repo.topicView(app.db, id, {
        unpublished: user.permissions.has('docs.read_unpublished'),
        worldScopes: user.worldScopes,
      });
      if (!view) throw notFound('הנושא');
      // W5 records topic views; W0's default is a no-op. Never let usage failures break the page.
      void app.usage
        .recordTopicView(user.id, id)
        .catch((e: unknown) => app.log.warn({ err: e }, 'recordTopicView failed'));
      return view;
    },
  );

  app.get(
    '/tags',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['taxonomy'], querystring: TagsQuerySchema, response: { 200: TagsResponseSchema } },
    },
    async (req) => {
      requireUser(req);
      return { items: await repo.listTags(app.db, req.query as z.infer<typeof TagsQuerySchema>) };
    },
  );
}
