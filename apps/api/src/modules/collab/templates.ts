import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { IdSchema, TemplateBodySchema, TemplateSchema, type Category, type Phase } from '@wecom/shared';
import { audit } from '../../lib/audit.js';
import { HttpError, forbidden, notFound } from '../../lib/http.js';
import { withTransaction, type Queryable } from '../../lib/sql.js';
import { requireUser, type ReqUser } from '../../lib/user.js';
import { iso } from './repo.js';

type Template = z.infer<typeof TemplateSchema>;

const toApi = (r: Record<string, unknown>): Template => ({
  id: r.id as string,
  name: r.name as string,
  description: (r.description as string) ?? '',
  category: (r.category as Category | null) ?? null,
  kind: r.kind as Template['kind'],
  phases: (r.phases as Phase[]) ?? [],
  builtIn: !!r.built_in,
  updatedAt: iso(r.updated_at as Date)!,
});

const load = async (q: Queryable, id: string): Promise<Template | null> => {
  const r = await q.query('select * from templates where id=$1', [id]);
  return r.rowCount ? toApi(r.rows[0]) : null;
};

/**
 * `created_by` was stored and never read, so any `docs.edit` holder could edit or delete
 * anyone else's custom template — while saved views, the same kind of per-person object, are
 * owner-only (`views.ts`). The asymmetry looks accidental, so this closes it: your own
 * template, or a librarian's (`docs.publish`, the permission that already decides what the
 * floor sees) tidy-up. `TemplateSchema` is untouched; ownership is a check, not a field.
 */
const assertOwns = async (q: Queryable, id: string, user: ReqUser): Promise<void> => {
  if (user.permissions.has('docs.publish')) return;
  const r = await q.query<{ created_by: string | null }>('select created_by from templates where id=$1', [
    id,
  ]);
  if (r.rows[0]?.created_by !== user.id) throw forbidden();
};

export default async function templateRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const Params = z.object({ id: IdSchema });

  app.get(
    '/templates',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['collab'], response: { 200: z.object({ items: z.array(TemplateSchema) }) } },
    },
    async () => {
      const r = await app.db.query('select * from templates order by built_in desc, name');
      return { items: r.rows.map(toApi) };
    },
  );

  app.post(
    '/templates',
    {
      config: { requires: ['docs.edit'] },
      schema: { tags: ['collab'], body: TemplateBodySchema, response: { 201: TemplateSchema } },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const created = await withTransaction(app.db, async (tx) => {
        const dup = await tx.query('select 1 from templates where name=$1', [req.body.name]);
        if (dup.rowCount) throw new HttpError(409, 'TEMPLATE_EXISTS', 'תבנית בשם זה כבר קיימת');
        const r = await tx.query<{ id: string }>(
          `insert into templates(name, description, category, kind, phases, created_by)
           values ($1,$2,$3,$4,$5::jsonb,$6) returning id`,
          [
            req.body.name,
            req.body.description,
            req.body.category,
            req.body.kind,
            JSON.stringify(req.body.phases),
            user.id,
          ],
        );
        await audit(tx, {
          actorId: user.id,
          action: 'templates.create',
          entityType: 'template',
          entityId: r.rows[0].id,
          before: null,
          after: { name: req.body.name, kind: req.body.kind, phases: req.body.phases.length },
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
    '/templates/:id',
    {
      config: { requires: ['docs.edit'] },
      schema: {
        tags: ['collab'],
        params: Params,
        body: TemplateBodySchema.partial(),
        response: { 200: TemplateSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const before = await load(app.db, req.params.id);
      if (!before) throw notFound('התבנית');
      // A built-in is the shared vocabulary the floor already learned; editing one would
      // silently change it for everybody. Duplicate it instead.
      if (before.builtIn) throw new HttpError(409, 'BUILT_IN', 'לא ניתן לערוך תבנית מובנית');
      await assertOwns(app.db, before.id, user);
      return withTransaction(app.db, async (tx) => {
        await tx.query(
          `update templates set name = coalesce($2,name), description = coalesce($3,description),
                 category = coalesce($4,category), kind = coalesce($5,kind),
                 phases = coalesce($6::jsonb, phases), updated_at = now() where id=$1`,
          [
            before.id,
            req.body.name ?? null,
            req.body.description ?? null,
            req.body.category ?? null,
            req.body.kind ?? null,
            req.body.phases === undefined ? null : JSON.stringify(req.body.phases),
          ],
        );
        await audit(tx, {
          actorId: user.id,
          action: 'templates.patch',
          entityType: 'template',
          entityId: before.id,
          before: { name: before.name, kind: before.kind },
          after: { name: req.body.name ?? before.name, kind: req.body.kind ?? before.kind },
          requestId: req.id,
          ip: req.ip,
        });
        return (await load(tx, before.id))!;
      });
    },
  );

  app.delete(
    '/templates/:id',
    {
      config: { requires: ['docs.edit'] },
      schema: { tags: ['collab'], params: Params, response: { 204: z.null() } },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const before = await load(app.db, req.params.id);
      if (!before) throw notFound('התבנית');
      if (before.builtIn) throw new HttpError(409, 'BUILT_IN', 'לא ניתן למחוק תבנית מובנית');
      await assertOwns(app.db, before.id, user);
      await withTransaction(app.db, async (tx) => {
        await tx.query('delete from templates where id=$1', [before.id]);
        await audit(tx, {
          actorId: user.id,
          action: 'templates.delete',
          entityType: 'template',
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
