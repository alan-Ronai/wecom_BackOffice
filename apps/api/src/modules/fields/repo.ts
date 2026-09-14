import type {
  CrmField,
  FieldPage,
  FieldRenameBodySchema,
  FieldRenameResultSchema,
  UpsertFieldBody,
} from '@wecom/shared';
import type { z } from 'zod';
import { httpError } from '../../lib/http.js';
import type { Tx } from '../../lib/sql.js';
import { getDocument, iso, recomputeDerived, type Q } from '../documents/repo.js';
import { publishDocument } from '../documents/publish.js';

type FieldRenameBody = z.infer<typeof FieldRenameBodySchema>;
type FieldRenameResult = z.infer<typeof FieldRenameResultSchema>;

/**
 * The caller's category scope as a SQL predicate over the `documents` alias. `null` scopes
 * make it a no-op. Field and block *pages* are cross-cutting read models with no document in
 * `params.id`, so `config.scope: 'document'` cannot reach them — scope is a repo argument.
 */
const scopeClause = (alias: string, param: string) =>
  `(${param}::text[] is null or ${alias}.category = any(${param}))`;

const toField = (r: Record<string, unknown>): CrmField => ({
  name: r.name as string,
  status: r.status as CrmField['status'],
  renamedTo: (r.renamed_to as string | null) ?? undefined,
  path: (r.path as string | null) ?? '',
  effectiveFrom: iso(r.effective_from as Date | null) ?? undefined,
  note: (r.note as string | null) ?? undefined,
  updatedAt: iso(r.updated_at as Date)!,
});

export async function listFields(q: Q): Promise<(CrmField & { usedIn: number })[]> {
  const r = await q.query(
    `select f.*, coalesce(c.n,0)::int used_in from crm_fields f
     left join (select r.field_name, count(distinct s.document_id) n from step_field_refs r
                join steps s on s.id=r.step_id join documents d on d.id=s.document_id and d.deleted_at is null
                group by 1) c on c.field_name=f.name
     where f.deleted_at is null order by f.name`,
  );
  return r.rows.map((row) => ({ ...toField(row), usedIn: row.used_in as number }));
}

export async function getField(q: Q, name: string): Promise<CrmField | null> {
  const r = await q.query('select * from crm_fields where name=$1 and deleted_at is null', [name]);
  return r.rowCount ? toField(r.rows[0]) : null;
}

export async function fieldUsage(q: Q, name: string, scopes: string[] | null = null) {
  const r = await q.query(
    `select d.id, d.title, array_agg(s.step_key order by s.position) keys
     from step_field_refs f join steps s on s.id=f.step_id join documents d on d.id=s.document_id
     where f.field_name=$1 and d.deleted_at is null and ${scopeClause('d', '$2')}
     group by d.id, d.title order by d.title`,
    [name, scopes],
  );
  return r.rows.map((x) => ({
    documentId: x.id as string,
    title: x.title as string,
    stepKeys: x.keys as string[],
  }));
}

/** Documents that mention the field in their derived text — the set whose chips must re-render. */
export async function documentsMentioning(q: Q, name: string): Promise<string[]> {
  const r = await q.query(
    `select distinct d.id from documents d
     where d.deleted_at is null and (d.search_text ilike '%' || $1 || '%'
       or exists (select 1 from step_field_refs f join steps s on s.id=f.step_id where s.document_id=d.id and f.field_name=$1))`,
    [name],
  );
  return r.rows.map((x) => x.id as string);
}

export async function upsertField(tx: Tx, body: UpsertFieldBody, _userId: string | null): Promise<CrmField> {
  await tx.query(
    `insert into crm_fields(name, status, renamed_to, path, note) values ($1,$2,$3,$4,$5)
     on conflict (name) do update set status=excluded.status, renamed_to=excluded.renamed_to,
       path=excluded.path, note=excluded.note, updated_at=now(), deleted_at=null, deleted_by=null`,
    [body.name, body.status, body.renamedTo ?? null, body.path ?? '', body.note ?? null],
  );
  // A newly registered field must be detected in the documents that already mention it.
  for (const id of await documentsMentioning(tx, body.name)) {
    const doc = await getDocument(tx, id);
    if (doc) await recomputeDerived(tx, doc);
  }
  return (await getField(tx, body.name))!;
}

export async function deleteField(tx: Tx, name: string, userId: string): Promise<string[]> {
  const affected = (await fieldUsage(tx, name)).map((u) => u.documentId);
  const r = await tx.query(
    'update crm_fields set deleted_at=now(), deleted_by=$2 where name=$1 and deleted_at is null returning name',
    [name, userId],
  );
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'השדה לא נמצא');
  await tx.query('delete from step_field_refs where field_name=$1', [name]);
  return affected;
}

/* ── Stage 4: field page ────────────────────────────────────────────────── */

/**
 * Every step that mentions the field, with the text it is mentioned in. Block-backed
 * steps take their actions from the block, the same way `stepText` assembles them.
 */
export async function fieldUsageRows(
  q: Q,
  name: string,
  scopes: string[] | null = null,
): Promise<FieldPage['usage']> {
  const r = await q.query(
    `select d.id, d.title, d.category, s.step_key, s.num, s.title step_title,
            concat_ws(' · ', s.title, coalesce(
              (select string_agg(ba.text, ' · ' order by ba.position) from block_actions ba where ba.block_id = s.block_id),
              (select string_agg(a.text, ' · ' order by a.position) from step_actions a where a.step_id = s.id),
              '')) as text
       from step_field_refs r
       join steps s on s.id = r.step_id
       join documents d on d.id = s.document_id and d.deleted_at is null
      where r.field_name = $1 and ${scopeClause('d', '$2')}
      order by d.title, s.position`,
    [name, scopes],
  );
  return r.rows.map((x) => ({
    documentId: x.id as string,
    title: x.title as string,
    category: x.category as FieldPage['usage'][number]['category'],
    stepKey: x.step_key as string,
    stepNum: x.num as string,
    stepTitle: x.step_title as string,
    text: x.text as string,
  }));
}

