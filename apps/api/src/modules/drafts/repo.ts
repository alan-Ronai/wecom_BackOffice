import { httpError } from '../../lib/http.js';
import type { Tx } from '../../lib/sql.js';
import { iso, type Q } from '../documents/repo.js';

export interface DraftRow {
  draftKey: string;
  documentId: string | null;
  payload: Record<string, unknown>;
  updatedAt: string;
  otherEditors: { userId: string; name: string; updatedAt: string }[];
}

/** Other people with an unsaved draft on the same key in the last 30 minutes. */
export async function otherEditors(q: Q, draftKey: string, userId: string) {
  const r = await q.query(
    `select d.user_id, u.display_name, d.updated_at from drafts d join users u on u.id=d.user_id
     where d.draft_key=$1 and d.user_id<>$2 and d.updated_at > now() - interval '30 minutes'
     order by d.updated_at desc`,
    [draftKey, userId],
  );
  return r.rows.map((x) => ({
    userId: x.user_id as string,
    name: x.display_name as string,
    updatedAt: iso(x.updated_at)!,
  }));
}

export async function getDraft(q: Q, draftKey: string, userId: string): Promise<DraftRow | null> {
  const r = await q.query('select * from drafts where draft_key=$1 and user_id=$2', [draftKey, userId]);
  if (!r.rowCount) return null;
  const row = r.rows[0];
  return {
    draftKey,
    documentId: (row.document_id as string | null) ?? null,
    payload: (row.payload as Record<string, unknown>) ?? {},
    updatedAt: iso(row.updated_at)!,
    otherEditors: await otherEditors(q, draftKey, userId),
  };
}

export async function putDraft(
  tx: Tx,
  draftKey: string,
  documentId: string | null,
  userId: string,
  payload: Record<string, unknown>,
): Promise<DraftRow> {
  await tx.query(
    `insert into drafts(user_id, document_id, draft_key, payload) values ($1,$2,$3,$4)
     on conflict (user_id, draft_key) do update set payload=excluded.payload, document_id=excluded.document_id, updated_at=now()`,
    [userId, documentId, draftKey, JSON.stringify(payload)],
  );
  return (await getDraft(tx, draftKey, userId))!;
}

export async function deleteDraft(tx: Tx, draftKey: string, userId: string): Promise<void> {
  const r = await tx.query('delete from drafts where draft_key=$1 and user_id=$2 returning id', [
    draftKey,
    userId,
  ]);
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'הטיוטה לא נמצאה');
}

export async function listDrafts(q: Q, userId: string) {
  const r = await q.query(
    `select d.draft_key, d.document_id, d.updated_at,
       coalesce(doc.title, d.payload->>'title', d.draft_key) title
     from drafts d left join documents doc on doc.id=d.document_id
     where d.user_id=$1 order by d.updated_at desc`,
    [userId],
  );
  return r.rows.map((x) => ({
    draftKey: x.draft_key as string,
    documentId: (x.document_id as string | null) ?? null,
    title: x.title as string,
    updatedAt: iso(x.updated_at)!,
  }));
}
