import type pg from 'pg';
import { createHash } from 'node:crypto';
import { htmlToText, sanitizeHtml, type SourceDocumentVersion } from '@wecom/shared';
import { httpError } from '../../lib/http.js';
import type { Tx } from '../../lib/sql.js';

type Q = pg.Pool | pg.PoolClient | Tx;
export interface SourceDocRow {
  documentId: string;
  html: string;
  text: string;
  version: number;
  etag: string;
  updatedById: string | null;
  updatedByName: string | null;
  updatedAt: string;
}
const SELECT = `select s.document_id, s.html, s.text, s.current_version, s.etag, s.updated_by, u.display_name, s.updated_at
  from source_documents s left join users u on u.id=s.updated_by`;
const row = (r: Record<string, unknown>): SourceDocRow => ({
  documentId: r.document_id as string,
  html: r.html as string,
  text: r.text as string,
  version: r.current_version as number,
  etag: r.etag as string,
  updatedById: (r.updated_by as string) ?? null,
  updatedByName: (r.display_name as string) ?? null,
  updatedAt: (r.updated_at as Date).toISOString(),
});

export async function getSourceDocument(q: Q, documentId: string): Promise<SourceDocRow | null> {
  const r = await q.query(`${SELECT} where s.document_id=$1`, [documentId]);
  return r.rowCount ? row(r.rows[0]) : null;
}

export async function currentSourceVersion(q: Q, documentId: string): Promise<number | null> {
  const r = await q.query('select current_version from source_documents where document_id=$1', [documentId]);
  return r.rowCount ? (r.rows[0].current_version as number) : null;
}

/** Sanitize → upsert → version row → rotate etag. Caller owns the transaction, audit, ingest and event. */
export async function saveSourceDocument(
  tx: Tx,
  documentId: string,
  input: {
    html: string;
    label?: string;
    authorId: string | null;
    sourceRevisionId?: string | null;
    ifMatch?: string;
  },
): Promise<SourceDocRow> {
  const doc = await tx.query('select id from documents where id=$1 and deleted_at is null', [documentId]);
  if (!doc.rowCount) throw httpError(404, 'NOT_FOUND', 'המסמך לא נמצא');
  const html = sanitizeHtml(input.html);
  const text = htmlToText(html);
  const hash = createHash('sha256').update(html, 'utf8').digest('hex');
  const cur = await tx.query(
    'select id, etag, current_version from source_documents where document_id=$1 for update',
    [documentId],
  );
  if (cur.rowCount && input.ifMatch && input.ifMatch !== cur.rows[0].etag)
    throw httpError(412, 'ETAG_MISMATCH', 'מסמך המקור השתנה בינתיים — טען מחדש ונסה שוב');
  const version = (cur.rowCount ? (cur.rows[0].current_version as number) : 0) + 1;
  const up = cur.rowCount
    ? await tx.query(
        `update source_documents set html=$2, text=$3, hash=$4, current_version=$5, etag=gen_random_uuid()::text, updated_by=$6, updated_at=now()
         where document_id=$1 returning id`,
        [documentId, html, text, hash, version, input.authorId],
      )
    : await tx.query(
        `insert into source_documents(document_id, html, text, hash, current_version, updated_by) values ($1,$2,$3,$4,$5,$6) returning id`,
        [documentId, html, text, hash, version, input.authorId],
      );
  await tx.query(
    `insert into source_document_versions(source_document_id, version, html, author_id, label, source_revision_id) values ($1,$2,$3,$4,$5,$6)`,
    [up.rows[0].id, version, html, input.authorId, input.label ?? '', input.sourceRevisionId ?? null],
  );
  return (await getSourceDocument(tx, documentId))!;
}

export async function listSourceVersions(q: Q, documentId: string): Promise<SourceDocumentVersion[]> {
  const r = await q.query(
    `select v.version, v.label, v.author_id, coalesce(u.display_name, 'מערכת') author_name, v.created_at, v.source_revision_id
     from source_document_versions v join source_documents s on s.id=v.source_document_id left join users u on u.id=v.author_id
     where s.document_id=$1 order by v.version desc`,
    [documentId],
  );
  return r.rows.map((x) => ({
    documentId,
    version: x.version as number,
    label: x.label as string,
    authorId: (x.author_id as string) ?? null,
    authorName: x.author_name as string,
    createdAt: (x.created_at as Date).toISOString(),
    sourceRevisionId: (x.source_revision_id as string) ?? null,
  }));
}

export async function getSourceVersion(
  q: Q,
  documentId: string,
  version: number,
): Promise<SourceDocRow | null> {
  const r = await q.query(
    `select s.document_id, v.html, v.author_id updated_by, u.display_name, v.created_at updated_at, v.version current_version, s.etag
     from source_document_versions v join source_documents s on s.id=v.source_document_id left join users u on u.id=v.author_id
     where s.document_id=$1 and v.version=$2`,
    [documentId, version],
  );
  if (!r.rowCount) return null;
  const x = r.rows[0];
  return { ...row({ ...x, text: htmlToText(x.html as string) }), version: x.current_version as number };
}
