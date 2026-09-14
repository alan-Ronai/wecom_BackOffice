import type { DataFile, DataPreview } from '@wecom/shared';
import type { Q } from '../documents/repo.js';
import { iso } from '../documents/repo.js';
import { toColumnMapping, type MappingRecord } from './mapping.js';
import { visibleWhere } from '../../lib/visibility.js';

/**
 * `columns` is a legal but unquoted-unsafe identifier, so it is quoted everywhere.
 *
 * `linkedDocuments` counts *documents*, so W2 §10 applies to it: for a reader it counts only
 * published ones, or the number would say how many drafts hang off a source.
 */
const fileSelect = (readUnpublished: boolean): string => {
  const vis = visibleWhere(readUnpublished);
  return `
  select s.id, s.title, s.kind, s."columns", s.mapping, s.sync_state, s.last_synced_at,
         (select count(*)::int from (
            select l.from_document_id id from document_links l
              join documents d on d.id = l.from_document_id and d.deleted_at is null${vis}
             where l.to_source_id = s.id
            union
            select d.id from documents d where d.source_id = s.id and d.deleted_at is null${vis}) x) linked_documents,
         (select count(*)::int from suggestions g
            join source_revisions sr on sr.id = g.source_revision_id
           where sr.source_id = s.id and g.status = 'pending') pending_suggestions,
         coalesce((select jsonb_array_length(r.data_rows) from source_revisions r
                    where r.source_id = s.id and r.data_rows is not null
                    order by r.imported_at desc limit 1), 0) rows,
         (select r.data_rows -> 0 from source_revisions r
           where r.source_id = s.id and r.data_rows is not null
           order by r.imported_at desc limit 1) first_row
    from sources s
   where s.deleted_at is null and s.kind in ('json','csv')`;
};

const toDataFile = (r: Record<string, unknown>): DataFile => {
  const columns = (r.columns as string[] | null) ?? [];
  return {
    sourceId: r.id as string,
    title: r.title as string,
    kind: r.kind as DataFile['kind'],
    rows: Number(r.rows ?? 0),
    columns,
    mapping: toColumnMapping(
      columns,
      (r.mapping as MappingRecord | null) ?? null,
      (r.first_row as Record<string, string> | null) ?? null,
    ),
    syncState: r.sync_state as DataFile['syncState'],
    lastSyncedAt: iso(r.last_synced_at as Date | null),
    linkedDocuments: Number(r.linked_documents ?? 0),
    pendingSuggestions: Number(r.pending_suggestions ?? 0),
  };
};

export async function listDataFiles(q: Q, readUnpublished = true): Promise<DataFile[]> {
  const r = await q.query(`${fileSelect(readUnpublished)} order by s.updated_at desc`);
  return r.rows.map(toDataFile);
}

export async function getDataFile(q: Q, sourceId: string, readUnpublished = true): Promise<DataFile | null> {
  const r = await q.query(`${fileSelect(readUnpublished)} and s.id = $1`, [sourceId]);
  return r.rowCount ? toDataFile(r.rows[0]) : null;
}

export interface StoredRows {
  revisionId: string;
  rows: Record<string, string>[];
}

/** The rows of the newest revision that still carries them (a docx revision carries none). */
export async function latestRows(q: Q, sourceId: string): Promise<StoredRows | null> {
  const r = await q.query(
    `select id, data_rows from source_revisions
      where source_id = $1 and data_rows is not null order by imported_at desc limit 1`,
    [sourceId],
  );
  if (!r.rowCount) return null;
  return {
    revisionId: r.rows[0].id as string,
    rows: (r.rows[0].data_rows as Record<string, string>[]) ?? [],
  };
}

export async function previewRows(q: Q, sourceId: string, limit: number): Promise<DataPreview | null> {
  const file = await getDataFile(q, sourceId);
  if (!file) return null;
  const stored = await latestRows(q, sourceId);
  const rows = (stored?.rows ?? []).slice(0, limit);
  return { columns: file.columns, rows, total: stored?.rows.length ?? 0 };
}

export async function saveDataRows(q: Q, revisionId: string, rows: Record<string, string>[]): Promise<void> {
  await q.query('update source_revisions set data_rows = $2 where id = $1', [
    revisionId,
    JSON.stringify(rows),
  ]);
}

export async function saveColumnsAndMapping(
  q: Q,
  sourceId: string,
  columns: string[],
  mapping: MappingRecord,
  actorId: string | null,
): Promise<void> {
  await q.query(
    'update sources set "columns" = $2, mapping = $3, updated_at = now(), updated_by = $4 where id = $1',
    [sourceId, columns, JSON.stringify(mapping), actorId],
  );
}

export const mappingRecordOf = async (q: Q, sourceId: string): Promise<MappingRecord> => {
  const r = await q.query('select mapping from sources where id = $1', [sourceId]);
  return ((r.rows[0]?.mapping as MappingRecord | null) ?? {}) as MappingRecord;
};
