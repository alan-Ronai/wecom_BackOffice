import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { IdSchema, PresenceSchema, makeEvent } from '@wecom/shared';
import { withTransaction, type Queryable } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import { initialsOf, iso } from './repo.js';

/** A heartbeat every ~10 s keeps a row alive; three missed beats and the editor is gone. */
export const PRESENCE_TTL_SECONDS = 30;

const editorsOf = async (q: Queryable, documentId: string) => {
  const r = await q.query(
    `select p.user_id, p.since, p.last_seen_at, u.display_name, u.initials
       from presence p join users u on u.id = p.user_id
      where p.document_id = $1 and p.last_seen_at > now() - ($2 || ' seconds')::interval
      order by p.since`,
    [documentId, String(PRESENCE_TTL_SECONDS)],
  );
  return r.rows.map((x) => ({
    userId: x.user_id as string,
    displayName: x.display_name as string,
    initials: (x.initials as string) || initialsOf(x.display_name as string),
    since: iso(x.since as Date)!,
    lastSeenAt: iso(x.last_seen_at as Date)!,
  }));
};

export default async function presenceRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const DocParams = z.object({ id: IdSchema });

  app.get(
    '/documents/:id/presence',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['collab'], params: DocParams, response: { 200: PresenceSchema } },
    },
    // Expired rows are filtered on read rather than swept on a timer: a browser that was
    // killed never sends a goodbye, so "who is here" can only ever be a TTL question.
    async (req) => ({
      documentId: req.params.id,
      editors: await editorsOf(app.db, req.params.id),
    }),
  );

  app.post(
    '/documents/:id/presence',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['collab'], params: DocParams, response: { 204: z.null() } },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const documentId = req.params.id;
      await withTransaction(app.db, async (tx) => {
        // `since` only restarts when the previous row had already expired, so the badge
        // shows how long somebody has really been in the document.
        await tx.query(
          `insert into presence(document_id, user_id) values ($1,$2)
           on conflict (document_id, user_id) do update
             set last_seen_at = now(),
                 since = case when presence.last_seen_at < now() - ($3 || ' seconds')::interval
                              then now() else presence.since end`,
          [documentId, user.id, String(PRESENCE_TTL_SECONDS)],
        );
        const editors = await editorsOf(tx, documentId);
        await app.events.publish(
          tx,
          makeEvent('presence.changed', { documentId, userId: user.id, editors: editors.length }),
        );
      });
      reply.code(204);
      return null;
    },
  );
}
