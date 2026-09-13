import type { Note } from '@wecom/shared';
import { httpError } from '../../lib/http.js';
import type { Tx } from '../../lib/sql.js';
import { iso, type Q } from '../documents/repo.js';

const toNote = (r: Record<string, unknown>): Note => ({
  id: r.id as string,
  documentId: r.document_id as string,
  stepKey: (r.step_key as string | null) ?? null,
  authorId: r.author_id as string,
  authorName: (r.display_name as string | null) ?? 'מערכת',
  text: r.text as string,
  likes: Number(r.likes ?? 0),
  likedByMe: Boolean(r.liked_by_me),
  createdAt: iso(r.created_at as Date)!,
});

const SELECT = `select n.*, u.display_name,
    (select count(*)::int from note_likes l where l.note_id=n.id) likes,
    exists (select 1 from note_likes l where l.note_id=n.id and l.user_id=$2) liked_by_me
  from notes n join users u on u.id=n.author_id`;

export async function listNotes(q: Q, documentId: string, userId: string): Promise<Note[]> {
  const r = await q.query(`${SELECT} where n.document_id=$1 and n.deleted_at is null order by n.created_at`, [
    documentId,
    userId,
  ]);
  return r.rows.map(toNote);
}

export async function getNote(q: Q, id: string, userId: string): Promise<Note | null> {
  const r = await q.query(`${SELECT} where n.id=$1 and n.deleted_at is null`, [id, userId]);
  return r.rowCount ? toNote(r.rows[0]) : null;
}

export async function createNote(
  tx: Tx,
  documentId: string,
  userId: string,
  body: { stepKey: string | null; text: string },
): Promise<Note> {
  const r = await tx.query(
    'insert into notes(document_id, step_key, author_id, text) values ($1,$2,$3,$4) returning id',
    [documentId, body.stepKey, userId, body.text],
  );
  return (await getNote(tx, r.rows[0].id as string, userId))!;
}

export async function deleteNote(tx: Tx, id: string, userId: string): Promise<void> {
  const r = await tx.query(
    'update notes set deleted_at=now() where id=$1 and deleted_at is null returning id',
    [id],
  );
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'ההערה לא נמצאה');
  void userId;
}

/** Toggle the current user's like; returns the new counters. */
export async function toggleLike(
  tx: Tx,
  id: string,
  userId: string,
): Promise<{ likes: number; likedByMe: boolean }> {
  const exists = await tx.query('select 1 from notes where id=$1 and deleted_at is null', [id]);
  if (!exists.rowCount) throw httpError(404, 'NOT_FOUND', 'ההערה לא נמצאה');
  const removed = await tx.query('delete from note_likes where note_id=$1 and user_id=$2 returning note_id', [
    id,
    userId,
  ]);
  if (!removed.rowCount)
    await tx.query('insert into note_likes(note_id, user_id) values ($1,$2) on conflict do nothing', [
      id,
      userId,
    ]);
  const likes = (await tx.query('select count(*)::int n from note_likes where note_id=$1', [id])).rows[0]
    .n as number;
  return { likes, likedByMe: !removed.rowCount };
}
