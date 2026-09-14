import type { Script, UpsertScriptBody } from '@wecom/shared';
import { httpError } from '../../lib/http.js';
import type { Tx } from '../../lib/sql.js';
import { iso, type Q } from '../documents/repo.js';
import { htmlToText, textToHtml } from './html.js';

/** Scripts are `documents` rows with doc_type 'T' / kind 'text' since 0030; these routes are a deprecated adapter. */
const T = "d.deleted_at is null and d.doc_type = 'T' and d.kind = 'text'";
const toScript = (r: Record<string, unknown>): Script => ({
  id: r.id as string,
  title: r.title as string,
  text: htmlToText((r.body_html as string | null) ?? ''),
  tags: (r.tags as string[] | null) ?? [],
  updatedAt: iso(r.updated_at as Date)!,
});

export async function listScripts(
  q: Q,
): Promise<(Script & { usedIn: { documentId: string; title: string }[] })[]> {
  const [s, refs] = await Promise.all([
    q.query(`select d.* from documents d where ${T} order by d.title`),
    q.query(
      `select l.to_document_id script_id, x.id, x.title from document_links l
         join documents x on x.id = l.from_document_id join documents d on d.id = l.to_document_id
        where l.type = 'link' and l.origin = 'explicit' and x.deleted_at is null and ${T}`,
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
  const r = await q.query(`select d.* from documents d where d.id = $1 and ${T}`, [id]);
  return r.rowCount ? toScript(r.rows[0]) : null;
}

export async function createScript(tx: Tx, body: UpsertScriptBody, userId: string): Promise<Script> {
  const r = await tx.query(
    `insert into documents(slug, title, description, category, wave, priority, kind, status, doc_type, tags, body_html, current_version, created_by, updated_by)
     values ('script-' || left(replace(gen_random_uuid()::text, '-', ''), 8), $1, '', 'ops', 3, 'm', 'text', 'published', 'T', $2, $3, 1, $4, $4) returning *`,
    [body.title, body.tags, textToHtml(body.text), userId],
  );
  await tx.query(
    `insert into document_worlds(document_id, world_slug) values ($1, 'ops') on conflict do nothing`,
    [r.rows[0].id],
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
    `update documents d set title = $2, body_html = $3, tags = $4, updated_by = $5, updated_at = now(), etag = gen_random_uuid()::text
      where d.id = $1 and ${T} returning *`,
    [id, body.title, textToHtml(body.text), body.tags, userId],
  );
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'התסריט לא נמצא');
  return toScript(r.rows[0]);
}

export async function deleteScript(tx: Tx, id: string, userId: string): Promise<void> {
  const r = await tx.query(
    `update documents d set deleted_at = now(), deleted_by = $2 where d.id = $1 and ${T} returning id`,
    [id, userId],
  );
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'התסריט לא נמצא');
  await tx.query('delete from pins where document_id = $1', [id]);
}
