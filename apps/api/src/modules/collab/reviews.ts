import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  IdSchema,
  PaginationQuerySchema,
  RequestReviewBodySchema,
  ReviewDecisionBodySchema,
  ReviewQueueResponseSchema,
  ReviewRequestSchema,
  makeEvent,
  type Category,
} from '@wecom/shared';
import { audit } from '../../lib/audit.js';
import { badRequest, httpError, notFound } from '../../lib/http.js';
import { withTransaction, type Queryable, type Tx } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import { publishDocument } from '../documents/publish.js';
import { documentTitle, iso, leadIds, notify, notifyMany } from './repo.js';

type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

const SELECT = `
  select rr.*, req.display_name as requested_by_name, dec.display_name as decided_by_name,
         d.title, d.category
    from review_requests rr
    join users req on req.id = rr.requested_by
    left join users dec on dec.id = rr.decided_by
    join documents d on d.id = rr.document_id`;

const toApi = (r: Record<string, unknown>): ReviewRequest => ({
  id: r.id as string,
  documentId: r.document_id as string,
  requestedBy: r.requested_by as string,
  requestedByName: r.requested_by_name as string,
  note: (r.note as string | null) ?? null,
  status: r.status as ReviewRequest['status'],
  decidedBy: (r.decided_by as string | null) ?? null,
  decidedByName: (r.decided_by_name as string | null) ?? null,
  decisionNote: (r.decision_note as string | null) ?? null,
  createdAt: iso(r.created_at as Date)!,
  decidedAt: iso(r.decided_at as Date | null),
});

const load = async (q: Queryable, id: string): Promise<ReviewRequest | null> => {
  const r = await q.query(`${SELECT} where rr.id = $1`, [id]);
  return r.rowCount ? toApi(r.rows[0]) : null;
};

/** The people a request is actually addressed to: the named reviewers, else every lead. */
async function recipients(tx: Tx, reviewerIds: string[], requesterId: string): Promise<string[]> {
  if (reviewerIds.length) {
    const r = await tx.query<{ id: string }>(
      'select id from users where id = any($1::uuid[]) and active and id <> $2',
      [reviewerIds, requesterId],
    );
    return r.rows.map((x) => x.id);
  }
  return leadIds(tx, requesterId);
}

