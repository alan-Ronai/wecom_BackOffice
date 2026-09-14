import type pg from 'pg';
import type { z } from 'zod';
import type {
  Feedback,
  FeedbackRow,
  FeedbackStatus,
  TaxonomyResolver,
  FeedbackDetailSchema,
  FeedbackPatchBodySchema,
  FeedbackQuerySchema,
} from '@wecom/shared';
import { FEEDBACK_STATUSES } from '@wecom/shared';
import { httpError } from '../../lib/http.js';
import type { Tx } from '../../lib/sql.js';

/** W0 exports the schemas but not these inferred aliases; they stay local to the lane. */
export type FeedbackDetail = z.infer<typeof FeedbackDetailSchema>;
export type FeedbackPatchBody = z.infer<typeof FeedbackPatchBodySchema>;
export type FeedbackQuery = z.infer<typeof FeedbackQuerySchema>;

export type Q = pg.Pool | Tx;
const iso = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);

/* ── schema probes (W1/W2 columns may not exist yet) ─────────────────────── */
const columnCache = new Map<string, boolean>();
export async function hasColumn(q: Q, table: string, column: string): Promise<boolean> {
  const key = table + '.' + column;
  const hit = columnCache.get(key);
  if (hit !== undefined) return hit;
  const r = await q.query(
    `select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`,
    [table, column],
  );
  const ok = (r.rowCount ?? 0) > 0;
  columnCache.set(key, ok);
  return ok;
}
/** Tests that add columns mid-run can clear the memo. */
export const resetColumnCache = () => columnCache.clear();

export interface Context {
  documentVersion: number;
  worldSlug: string;
  docType: string | null;
  title: string;
}
/** Everything the agent must not type by hand (PRD §12 "מידע שיישמר אוטומטית"). */
export async function captureContext(
  q: Q,
  taxonomy: TaxonomyResolver,
  documentId: string,
): Promise<Context | null> {
  const docTypeExpr = (await hasColumn(q, 'documents', 'doc_type')) ? 'doc_type' : 'null::text as doc_type';
  const r = await q.query(
    `select title, current_version, category, ${docTypeExpr} from documents where id=$1 and deleted_at is null`,
    [documentId],
  );
  if (!r.rowCount) return null;
  const row = r.rows[0] as {
    title: string;
    current_version: number;
    category: string;
    doc_type: string | null;
  };
  const worlds = await taxonomy.worldsOf(documentId);
  return {
    documentVersion: row.current_version,
    worldSlug: worlds[0] ?? row.category,
    docType: row.doc_type,
    title: row.title,
  };
}

/* ── row mapping ─────────────────────────────────────────────────────────── */
const ROW_SELECT = `
  select f.*, u.display_name user_name, d.title document_title, a.display_name assignee_name
  from feedback f
  join users u on u.id=f.user_id
  join documents d on d.id=f.document_id
  left join users a on a.id=f.assignee_id`;

const toRow = (r: Record<string, unknown>): FeedbackRow => ({
  id: r.id as string,
  documentId: r.document_id as string,
  documentVersion: r.document_version as number,
  docType: (r.doc_type as FeedbackRow['docType']) ?? null,
  worldSlug: r.world_slug as string,
  stepKey: (r.step_key as string | null) ?? null,
  kind: r.kind as FeedbackRow['kind'],
  text: (r.text as string) ?? '',
  status: r.status as FeedbackStatus,
  userId: r.user_id as string,
  userName: (r.user_name as string) ?? 'משתמש',
  createdAt: iso(r.created_at as Date)!,
  assigneeId: (r.assignee_id as string | null) ?? null,
  decisionNote: (r.decision_note as string | null) ?? null,
  decidedBy: (r.decided_by as string | null) ?? null,
  decidedAt: iso(r.decided_at as Date | null),
  resolvedVersion: (r.resolved_version as number | null) ?? null,
  documentTitle: r.document_title as string,
  assigneeName: (r.assignee_name as string | null) ?? null,
});

