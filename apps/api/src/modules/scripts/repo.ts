import type { Script, UpsertScriptBody } from '@wecom/shared';
import { httpError } from '../../lib/http.js';
import type { Tx } from '../../lib/sql.js';
import { visibleWhere } from '../../lib/visibility.js';
import { hasPublishedVersion, iso, type Q } from '../documents/repo.js';
import { htmlToText, textToHtml } from './html.js';

/** Scripts are `documents` rows with doc_type 'T' / kind 'text' since 0030; these routes are a deprecated adapter. */
const T = "d.deleted_at is null and d.doc_type = 'T' and d.kind = 'text'";

/**
 * The two boundaries every other reader of type-T rows applies (`search()`'s scripts group,
 * `loadGraph`'s script query). This deprecated adapter reads the *same* documents, so it gets
 * the same world-scope intersection and the same published-only rule — otherwise a scoped
 * reader sees here exactly the rows that are hidden from them in /search, /graph and /documents.
 */
export interface ScriptVisibility {
  worldScopes: readonly string[] | null;
  readUnpublished: boolean;
}

/** Unrestricted: for the write paths, where `config.scope: 'document'` has already run. */
const ALL: ScriptVisibility = { worldScopes: null, readUnpublished: true };

const scopeTerm = (vis: ScriptVisibility, param: string) =>
  `(${param}::text[] is null or exists (select 1 from document_worlds dws where dws.document_id = d.id and dws.world_slug = any(${param})))` +
  visibleWhere(vis.readUnpublished);

const toScript = (r: Record<string, unknown>): Script => ({
  id: r.id as string,
  title: r.title as string,
  text: htmlToText((r.body_html as string | null) ?? ''),
  tags: (r.tags as string[] | null) ?? [],
  updatedAt: iso(r.updated_at as Date)!,
});

export async function listScripts(
  q: Q,
  vis: ScriptVisibility = ALL,
): Promise<(Script & { usedIn: { documentId: string; title: string }[] })[]> {
  const scopes = vis.worldScopes ? [...vis.worldScopes] : null;
  const [s, refs] = await Promise.all([
    q.query(`select d.* from documents d where ${T} and ${scopeTerm(vis, '$1')} order by d.title`, [
      scopes,
    ]),
    q.query(
      `select l.to_document_id script_id, x.id, x.title from document_links l
         join documents x on x.id = l.from_document_id join documents d on d.id = l.to_document_id
        where l.type = 'link' and l.origin = 'explicit' and x.deleted_at is null and ${T}
          and ${scopeTerm(vis, '$1')}`,
      [scopes],
    ),
  ]);
  return s.rows.map((row) => ({
    ...toScript(row),
    usedIn: refs.rows
      .filter((x) => x.script_id === row.id)
      .map((x) => ({ documentId: x.id as string, title: x.title as string })),
  }));
}

export async function getScript(q: Q, id: string, vis: ScriptVisibility = ALL): Promise<Script | null> {
  const r = await q.query(
    `select d.* from documents d where d.id = $1 and ${T} and ${scopeTerm(vis, '$2')}`,
    [id, vis.worldScopes ? [...vis.worldScopes] : null],
  );
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
  /**
   * The adapter's body is plain text, so a write here rewrites `body_html` as
   * `textToHtml(htmlToText(current))`. For a document authored in the rich-text editor that is
   * silent, irreversible markup loss on a GET-then-PUT. Refuse rather than flatten: a body that
   * does not survive the round trip is not this endpoint's to edit.
   */
  const cur = await tx.query(`select d.body_html from documents d where d.id = $1 and ${T}`, [id]);
  if (!cur.rowCount) throw httpError(404, 'NOT_FOUND', 'התסריט לא נמצא');
  const existing = (cur.rows[0].body_html as string | null) ?? '';
  if (existing && textToHtml(htmlToText(existing)) !== existing)
    throw httpError(
      409,
      'RICH_BODY',
      'לפריט זה תוכן מעוצב שאינו נשמר דרך מסך התסריטים; ערוך אותו במסך המסמך',
      { documentId: id },
    );
  const r = await tx.query(
    `update documents d set title = $2, body_html = $3, tags = $4, updated_by = $5, updated_at = now(), etag = gen_random_uuid()::text
      where d.id = $1 and ${T} returning *`,
    [id, body.title, textToHtml(body.text), body.tags, userId],
  );
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'התסריט לא נמצא');
  return toScript(r.rows[0]);
}

export async function deleteScript(tx: Tx, id: string, userId: string): Promise<void> {
  // Same rule as `DELETE /documents/:id` (PRD §10): this adapter is the one other way into the
  // trash, and skipping the check here made it the front half of a path to permanent deletion.
  if (await hasPublishedVersion(tx, id))
    throw httpError(409, 'ONCE_PUBLISHED', 'תסריט שפורסם בעבר אינו נמחק; העבר אותו לארכיון', {
      allowed: ['invalid', 'archived'],
    });
  const r = await tx.query(
    `update documents d set deleted_at = now(), deleted_by = $2 where d.id = $1 and ${T} returning id`,
    [id, userId],
  );
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'התסריט לא נמצא');
  await tx.query('delete from pins where document_id = $1', [id]);
}
