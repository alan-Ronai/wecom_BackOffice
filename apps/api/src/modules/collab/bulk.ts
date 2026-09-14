import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BulkDocumentsBodySchema, BulkResultSchema, makeEvent, type Permission } from '@wecom/shared';
import { audit } from '../../lib/audit.js';
import { badRequest } from '../../lib/http.js';
import { withTransaction, type Tx } from '../../lib/sql.js';
import { hasScope, requireUser, type ReqUser } from '../../lib/user.js';
import { softDelete } from '../documents/repo.js';
import { leadIds, notifyMany } from './repo.js';

type Body = import('zod').infer<typeof BulkDocumentsBodySchema>;
type Action = Body['action'];

/** What each action costs. Pin is a personal bookmark, so it needs nothing beyond read. */
const REQUIRED: Record<Action, Permission> = {
  pin: 'docs.read',
  unpin: 'docs.read',
  delete: 'docs.delete',
  'set-wave': 'docs.edit',
  'set-priority': 'docs.edit',
  'set-category': 'docs.edit',
  'request-review': 'docs.edit',
};

const COLUMN: Partial<Record<Action, string>> = {
  'set-wave': 'wave',
  'set-priority': 'priority',
  'set-category': 'category',
};

const valueOf = (body: Body): string | number | undefined =>
  body.action === 'set-wave' ? body.wave : body.action === 'set-priority' ? body.priority : body.category;

export default async function bulkRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/documents/bulk',
    {
      // The route floor is `docs.read`; the real gate is per action, below, because one
      // request may touch documents the caller may edit and documents they may not.
      config: { requires: ['docs.read'] },
      schema: { tags: ['collab'], body: BulkDocumentsBodySchema, response: { 200: BulkResultSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const body = req.body;
      const value = valueOf(body);
      if (COLUMN[body.action] && value === undefined)
        throw badRequest('חסר ערך לפעולה ' + body.action, { action: body.action });
      // Moving a document into a category the caller cannot reach would take it out of
      // their own scope and out of anyone's reach to undo.
      if (body.action === 'set-category' && !hasScope(user, String(value)))
        throw badRequest('הקטגוריה מחוץ להרשאה שלך', { category: value });

      const skipped: { id: string; reason: string }[] = [];
      if (!user.permissions.has(REQUIRED[body.action]))
        return {
          affected: 0,
          skipped: body.ids.map((id) => ({ id, reason: `אין הרשאה ${REQUIRED[body.action]}` })),
        };

      return withTransaction(app.db, async (tx) => {
        const rows = await tx.query<{ id: string; category: string; status: string; title: string }>(
          'select id, category, status, title from documents where id = any($1::uuid[]) and deleted_at is null',
          [body.ids],
        );
        const found = new Map(rows.rows.map((r) => [r.id, r]));
        // Hoisted out of the loop: `leadIds` reads the whole role graph, and a 200-document
        // `request-review` ran the identical query 200 times inside one transaction.
        const leads = body.action === 'request-review' ? await leadIds(tx, user.id) : [];
        let affected = 0;
        for (const id of body.ids) {
          const doc = found.get(id);
          if (!doc) {
            skipped.push({ id, reason: 'המסמך לא נמצא' });
            continue;
          }
          if (!hasScope(user, doc.category)) {
            skipped.push({ id, reason: `הקטגוריה ${doc.category} מחוץ להרשאה שלך` });
            continue;
          }
          await apply(tx, app, req, user, body, doc, leads);
          affected++;
        }
        return { affected, skipped };
      });
    },
  );
}

async function apply(
  tx: Tx,
  app: FastifyInstance,
  req: { id: string; ip: string },
  user: ReqUser,
  body: Body,
  doc: { id: string; category: string; status: string; title: string },
  leads: string[],
): Promise<void> {
  const before: Record<string, unknown> = { category: doc.category, status: doc.status };
  const after: Record<string, unknown> = { action: body.action };
  switch (body.action) {
    case 'pin':
      await tx.query('insert into pins(user_id, document_id) values ($1,$2) on conflict do nothing', [
        user.id,
        doc.id,
      ]);
      break;
    case 'unpin':
      await tx.query('delete from pins where user_id=$1 and document_id=$2', [user.id, doc.id]);
      break;
    case 'delete':
      await softDelete(tx, doc.id, user.id);
      break;
    case 'set-wave':
    case 'set-priority':
    case 'set-category': {
      const col = COLUMN[body.action]!;
      const value = valueOf(body);
      await tx.query(
        `update documents set ${col} = $2, updated_by = $3, updated_at = now(), etag = gen_random_uuid()::text where id = $1`,
        [doc.id, value, user.id],
      );
      after[col] = value;
      break;
    }
    case 'request-review': {
      const ins = await tx.query<{ id: string }>(
        `insert into review_requests(document_id, requested_by, reviewer_ids, note)
         values ($1,$2,'{}'::uuid[],null)
         on conflict (document_id) where status = 'open'
         do update set requested_by = excluded.requested_by, created_at = now()
         returning id`,
        [doc.id, user.id],
      );
      await tx.query(
        "update documents set status='review', updated_by=$2, updated_at=now(), etag=gen_random_uuid()::text where id=$1",
        [doc.id, user.id],
      );
      await notifyMany(
        tx,
        app.events,
        leads.map((userId) => ({
          userId,
          kind: 'review' as const,
          title: `${user.displayName} ביקש בדיקה: "${doc.title}"`,
          href: `/doc/${doc.id}`,
          entityType: 'review_request',
          entityId: ins.rows[0].id,
        })),
        user.id,
      );
      await app.events.publish(
        tx,
        makeEvent('review.requested', {
          reviewRequestId: ins.rows[0].id,
          documentId: doc.id,
          requestedBy: user.id,
        }),
      );
      after.status = 'review';
      break;
    }
  }
  // Every document in the batch gets its own audit row: "bulk" is a UI convenience,
  // never a hole in the trail.
  await audit(tx, {
    actorId: user.id,
    action: 'documents.bulk.' + body.action,
    entityType: 'document',
    entityId: doc.id,
    before,
    after,
    requestId: req.id,
    ip: req.ip,
  });
}
