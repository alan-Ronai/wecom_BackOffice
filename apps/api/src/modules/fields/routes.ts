import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CrmFieldSchema,
  FieldListSchema,
  FieldPageSchema,
  FieldRenameBodySchema,
  FieldRenameResultSchema,
  FieldUsageSchema,
  UpsertFieldBodySchema,
  makeEvent,
} from '@wecom/shared';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/http.js';
import { withTransaction } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import * as repo from './repo.js';

const Params = z.object({ name: z.string().min(1) });
/** Hebrew field names arrive percent-encoded; find-my-way decodes once, guard against the rest. */
const decodeName = (raw: string) => (/%[0-9A-Fa-f]{2}/.test(raw) ? decodeURIComponent(raw) : raw);

export default async function routes(app: FastifyInstance) {
  app.get(
    '/fields',
    { config: { requires: ['docs.read'] }, schema: { tags: ['fields'], response: { 200: FieldListSchema } } },
    async (req) => {
      requireUser(req);
      return { items: await repo.listFields(app.db) };
    },
  );

  app.get(
    '/fields/:name/usage',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['fields'], params: Params, response: { 200: FieldUsageSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const name = decodeName((req.params as { name: string }).name);
      return { items: await repo.fieldUsage(app.db, name, user.categoryScopes) };
    },
  );

  // Stage 4 (connected data): one page per CRM field — where it is used, what changed and
  // what a writer has to watch out for.
  app.get(
    '/fields/:name/page',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['fields'], params: Params, response: { 200: FieldPageSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      // The field itself is catalogue data, but its `usage` carries document ids, titles,
      // categories and the full step text — all of which are scoped.
      const page = await repo.fieldPage(
        app.db,
        decodeName((req.params as { name: string }).name),
        user.categoryScopes,
      );
      if (!page) throw notFound('השדה');
      return page;
    },
  );

  app.post(
    '/fields/:name/rename',
    {
      config: { requires: ['fields.edit'] },
      schema: {
        tags: ['fields'],
        params: Params,
        body: FieldRenameBodySchema,
        response: { 200: FieldRenameResultSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const name = decodeName((req.params as { name: string }).name);
      const body = req.body as z.infer<typeof FieldRenameBodySchema>;
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getField(tx, name);
        const { result, affected } = await repo.renameField(tx, name, body, user.id);
        await audit(tx, {
          actorId: user.id,
          action: 'fields.rename',
          entityType: 'crm_field',
          entityId: name,
          before,
          after: { ...result.field, updatedDocuments: result.updatedDocuments },
          requestId: req.id,
          ip: req.ip,
        });
        for (const documentId of affected)
          await app.events.publish(tx, makeEvent('document.updated', { documentId, actorId: user.id }));
        return result;
      });
    },
  );

  app.put(
    '/fields/:name',
    {
      config: { requires: ['fields.edit'] },
      schema: {
        tags: ['fields'],
        params: Params,
        body: UpsertFieldBodySchema,
        response: { 200: CrmFieldSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const name = decodeName((req.params as { name: string }).name);
      const body = req.body as z.infer<typeof UpsertFieldBodySchema>;
      if (body.name !== name) throw badRequest('שם השדה בנתיב ובגוף הבקשה חייב להיות זהה');
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getField(tx, name);
        const after = await repo.upsertField(tx, body, user.id);
        await audit(tx, {
          actorId: user.id,
          action: 'fields.edit',
          entityType: 'crm_field',
          entityId: name,
          before,
          after,
          requestId: req.id,
          ip: req.ip,
        });
        for (const documentId of await repo.documentsMentioning(tx, name))
          await app.events.publish(tx, makeEvent('document.updated', { documentId, actorId: user.id }));
        return after;
      });
    },
  );

  app.delete(
    '/fields/:name',
    {
      config: { requires: ['fields.edit'] },
      schema: { tags: ['fields'], params: Params, response: { 200: z.object({ auditId: z.string() }) } },
    },
    async (req) => {
      const user = requireUser(req);
      const name = decodeName((req.params as { name: string }).name);
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getField(tx, name);
        if (!before) throw notFound('השדה');
        const affected = await repo.deleteField(tx, name, user.id);
        const auditId = await audit(tx, {
          actorId: user.id,
          action: 'fields.delete',
          entityType: 'crm_field',
          entityId: name,
          before,
          after: null,
          requestId: req.id,
          ip: req.ip,
        });
        for (const documentId of affected)
          await app.events.publish(tx, makeEvent('document.updated', { documentId, actorId: user.id }));
        return { auditId };
      });
    },
  );
}
