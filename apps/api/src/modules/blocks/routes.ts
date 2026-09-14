import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  BlockListSchema,
  BlockPageSchema,
  BlockSchema,
  BlockUsageSchema,
  BlockVersionListSchema,
  DeleteResponseSchema,
  IdSchema,
  UpsertBlockBodySchema,
  makeEvent,
} from '@wecom/shared';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/http.js';
import { withTransaction } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import * as repo from './repo.js';

const Params = z.object({ id: IdSchema });

export default async function routes(app: FastifyInstance) {
  app.get(
    '/blocks',
    { config: { requires: ['docs.read'] }, schema: { tags: ['blocks'], response: { 200: BlockListSchema } } },
    async (req) => {
      requireUser(req);
      return { items: await repo.listBlocks(app.db) };
    },
  );

  app.get(
    '/blocks/:id',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['blocks'], params: Params, response: { 200: BlockSchema } },
    },
    async (req) => {
      requireUser(req);
      const b = await repo.getBlock(app.db, (req.params as { id: string }).id);
      if (!b) throw notFound('הבלוק');
      return b;
    },
  );

  // Stage 4 (connected data): one page per block — where it is embedded or referenced,
  // and the version trail behind it.
  app.get(
    '/blocks/:id/page',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['blocks'], params: Params, response: { 200: BlockPageSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      // `usage` names the documents that embed the block, so it is scoped like the field page.
      const page = await repo.blockPage(app.db, (req.params as { id: string }).id, user.categoryScopes);
      if (!page) throw notFound('הבלוק');
      return page;
    },
  );

  app.post(
    '/blocks',
    {
      config: { requires: ['blocks.edit'] },
      schema: { tags: ['blocks'], body: UpsertBlockBodySchema, response: { 200: BlockSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const body = req.body as z.infer<typeof UpsertBlockBodySchema>;
      return withTransaction(app.db, async (tx) => {
        const block = await repo.createBlock(tx, body, user.id);
        await audit(tx, {
          actorId: user.id,
          action: 'blocks.edit',
          entityType: 'block',
          entityId: block.id,
          before: null,
          after: { title: block.title, version: block.currentVersion },
          requestId: req.id,
          ip: req.ip,
        });
        return block;
      });
    },
  );

  app.put(
    '/blocks/:id',
    {
      config: { requires: ['blocks.edit'] },
      schema: {
        tags: ['blocks'],
        params: Params,
        body: UpsertBlockBodySchema,
        response: { 200: BlockSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof UpsertBlockBodySchema>;
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getBlock(tx, id);
        if (!before) throw notFound('הבלוק');
        const { block, affected } = await repo.updateBlock(tx, id, body, user.id);
        await audit(tx, {
          actorId: user.id,
          action: 'blocks.edit',
          entityType: 'block',
          entityId: id,
          before: { title: before.title, version: before.currentVersion },
          after: { title: block.title, version: block.currentVersion, documents: affected.length },
          requestId: req.id,
          ip: req.ip,
        });
        for (const documentId of affected)
          await app.events.publish(tx, makeEvent('document.updated', { documentId, actorId: user.id }));
        return block;
      });
    },
  );

  app.delete(
    '/blocks/:id',
    {
      config: { requires: ['blocks.edit'] },
      schema: { tags: ['blocks'], params: Params, response: { 200: DeleteResponseSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getBlock(tx, id);
        if (!before) throw notFound('הבלוק');
        const affected = await repo.deleteBlock(tx, id, user.id);
        const auditId = await audit(tx, {
          actorId: user.id,
          action: 'blocks.delete',
          entityType: 'block',
          entityId: id,
          before: { title: before.title },
          after: null,
          requestId: req.id,
          ip: req.ip,
        });
        for (const documentId of affected)
          await app.events.publish(tx, makeEvent('document.updated', { documentId, actorId: user.id }));
        return {
          auditId,
          restoreUntil: new Date(Date.now() + app.config.TRASH_DAYS * 86400_000).toISOString(),
        };
      });
    },
  );

  app.get(
    '/blocks/:id/usage',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['blocks'], params: Params, response: { 200: BlockUsageSchema } },
    },
    async (req) => {
      requireUser(req);
      return { items: await repo.blockUsage(app.db, (req.params as { id: string }).id) };
    },
  );

  app.get(
    '/blocks/:id/versions',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['blocks'], params: Params, response: { 200: BlockVersionListSchema } },
    },
    async (req) => {
      requireUser(req);
      return { items: await repo.listBlockVersions(app.db, (req.params as { id: string }).id) };
    },
  );
}
