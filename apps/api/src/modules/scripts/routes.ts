import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IdSchema, ScriptListSchema, ScriptSchema, UpsertScriptBodySchema } from '@wecom/shared';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/http.js';
import { withTransaction } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import * as repo from './repo.js';

const Params = z.object({ id: IdSchema });

/** Deprecated adapter over type-T documents (W1). Removed after wave 4; use /documents?docType=T. */

export default async function routes(app: FastifyInstance) {
  app.get(
    '/scripts',
    {
      config: { requires: ['docs.read'] },
      schema: { deprecated: true, tags: ['scripts'], response: { 200: ScriptListSchema } },
    },
    async (req) => {
      requireUser(req);
      return { items: await repo.listScripts(app.db) };
    },
  );

  app.post(
    '/scripts',
    {
      config: { requires: ['scripts.edit'] },
      schema: {
        deprecated: true,
        tags: ['scripts'],
        body: UpsertScriptBodySchema,
        response: { 200: ScriptSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const body = req.body as z.infer<typeof UpsertScriptBodySchema>;
      return withTransaction(app.db, async (tx) => {
        const s = await repo.createScript(tx, body, user.id);
        await audit(tx, {
          actorId: user.id,
          action: 'scripts.create',
          entityType: 'script',
          entityId: s.id,
          before: null,
          after: { title: s.title },
          requestId: req.id,
          ip: req.ip,
        });
        return s;
      });
    },
  );

  app.put(
    '/scripts/:id',
    {
      config: { requires: ['scripts.edit'] },
      schema: {
        deprecated: true,
        tags: ['scripts'],
        params: Params,
        body: UpsertScriptBodySchema,
        response: { 200: ScriptSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof UpsertScriptBodySchema>;
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getScript(tx, id);
        if (!before) throw notFound('התסריט');
        const after = await repo.updateScript(tx, id, body, user.id);
        await audit(tx, {
          actorId: user.id,
          action: 'scripts.edit',
          entityType: 'script',
          entityId: id,
          before,
          after,
          requestId: req.id,
          ip: req.ip,
        });
        return after;
      });
    },
  );

  app.delete(
    '/scripts/:id',
    {
      config: { requires: ['scripts.edit'] },
      schema: {
        deprecated: true,
        tags: ['scripts'],
        params: Params,
        response: { 200: z.object({ auditId: z.string() }) },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getScript(tx, id);
        if (!before) throw notFound('התסריט');
        await repo.deleteScript(tx, id, user.id);
        const auditId = await audit(tx, {
          actorId: user.id,
          action: 'scripts.delete',
          entityType: 'script',
          entityId: id,
          before,
          after: null,
          requestId: req.id,
          ip: req.ip,
        });
        return { auditId };
      });
    },
  );
}
