import type { Script, UpsertScriptBody } from '@wecom/shared';
import { httpError } from '../../lib/http.js';
import type { Tx } from '../../lib/sql.js';
import { iso, type Q } from '../documents/repo.js';

const toScript = (r: Record<string, unknown>): Script => ({
  id: r.id as string,
  title: r.title as string,
  text: r.text as string,
  tags: (r.tags as string[] | null) ?? [],
  updatedAt: iso(r.updated_at as Date)!,
});

export async function listScripts(
  q: Q,
): Promise<(Script & { usedIn: { documentId: string; title: string }[] })[]> {
  const [s, refs] = await Promise.all([
    q.query('select * from scripts where deleted_at is null order by title'),
    q.query(
      `select r.script_id, d.id, d.title from script_refs r join documents d on d.id=r.document_id
       where d.deleted_at is null`,
    ),
  ]);
  return s.rows.map((row) => ({
    ...toScript(row),
    usedIn: refs.rows
      .filter((x) => x.script_id === row.id)
      .map((x) => ({ documentId: x.id as string, title: x.title as string })),
  }));
}

export async function getScript(q: Q, id: string): Promise<Script | null> {
  const r = await q.query('select * from scripts where id=$1 and deleted_at is null', [id]);
  return r.rowCount ? toScript(r.rows[0]) : null;
}

export async function createScript(tx: Tx, body: UpsertScriptBody, userId: string): Promise<Script> {
  const r = await tx.query(
    'insert into scripts(title, text, tags, created_by, updated_by) values ($1,$2,$3,$4,$4) returning *',
    [body.title, body.text, body.tags, userId],
  );
  return toScript(r.rows[0]);
}

export async function updateScript(
  tx: Tx,
  id: string,
  body: UpsertScriptBody,
  userId: string,
): Promise<Script> {
  const r = await tx.query(
    'update scripts set title=$2, text=$3, tags=$4, updated_by=$5, updated_at=now() where id=$1 and deleted_at is null returning *',
    [id, body.title, body.text, body.tags, userId],
  );
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'התסריט לא נמצא');
  return toScript(r.rows[0]);
}

export async function deleteScript(tx: Tx, id: string, userId: string): Promise<void> {
  const r = await tx.query(
    'update scripts set deleted_at=now(), deleted_by=$2 where id=$1 and deleted_at is null returning id',
    [id, userId],
  );
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'התסריט לא נמצא');
}
