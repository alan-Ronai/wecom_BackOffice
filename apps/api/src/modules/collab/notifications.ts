import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  IdSchema,
  MentionCandidateSchema,
  NotificationSchema,
  NotificationsQuerySchema,
  NotificationsResponseSchema,
} from '@wecom/shared';
import { badRequest } from '../../lib/http.js';
import { withTransaction } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import { initialsOf, iso } from './repo.js';

const ReadBody = z
  .object({ ids: z.array(IdSchema).max(500).optional(), all: z.boolean().optional() })
  .refine((b) => b.all || (b.ids && b.ids.length), { message: 'ids או all נדרשים' });

const toApi = (r: Record<string, unknown>): z.infer<typeof NotificationSchema> => ({
  id: r.id as string,
  kind: r.kind as z.infer<typeof NotificationSchema>['kind'],
  title: r.title as string,
  body: (r.body as string) ?? '',
  href: (r.href as string | null) ?? null,
  entityType: (r.entity_type as string | null) ?? null,
  entityId: (r.entity_id as string | null) ?? null,
  createdAt: iso(r.created_at as Date)!,
  readAt: iso(r.read_at as Date | null),
});

export default async function notificationRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/notifications',
    {
      config: { requires: ['docs.read'] },
      schema: {
        tags: ['collab'],
        querystring: NotificationsQuerySchema,
        response: { 200: NotificationsResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { page, pageSize, unread } = req.query;
      const where = unread ? 'and read_at is null' : '';
      const [rows, counts] = await Promise.all([
        app.db.query(
          `select * from notifications where user_id=$1 ${where}
             order by created_at desc limit $2 offset $3`,
          [user.id, pageSize, (page - 1) * pageSize],
        ),
        app.db.query<{ total: string; unread: string }>(
          `select count(*) filter (where $2::bool is false or read_at is null) as total,
                  count(*) filter (where read_at is null) as unread
             from notifications where user_id=$1`,
          [user.id, !!unread],
        ),
      ]);
      return {
        items: rows.rows.map(toApi),
        total: Number(counts.rows[0].total),
        page,
        pageSize,
        unread: Number(counts.rows[0].unread),
      };
    },
  );

  app.post(
    '/notifications/read',
    {
      config: { requires: ['docs.read'] },
      schema: {
        tags: ['collab'],
        body: ReadBody,
        response: { 200: z.object({ unread: z.number().int() }) },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { ids, all } = req.body;
      if (!all && !ids?.length) throw badRequest('לא נבחרו התראות');
      return withTransaction(app.db, async (tx) => {
        // Scoped to the caller's own rows: an id belonging to someone else is a no-op,
        // not a 403, so a stale tab cannot enumerate other people's notifications.
        if (all)
          await tx.query('update notifications set read_at=now() where user_id=$1 and read_at is null', [
            user.id,
          ]);
        else
          await tx.query(
            'update notifications set read_at=now() where user_id=$1 and read_at is null and id = any($2::uuid[])',
            [user.id, ids],
          );
        const left = await tx.query<{ n: string }>(
          'select count(*) as n from notifications where user_id=$1 and read_at is null',
          [user.id],
        );
        return { unread: Number(left.rows[0].n) };
      });
    },
  );

  app.get(
    '/users/mentionable',
    {
      config: { requires: ['notes.write'] },
      schema: {
        tags: ['collab'],
        querystring: z.object({ q: z.string().max(80).optional() }),
        response: { 200: z.object({ items: z.array(MentionCandidateSchema) }) },
      },
    },
    async (req) => {
      const q = (req.query.q ?? '').trim();
      // Prefix match on the display name, with a contains fallback: Hebrew names are
      // routinely typed from the middle ("לוי" for "ענבר לוי").
      const rows = await app.db.query(
        `select id, display_name, initials, email from users
          where active and ($1 = '' or display_name ilike $2 or display_name ilike $3 or email ilike $3)
          order by (case when display_name ilike $2 then 0 else 1 end), display_name limit 20`,
        [q, q + '%', '%' + q + '%'],
      );
      return {
        items: rows.rows.map((u) => ({
          id: u.id as string,
          displayName: u.display_name as string,
          initials: (u.initials as string) || initialsOf(u.display_name as string),
          email: (u.email as string | null) ?? null,
        })),
      };
    },
  );
}
