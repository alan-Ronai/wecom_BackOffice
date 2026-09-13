import type { CrmField, UpsertFieldBody } from '@wecom/shared';
import { httpError } from '../../lib/http.js';
import type { Tx } from '../../lib/sql.js';
import { getDocument, iso, recomputeDerived, type Q } from '../documents/repo.js';

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

export async function fieldUsage(q: Q, name: string) {
  const r = await q.query(
    `select d.id, d.title, array_agg(s.step_key order by s.position) keys
     from step_field_refs f join steps s on s.id=f.step_id join documents d on d.id=s.document_id
     where f.field_name=$1 and d.deleted_at is null group by d.id, d.title order by d.title`,
    [name],
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

export async function upsertField(
  tx: Tx,
  body: UpsertFieldBody,
  _userId: string | null,
): Promise<CrmField> {
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