/* ── writes ──────────────────────────────────────────────────────────────── */
export interface CreateInput {
  documentId: string;
  kind: Feedback['kind'];
  text: string;
  stepKey: string | null;
  userId: string;
  ctx: Context;
}
export async function createFeedback(tx: Tx, input: CreateInput): Promise<FeedbackRow> {
  const r = await tx.query(
    `insert into feedback(document_id, document_version, doc_type, world_slug, step_key, kind, text, user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [
      input.documentId,
      input.ctx.documentVersion,
      input.ctx.docType,
      input.ctx.worldSlug,
      input.stepKey,
      input.kind,
      input.text,
      input.userId,
    ],
  );
  return (await getFeedback(tx, r.rows[0].id as string))!;
}

export async function getFeedback(q: Q, id: string): Promise<FeedbackRow | null> {
  const r = await q.query(`${ROW_SELECT} where f.id=$1`, [id]);
  return r.rowCount ? toRow(r.rows[0]) : null;
}

export async function getFeedbackDetail(q: Q, id: string): Promise<FeedbackDetail | null> {
  const row = await getFeedback(q, id);
  if (!row) return null;
  const v = await q.query(
    `select version, label, created_at from document_versions where document_id=$1 and version >= $2 order by version`,
    [row.documentId, row.documentVersion],
  );
  const reported = v.rows.find((x) => x.version === row.documentVersion);
  return {
    ...row,
    versionLabel: reported ? (reported.label as string) || `v${row.documentVersion}` : null,
    href: `/doc/${row.documentId}` + (row.stepKey ? `/${row.stepKey}` : ''),
    laterVersions: v.rows
      .filter((x) => (x.version as number) > row.documentVersion)
      .map((x) => ({
        version: x.version as number,
        label: x.label as string,
        createdAt: iso(x.created_at as Date)!,
      })),
  };
}

const OPEN: FeedbackStatus[] = ['new', 'in_review', 'needs_update'];

export async function listFeedback(
  q: Q,
  query: FeedbackQuery,
): Promise<{ items: FeedbackRow[]; total: number; counts: Record<FeedbackStatus, number> }> {
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return '$' + params.length;
  };
  // Filters other than status also shape the tab badges, so build them first.
  const base: string[] = [];
  if (query.world) base.push(`f.world_slug = ${p(query.world)}`);
  if (query.kind) base.push(`f.kind = ${p(query.kind)}`);
  if (query.documentId) base.push(`f.document_id = ${p(query.documentId)}`);
  if (query.assigneeId) base.push(`f.assignee_id = ${p(query.assigneeId)}`);
  if (query.docType) base.push(`f.doc_type = ${p(query.docType)}`);
  const baseWhere = base.length ? 'where ' + base.join(' and ') : '';
  const c = await q.query(
    `select f.status, count(*)::int n from feedback f ${baseWhere} group by f.status`,
    params,
  );
  const counts = Object.fromEntries(FEEDBACK_STATUSES.map((s) => [s, 0])) as Record<
    FeedbackStatus,
    number
  >;
  for (const r of c.rows) counts[r.status as FeedbackStatus] = r.n as number;

  const where = [...base];
  if (query.status) where.push(`f.status = ${p(query.status)}`);
  const whereSql = where.length ? 'where ' + where.join(' and ') : '';
  const total = await q.query(`select count(*)::int n from feedback f ${whereSql}`, params);
  const offset = (query.page - 1) * query.pageSize;
  const rows = await q.query(
    `${ROW_SELECT} ${whereSql} order by f.created_at desc limit ${p(query.pageSize)} offset ${p(offset)}`,
    params,
  );
  return { items: rows.rows.map(toRow), total: total.rows[0].n as number, counts };
}

export async function patchFeedback(
  tx: Tx,
  id: string,
  body: FeedbackPatchBody,
  actorId: string,
): Promise<FeedbackRow | null> {
  const cur = await tx.query('select status from feedback where id=$1 for update', [id]);
  if (!cur.rowCount) return null;
  const closing = body.status === 'done' || body.status === 'no_change';
  await tx.query(
    `update feedback set
       status = coalesce($2, status),
       assignee_id = case when $3::boolean then $4::uuid else assignee_id end,
       decision_note = coalesce($5, decision_note),
       decided_by = case when $6::boolean then $7::uuid else decided_by end,
       decided_at = case when $6::boolean then now() else decided_at end
     where id=$1`,
    [
      id,
      body.status ?? null,
      body.assigneeId !== undefined,
      body.assigneeId ?? null,
      body.decisionNote ?? null,
      closing,
      actorId,
    ],
  );
  return getFeedback(tx, id);
}

/** Resolve one report against an existing published version (queue drawer). */
export async function resolveOne(
  tx: Tx,
  id: string,
  version: number,
  note: string | undefined,
  actorId: string,
): Promise<FeedbackRow | null> {
  const f = await tx.query('select document_id from feedback where id=$1 for update', [id]);
  if (!f.rowCount) return null;
  const v = await tx.query('select 1 from document_versions where document_id=$1 and version=$2', [
    f.rows[0].document_id,
    version,
  ]);
  if (!v.rowCount)
    throw httpError(400, 'UNKNOWN_VERSION', 'הגרסה שנבחרה אינה קיימת למסמך זה', { version });
  await tx.query(
    `update feedback set status='done', resolved_version=$2, decision_note=coalesce($3, decision_note),
       decided_by=$4, decided_at=now() where id=$1`,
    [id, version, note ?? null, actorId],
  );
  return getFeedback(tx, id);
}

/**
 * Close several reports with the version that was just published (called from the publish
 * route inside its transaction). Returns the ids actually closed; ids of other documents or
 * already-closed rows are ignored so a stale checkbox list can never close the wrong thing.
 */
export async function resolveFeedback(
  tx: Tx,
  ids: string[],
  documentId: string,
  version: number,
  actorId: string,
): Promise<string[]> {
  if (!ids.length) return [];
  const r = await tx.query(
    `update feedback set status='done', resolved_version=$3, decided_by=$4, decided_at=now()
     where id = any($1::uuid[]) and document_id=$2 and status <> 'done' returning id`,
    [ids, documentId, version, actorId],
  );
  return r.rows.map((x) => x.id as string);
}

export async function openForDocument(q: Q, documentId: string): Promise<FeedbackRow[]> {
  const r = await q.query(
    `${ROW_SELECT} where f.document_id=$1 and f.status = any($2::text[]) order by f.created_at`,
    [documentId, OPEN],
  );
  return r.rows.map(toRow);
}