export async function fieldHistory(q: Q, name: string): Promise<FieldPage['history']> {
  const r = await q.query(
    `select l.at, u.display_name, l.action, l.before, l.after
       from audit_log l left join users u on u.id = l.actor_id
      where l.entity_type = 'crm_field' and l.entity_id = $1
      order by l.at desc limit 50`,
    [name],
  );
  return r.rows.map((x) => ({
    at: iso(x.at as Date)!,
    actorName: (x.display_name as string | null) ?? null,
    action: x.action as string,
    before: (x.before as unknown) ?? null,
    after: (x.after as unknown) ?? null,
  }));
}

/** What a writer has to know before using the field: it moved, it is on the way out, or it is new. */
export function fieldAlerts(field: CrmField): FieldPage['alerts'] {
  const out: FieldPage['alerts'] = [];
  if (field.status === 'renamed')
    out.push({ kind: 'renamed', message: `השדה שונה לשם "${field.renamedTo ?? '?'}" — עדכן את ההפניות` });
  if (field.status === 'retired') out.push({ kind: 'retired', message: 'השדה הוצא משימוש ב-CRM' });
  if (field.status === 'new') out.push({ kind: 'new', message: 'שדה חדש — ודא שהוא קיים בסביבת הייצור' });
  if (!field.path.trim())
    out.push({ kind: 'unknown', message: 'הנתיב של השדה ב-CRM לא ידוע — הוסף אותו כדי שהצ׳יפ יוביל לשם' });
  return out;
}

export async function fieldPage(
  q: Q,
  name: string,
  scopes: string[] | null = null,
): Promise<FieldPage | null> {
  const field = await getField(q, name);
  if (!field) return null;
  const [usage, history] = await Promise.all([fieldUsageRows(q, name, scopes), fieldHistory(q, name)]);
  return {
    field,
    usage,
    documents: new Set(usage.map((u) => u.documentId)).size,
    history,
    alerts: fieldAlerts(field),
  };
}

/* ── Stage 4: field rename ──────────────────────────────────────────────── */

/** Columns whose free text can carry a CRM field name, scoped to one document set. */
const REWRITES = [
  `update steps set title = replace(title, $2, $3), description = replace(description, $2, $3),
          hint = replace(hint, $2, $3), script = replace(script, $2, $3)
     where document_id = any($1)`,
  `update step_actions a set text = replace(a.text, $2, $3)
     from steps s where s.id = a.step_id and s.document_id = any($1)`,
  `update step_outcomes o set text = replace(o.text, $2, $3)
     from steps s where s.id = o.step_id and s.document_id = any($1)`,
  `update step_branches b set question = replace(b.question, $2, $3)
     from steps s where s.id = b.step_id and s.document_id = any($1)`,
  `update step_branch_options o set label = replace(o.label, $2, $3), text = replace(o.text, $2, $3)
     from step_branches b join steps s on s.id = b.step_id
    where b.id = o.branch_id and s.document_id = any($1)`,
];

/**
 * Renames a CRM field: the new name becomes the live field, the old one stays behind as
 * `renamed -> newName` so nothing dangles, and (when `updateReferences`) every step text in
 * the documents that used it is rewritten and republished — one version per document.
 */
export async function renameField(
  tx: Tx,
  name: string,
  body: FieldRenameBody,
  userId: string | null,
): Promise<{ result: FieldRenameResult; affected: string[] }> {
  const old = await getField(tx, name);
  if (!old) throw httpError(404, 'NOT_FOUND', 'השדה לא נמצא');
  const newName = body.newName.trim();
  if (!newName) throw httpError(400, 'BAD_REQUEST', 'שם חדש הוא שדה חובה');
  if (newName === name) throw httpError(400, 'BAD_REQUEST', 'השם החדש זהה לשם הנוכחי');
  const affected = [...new Set((await fieldUsageRows(tx, name)).map((u) => u.documentId))];

  await tx.query(
    `insert into crm_fields(name, status, path, note, created_by, updated_by)
     values ($1,'ok',$2,$3,$4,$4)
     on conflict (name) do update set status='ok', renamed_to=null, deleted_at=null, deleted_by=null,
       path=coalesce(nullif(crm_fields.path,''), excluded.path), updated_at=now(), updated_by=$4`,
    [newName, old.path, old.note ?? null, userId],
  );
  await tx.query(
    `update crm_fields set status='renamed', renamed_to=$2, updated_at=now(), updated_by=$3 where name=$1`,
    [name, newName, userId],
  );

  let versionsCreated = 0;
  if (body.updateReferences && affected.length) {
    for (const sql of REWRITES) await tx.query(sql, [affected, name, newName]);
    for (const id of affected) {
      const doc = await getDocument(tx, id);
      if (!doc) continue;
      await recomputeDerived(tx, doc);
      await publishDocument(tx, id, { actorId: userId, label: body.label });
      versionsCreated++;
    }
  }
  const field = (await getField(tx, newName))!;
  return {
    result: { updatedDocuments: body.updateReferences ? affected.length : 0, versionsCreated, field },
    affected,
  };
}
