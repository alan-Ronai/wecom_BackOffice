import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { IdSchema, SavedViewBodySchema, SavedViewSchema } from '@wecom/shared';
import { audit } from '../../lib/audit.js';
import { forbidden, notFound } from '../../lib/http.js';
import { withTransaction, type Queryable } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import { iso } from './repo.js';

type SavedView = z.infer<typeof SavedViewSchema>;

const SELECT = `select v.*, u.display_name as owner_name from saved_views v join users u on u.id = v.owner_id`;

const toApi = (r: Record<string, unknown>): SavedView => ({
  id: r.id as string,
  name: r.name as string,
  query: (r.query as Record<string, unknown>) ?? {},
  shared: !!r.shared,
  ownerId: r.owner_id as string,
  ownerName: r.owner_name as string,
  createdAt: iso(r.created_at as Date)!,
});

const load = async (q: Queryable, id: string): Promise<SavedView | null> => {
  const r = await q.query(`${SELECT} where v.id = $1`, [id]);
  return r.rowCount ? toApi(r.rows[0]) : null;
};

export default async function viewRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const Params = z.object({ id: IdSchema });

  app.get(
    '/views',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['collab'], response: { 200: z.object({ items: z.array(SavedViewSchema) }) } },
    },
    async (req) => {
      const user = requireUser(req);
      // Your own views plus everything anyone chose to share — a shared view is the
      // cheapest way a lead hands a saved filter to the whole floor.
      const r = await app.db.query(`${SELECT} where v.owner_id = $1 or v.shared order by v.shared, v.name`, [
        user.id,
      ]);
      return { items: r.rows.map(toApi) };
    },
  );

  app.post(
    '/views',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['collab'], body: SavedViewBodySchema, response: { 201: SavedViewSchema } },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const created = await withTransaction(app.db, async (tx) => {
        const r = await tx.query<{ id: string }>(
          `insert into saved_views(owner_id, name, query, shared) values ($1,$2,$3::jsonb,$4)
           on conflict (owner_id, name) do update set query = excluded.query, shared = excluded.shared
           returning id`,
          [user.id, req.body.name, JSON.stringify(req.body.query), req.body.shared],
        );
        await audit(tx, {
          actorId: user.id,
          action: 'views.save',
          entityType: 'saved_view',
          entityId: r.rows[0].id,
          before: null,
          after: { name: req.body.name, shared: req.body.shared },
          requestId: req.id,
          ip: req.ip,
        });
        return (await load(tx, r.rows[0].id))!;
      });
      reply.code(201);
      return created;
    },
  );

  app.patch(
    '/views/:id',
    {
      config: { requires: ['docs.read'] },
      schema: {
        tags: ['collab'],
        params: Params,
        body: SavedViewBodySchema.partial(),
        response: { 200: SavedViewSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const before = await load(app.db, req.params.id);
      if (!before) throw notFound('התצוגה');
      if (before.ownerId !== user.id) throw forbidden();
      return withTransaction(app.db, async (tx) => {
        await tx.query(
          `update saved_views set name = coalesce($2, name), query = coalesce($3::jsonb, query),
                                  shared = coalesce($4, shared) where id = $1`,
          [
            before.id,
            req.body.name ?? null,
            req.body.query === undefined ? null : JSON.stringify(req.body.query),
            req.body.shared ?? null,
          ],
        );
        await audit(tx, {
          actorId: user.id,
          action: 'views.patch',
          entityType: 'saved_view',
          entityId: before.id,
          before: { name: before.name, shared: before.shared },
          after: req.body,
          requestId: req.id,
          ip: req.ip,
        });
        return (await load(tx, before.id))!;
      });
    },
  );

  app.delete(
    '/views/:id',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['collab'], params: Params, response: { 204: z.null() } },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const before = await load(app.db, req.params.id);
      if (!before) throw notFound('התצוגה');
      if (before.ownerId !== user.id) throw forbidden();
      await withTransaction(app.db, async (tx) => {
        await tx.query('delete from saved_views where id=$1', [before.id]);
        await audit(tx, {
          actorId: user.id,
          action: 'views.delete',
          entityType: 'saved_view',
          entityId: before.id,
          before: { name: before.name },
          after: null,
          requestId: req.id,
          ip: req.ip,
        });
      });
      reply.code(204);
      return null;
    },
  );
}