export default async function reviewRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const DocParams = z.object({ id: IdSchema });

  app.post(
    '/documents/:id/request-review',
    {
      config: { requires: ['docs.edit'], scope: 'document' },
      schema: {
        tags: ['collab'],
        params: DocParams,
        body: RequestReviewBodySchema,
        response: { 201: ReviewRequestSchema },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const documentId = req.params.id;
      const created = await withTransaction(app.db, async (tx) => {
        const cur = await tx.query<{ status: string; title: string }>(
          'select status, title from documents where id=$1 and deleted_at is null for update',
          [documentId],
        );
        if (!cur.rowCount) throw notFound('המסמך');
        const reviewerIds = req.body.reviewerIds ?? [];
        // One open request per document (partial unique index): asking twice updates
        // the standing request rather than filling the queue with duplicates.
        // Move the document to `review` first, so the baseline stored below is the etag the
        // reviewer will actually open — this statement mints a new one.
        const moved = await tx.query<{ etag: string; current_version: number }>(
          `update documents set status='review', updated_by=$2, updated_at=now(),
                  etag=gen_random_uuid()::text
             where id=$1 returning etag, current_version`,
          [documentId, user.id],
        );
        const baseline = moved.rows[0];
        const ins = await tx.query<{ id: string }>(
          `insert into review_requests(document_id, requested_by, reviewer_ids, note, base_version, base_etag)
           values ($1,$2,$3::uuid[],$4,$5,$6)
           on conflict (document_id) where status = 'open'
           do update set requested_by = excluded.requested_by, reviewer_ids = excluded.reviewer_ids,
                         note = excluded.note, created_at = now(),
                         base_version = excluded.base_version, base_etag = excluded.base_etag
           returning id`,
          [documentId, user.id, reviewerIds, req.body.note ?? null, baseline.current_version, baseline.etag],
        );
        const id = ins.rows[0].id;
        const title = cur.rows[0].title;
        await notifyMany(
          tx,
          app.events,
          (await recipients(tx, reviewerIds, user.id)).map((userId) => ({
            userId,
            kind: 'review' as const,
            title: `${user.displayName} ביקש בדיקה: "${title}"`,
            body: req.body.note ?? '',
            href: `/doc/${documentId}`,
            entityType: 'review_request',
            entityId: id,
          })),
          user.id,
        );
        await audit(tx, {
          actorId: user.id,
          action: 'reviews.request',
          entityType: 'document',
          entityId: documentId,
          before: { status: cur.rows[0].status },
          after: { status: 'review', reviewRequestId: id, reviewerIds },
          requestId: req.id,
          ip: req.ip,
        });
        await app.events.publish(
          tx,
          makeEvent('review.requested', { reviewRequestId: id, documentId, requestedBy: user.id }),
        );
        return (await load(tx, id))!;
      });
      reply.code(201);
      return created;
    },
  );

  app.post(
    '/documents/:id/review-decision',
    {
      config: { requires: ['docs.publish'], scope: 'document' },
      schema: {
        tags: ['collab'],
        params: DocParams,
        body: ReviewDecisionBodySchema,
        response: { 200: ReviewRequestSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const documentId = req.params.id;
      return withTransaction(app.db, async (tx) => {
        const open = await tx.query<{
          id: string;
          requested_by: string;
          base_version: number | null;
          base_etag: string | null;
        }>(
          `select id, requested_by, base_version, base_etag from review_requests
            where document_id=$1 and status='open' order by created_at desc limit 1 for update`,
          [documentId],
        );
        if (!open.rowCount) throw badRequest('אין בקשת בדיקה פתוחה למסמך זה');
        const {
          id,
          requested_by: requesterId,
          base_version: baseVersion,
          base_etag: baseEtag,
        } = open.rows[0];
        const approve = req.body.decision === 'approve';
        const title = await documentTitle(tx, documentId);
        if (approve) {
          // Approve what the reviewer was asked to review, not what the document happens to be
          // now. An author who pushes edits after "send to review" would otherwise have them
          // published under the reviewer's name and label. 409 is the honest default for a
          // workflow whose whole point is that somebody looked; "changes" needs no such check,
          // since sending a document back cannot publish anything.
          const nowRow = await tx.query<{ etag: string; current_version: number }>(
            'select etag, current_version from documents where id=$1',
            [documentId],
          );
          const cur = nowRow.rows[0];
          // `null` baseline = a request that predates the column; those stay decidable.
          if (baseEtag !== null && cur && (cur.etag !== baseEtag || cur.current_version !== baseVersion))
            throw httpError(409, 'REVIEW_STALE', 'המסמך השתנה מאז שהתבקשה הבדיקה — יש לבדוק שוב לפני אישור', {
              baseVersion,
              currentVersion: cur.current_version,
            });
          // The approval is what makes the version: the label is the reviewer's, so the
          // history reads "אושר בבדיקה" rather than an anonymous bump.
          await publishDocument(tx, documentId, {
            actorId: user.id,
            label: req.body.label ?? `אושר בבדיקה על ידי ${user.displayName}`,
          });
        } else {
          await tx.query(
            "update documents set status='draft', updated_by=$2, updated_at=now(), etag=gen_random_uuid()::text where id=$1",
            [documentId, user.id],
          );
        }
        await tx.query(
          `update review_requests set status=$2, decided_by=$3, decision_note=$4, decided_at=now() where id=$1`,
          [id, approve ? 'approved' : 'changes', user.id, req.body.note ?? null],
        );
        await notify(
          tx,
          app.events,
          {
            userId: requesterId,
            kind: approve ? 'publish' : 'review',
            title: approve ? `"${title}" אושר ופורסם` : `"${title}" הוחזר לתיקונים`,
            body: req.body.note ?? '',
            href: `/doc/${documentId}`,
            entityType: 'review_request',
            entityId: id,
          },
          user.id,
        );
        await audit(tx, {
          actorId: user.id,
          action: 'reviews.decide',
          entityType: 'document',
          entityId: documentId,
          before: { reviewRequestId: id, status: 'open' },
          after: { decision: req.body.decision, note: req.body.note ?? null },
          requestId: req.id,
          ip: req.ip,
        });
        await app.events.publish(
          tx,
          makeEvent('review.decided', {
            reviewRequestId: id,
            documentId,
            decision: req.body.decision,
            decidedBy: user.id,
          }),
        );
        return (await load(tx, id))!;
      });
    },
  );

  app.get(
    '/reviews',
    {
      config: { requires: ['docs.publish'] },
      schema: {
        tags: ['collab'],
        querystring: PaginationQuerySchema.extend({
          status: z.enum(['open', 'approved', 'changes']).optional(),
        }),
        response: { 200: ReviewQueueResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { page, pageSize, status } = req.query;
      const cond: string[] = [];
      const params: unknown[] = [];
      if (status) {
        params.push(status);
        cond.push(`rr.status = $${params.length}`);
      }
      // A category-scoped lead sees only the documents they may actually publish.
      if (user.categoryScopes) {
        params.push(user.categoryScopes);
        cond.push(`d.category = any($${params.length}::text[])`);
      }
      const where = cond.length ? 'where ' + cond.join(' and ') : '';
      const total = await app.db.query<{ n: string }>(
        `select count(*) as n from review_requests rr join documents d on d.id = rr.document_id ${where}`,
        params,
      );
      const rows = await app.db.query(
        `${SELECT} ${where} order by rr.created_at desc limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, pageSize, (page - 1) * pageSize],
      );
      return {
        items: rows.rows.map((r) => ({
          ...toApi(r),
          title: r.title as string,
          category: r.category as Category,
        })),
        total: Number(total.rows[0].n),
        page,
        pageSize,
      };
    },
  );
}
