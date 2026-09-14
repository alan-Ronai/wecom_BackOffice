import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateNoteBodySchema,
  IdSchema,
  NoteLikeResponseSchema,
  NoteListSchema,
  NoteSchema,
} from '@wecom/shared';
import { audit } from '../../lib/audit.js';
import { forbidden, notFound } from '../../lib/http.js';
import { withTransaction } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import { getDocument } from '../documents/repo.js';
import { assertVisibleDocument } from '../../lib/visibility.js';
import * as repo from './repo.js';

const DocParams = z.object({ id: IdSchema });

export default async function routes(app: FastifyInstance) {
  app.get(
    '/documents/:id/notes',
    {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['notes'], params: DocParams, response: { 200: NoteListSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const id = (req.params as { id: string }).id;
      await assertVisibleDocument(app.db, id, user);
      return { items: await repo.listNotes(app.db, id, user.id) };
    },
  );

  app.post(
    '/documents/:id/notes',
    {
      config: { requires: ['notes.write'], scope: 'document' },
      schema: {
        tags: ['notes'],
        params: DocParams,
        body: CreateNoteBodySchema,
        response: { 201: NoteSchema },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof CreateNoteBodySchema>;
      if (!(await getDocument(app.db, id))) throw notFound('המסמך');
      const note = await withTransaction(app.db, async (tx) => {
        const n = await repo.createNote(tx, id, user.id, body);
        await audit(tx, {
          actorId: user.id,
          action: 'notes.write',
          entityType: 'note',
          entityId: n.id,
          before: null,
          after: { documentId: id, stepKey: n.stepKey },
          requestId: req.id,
          ip: req.ip,
        });
        return n;
      });
      reply.code(201);
      return note;
    },
  );

  app.delete(
    '/notes/:id',
    { config: { requires: ['notes.write'] }, schema: { tags: ['notes'], params: DocParams } },
    async (req, reply) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const note = await repo.getNote(app.db, id, user.id);
      if (!note) throw notFound('ההערה');
      if (note.authorId !== user.id && !user.permissions.has('notes.moderate')) throw forbidden();
      await withTransaction(app.db, async (tx) => {
        await repo.deleteNote(tx, id, user.id);
        await audit(tx, {
          actorId: user.id,
          action: 'notes.delete',
          entityType: 'note',
          entityId: id,
          before: { text: note.text, authorId: note.authorId },
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
    '/notes/:id/like',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['notes'], params: DocParams, response: { 200: NoteLikeResponseSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      return withTransaction(app.db, (tx) => repo.toggleLike(tx, id, user.id));
    },
  );
}
