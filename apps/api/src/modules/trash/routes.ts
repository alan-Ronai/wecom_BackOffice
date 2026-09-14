import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TrashListSchema } from '@wecom/shared';
import { audit } from '../../lib/audit.js';
import { httpError } from '../../lib/http.js';
import { withTransaction } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import * as repo from './repo.js';

const Params = z.object({
  type: z.enum(['document', 'block', 'field', 'script']),
  id: z.string().min(1),
});
const decodeId = (raw: string) => (/%[0-9A-Fa-f]{2}/.test(raw) ? decodeURIComponent(raw) : raw);

export default async function routes(app: FastifyInstance) {
  app.get(
    '/trash',
    { config: { requires: ['docs.read'] }, schema: { tags: ['trash'], response: { 200: TrashListSchema } } },
    async (req) => {
      const user = requireUser(req);
      return { items: await repo.listTrash(app.db, app.config.TRASH_DAYS, user.worldScopes) };
    },
  );

  app.post(
    '/trash/:type/:id/restore',
    {
      config: { requires: ['docs.restore'] },
      schema: {
        tags: ['trash'],
        params: Params,
        response: { 200: z.object({ auditId: z.string() }) },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { type, id: rawId } = req.params as { type: repo.TrashType; id: string };
      const id = decodeId(rawId);
      return withTransaction(app.db, async (tx) => {
        await repo.restore(tx, type, id, user.id);
        const auditId = await audit(tx, {
          actorId: user.id,
          action: 'docs.restore',
          entityType: type,
          entityId: id,
          before: null,
          after: { restored: true },
          requestId: req.id,
          ip: req.ip,
        });
        return { auditId };
      });
    },
  );

  app.delete(
    '/trash/:type/:id',
    { config: { requires: ['docs.delete'] }, schema: { tags: ['trash'], params: Params } },
    async (req, reply) => {
      const user = requireUser(req);
      const { type, id: rawId } = req.params as { type: repo.TrashType; id: string };
      const id = decodeId(rawId);
      await withTransaction(app.db, async (tx) => {
        await repo.purge(tx, type, id);
        await audit(tx, {
          actorId: user.id,
          action: 'trash.purge',
          entityType: type,
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
    '/trash/restore-all',
    {
      config: { requires: ['docs.restore'] },
      schema: { tags: ['trash'], response: { 200: z.object({ restored: z.number().int() }) } },
    },
    async (req) => {
      const user = requireUser(req);
      return withTransaction(app.db, async (tx) => {
        const items = await repo.listTrash(tx, app.config.TRASH_DAYS, user.worldScopes);
        for (const i of items) await repo.restore(tx, i.type, i.id, user.id);
        await audit(tx, {
          actorId: user.id,
          action: 'docs.restore',
          entityType: 'trash',
          entityId: null,
          before: null,
          after: { restored: items.length },
          requestId: req.id,
          ip: req.ip,
        });
        return { restored: items.length };
      });
    },
  );

  app.delete(
    '/trash',
    {
      config: { requires: ['docs.delete'] },
      schema: {
        tags: ['trash'],
        response: {
          200: z.object({
            purged: z.number().int(),
            /** Items left in the trash because they were published once (PRD §10). */
            skipped: z.number().int(),
          }),
        },
      },
    },
    async (req) => {
      const user = requireUser(req);
      if (req.headers['x-confirm'] !== 'empty')
        throw httpError(428, 'CONFIRM_REQUIRED', 'ריקון סל המיחזור דורש אישור');
      return withTransaction(app.db, async (tx) => {
        const items = await repo.listTrash(tx, app.config.TRASH_DAYS, user.worldScopes);
        let purged = 0;
        // A once-published item skips rather than aborting the whole empty; the operator is
        // told how many stayed behind instead of the request 409ing on the first one.
        for (const i of items)
          if (await repo.purge(tx, i.type, i.id, { skipOncePublished: true })) purged++;
        const skipped = items.length - purged;
        await audit(tx, {
          actorId: user.id,
          action: 'trash.purge',
          entityType: 'trash',
          entityId: null,
          before: { items: items.length },
          after: { purged, skipped },
          requestId: req.id,
          ip: req.ip,
        });
        return { purged, skipped };
      });
    },
  );
}
