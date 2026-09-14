import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CommentBodySchema, CommentSchema, IdSchema, makeEvent } from '@wecom/shared';
import { audit } from '../../lib/audit.js';
import { forbidden, notFound } from '../../lib/http.js';
import { withTransaction, type Queryable } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import { parseMentions, type Mention } from './mentions.js';
import { documentTitle, initialsOf, iso, notify } from './repo.js';

type Comment = z.infer<typeof CommentSchema>;

const SELECT = `
  select c.*, a.display_name as author_name, a.initials as author_initials,
         r.display_name as resolved_by_name,
         (select count(*) from comment_likes l where l.comment_id = c.id) as likes,
         exists(select 1 from comment_likes l where l.comment_id = c.id and l.user_id = $2) as liked_by_me
    from comments c
    join users a on a.id = c.author_id
    left join users r on r.id = c.resolved_by`;

const toApi = (r: Record<string, unknown>): Comment => ({
  id: r.id as string,
  documentId: r.document_id as string,
  stepKey: (r.step_key as string | null) ?? null,
  authorId: r.author_id as string,
  authorName: r.author_name as string,
  authorInitials: (r.author_initials as string) || initialsOf(r.author_name as string),
  text: r.text as string,
  mentions: (r.mentions as Mention[]) ?? [],
  resolvedAt: iso(r.resolved_at as Date | null),
  resolvedByName: (r.resolved_by_name as string | null) ?? null,
  createdAt: iso(r.created_at as Date)!,
  likes: Number(r.likes ?? 0),
  likedByMe: !!r.liked_by_me,
});

const loadComment = async (q: Queryable, id: string, viewerId: string): Promise<Comment | null> => {
  const r = await q.query(`${SELECT} where c.id = $1`, [id, viewerId]);
  return r.rowCount ? toApi(r.rows[0]) : null;
};

export default async function commentRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const DocParams = z.object({ id: IdSchema });

  app.get(
    '/documents/:id/comments',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: {
        tags: ['collab'],
        params: DocParams,
        response: { 200: z.object({ items: z.array(CommentSchema) }) },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const r = await app.db.query(`${SELECT} where c.document_id = $1 order by c.created_at`, [
        req.params.id,
        user.id,
      ]);
      return { items: r.rows.map(toApi) };
    },
  );

  app.post(
    '/documents/:id/comments',
    {
      config: { requires: ['notes.write'], scope: 'document' },
      schema: {
        tags: ['collab'],
        params: DocParams,
        body: CommentBodySchema,
        response: { 201: CommentSchema },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const documentId = req.params.id;
      const candidates = await app.db.query<{ id: string; display_name: string }>(
        'select id, display_name from users where active',
      );
      const mentions = parseMentions(
        req.body.text,
        candidates.rows.map((u) => ({ id: u.id, displayName: u.display_name })),
      );
      const created = await withTransaction(app.db, async (tx) => {
        const ins = await tx.query<{ id: string }>(
          `insert into comments(document_id, step_key, author_id, text, mentions)
           values ($1,$2,$3,$4,$5::jsonb) returning id`,
          [documentId, req.body.stepKey, user.id, req.body.text, JSON.stringify(mentions)],
        );
        const id = ins.rows[0].id;
        const title = await documentTitle(tx, documentId);
        const href = `/doc/${documentId}${req.body.stepKey ? '#' + req.body.stepKey : ''}`;
        for (const m of mentions)
          await notify(
            tx,
            app.events,
            {
              userId: m.userId,
              kind: 'mention',
              title: `${user.displayName} הזכיר אותך ב"${title}"`,
              body: req.body.text.slice(0, 280),
              href,
              entityType: 'comment',
              entityId: id,
            },
            user.id,
          );
        await audit(tx, {
          actorId: user.id,
          action: 'comments.create',
          entityType: 'comment',
          entityId: id,
          before: null,
          after: { documentId, stepKey: req.body.stepKey, mentions: mentions.map((m) => m.userId) },
          requestId: req.id,
          ip: req.ip,
        });
        await app.events.publish(
          tx,
          makeEvent('comment.created', {
            commentId: id,
            documentId,
            stepKey: req.body.stepKey,
            authorId: user.id,
          }),
        );
        return (await loadComment(tx, id, user.id))!;
      });
      reply.code(201);
      return created;
    },
  );

  app.post(
    '/comments/:id/resolve',
    {
      config: { requires: ['notes.write'] },
      schema: { tags: ['collab'], params: DocParams, response: { 200: CommentSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const before = await loadComment(app.db, req.params.id, user.id);
      if (!before) throw notFound('ההערה');
      return withTransaction(app.db, async (tx) => {
        // Toggling back to open is the same permission: a thread reopened by mistake
        // should not need a moderator.
        const open = before.resolvedAt !== null;
        await tx.query(
          `update comments set resolved_at = case when $2 then null else now() end,
                               resolved_by = case when $2 then null else $3::uuid end
             where id = $1`,
          [before.id, open, user.id],
        );
        await audit(tx, {
          actorId: user.id,
          action: 'comments.resolve',
          entityType: 'comment',
          entityId: before.id,
          before: { resolvedAt: before.resolvedAt },
          after: { resolved: !open },
          requestId: req.id,
          ip: req.ip,
        });
        return (await loadComment(tx, before.id, user.id))!;
      });
    },
  );

  app.post(
    '/comments/:id/like',
    {
      config: { requires: ['notes.write'] },
      schema: { tags: ['collab'], params: DocParams, response: { 200: CommentSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const before = await loadComment(app.db, req.params.id, user.id);
      if (!before) throw notFound('ההערה');
      return withTransaction(app.db, async (tx) => {
        if (before.likedByMe)
          await tx.query('delete from comment_likes where comment_id=$1 and user_id=$2', [
            before.id,
            user.id,
          ]);
        else
          await tx.query(
            'insert into comment_likes(comment_id, user_id) values ($1,$2) on conflict do nothing',
            [before.id, user.id],
          );
        return (await loadComment(tx, before.id, user.id))!;
      });
    },
  );

  app.delete(
    '/comments/:id',
    {
      config: { requires: ['notes.write'] },
      schema: { tags: ['collab'], params: DocParams, response: { 204: z.null() } },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const before = await loadComment(app.db, req.params.id, user.id);
      if (!before) throw notFound('ההערה');
      if (before.authorId !== user.id && !user.permissions.has('notes.moderate')) throw forbidden();
      await withTransaction(app.db, async (tx) => {
        await tx.query('delete from comments where id=$1', [before.id]);
        await audit(tx, {
          actorId: user.id,
          action: 'comments.delete',
          entityType: 'comment',
          entityId: before.id,
          before: { documentId: before.documentId, authorId: before.authorId, text: before.text },
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
