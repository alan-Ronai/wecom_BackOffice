import type pg from 'pg';
import type { TrashItem } from '@wecom/shared';
import { httpError } from '../../lib/http.js';
import type { Tx } from '../../lib/sql.js';
import { getDocument, hasPublishedVersion, iso, recomputeDerived, type Q } from '../documents/repo.js';
import { CATEGORY_LABELS, sourceFile } from '../search/repo.js';

export type TrashType = TrashItem['type'];
export const TRASH_TYPES: TrashType[] = ['document', 'block', 'field', 'script'];

const purgeAt = (deletedAt: Date | string, days: number) =>
  new Date(new Date(deletedAt).getTime() + days * 86400_000).toISOString();

const emptyImpact = { brokenLinks: 0, documents: [] as { id: string; title: string }[] };

export async function listTrash(q: Q, days: number): Promise<TrashItem[]> {
  const items: TrashItem[] = [];

  const docs = await q.query(
    `select d.id, d.title, d.category, d.doc_type, d.current_version, d.deleted_at, u.display_name deleted_by,
            (select count(*)::int from steps s where s.document_id=d.id) steps
     from documents d left join users u on u.id=d.deleted_by
     where d.deleted_at is not null order by d.deleted_at desc`,
  );
  for (const d of docs.rows) {
    const links = await q.query(
      `select distinct src.id, src.title from document_links l join documents src on src.id=l.from_document_id
       where l.to_document_id=$1 and src.deleted_at is null order by src.title`,
      [d.id],
    );
    items.push({
      type: 'document',
      id: d.id,
      title: d.title,
      meta: [
        sourceFile(d.category as string),
        CATEGORY_LABELS[d.category as string] ?? d.category,
        d.doc_type,
        'v' + d.current_version,
        d.steps + ' שלבים',
      ].join(' · '),
      deletedBy: d.deleted_by ?? 'מערכת',
      deletedAt: iso(d.deleted_at)!,
      purgeAt: purgeAt(d.deleted_at, days),
      impact: {
        brokenLinks: links.rowCount ?? 0,
        documents: links.rows.map((x) => ({ id: x.id as string, title: x.title as string })),
      },
    });
  }

  const blocks = await q.query(
    `select b.id, b.slug, b.title, b.kind, b.deleted_at, u.display_name deleted_by
     from blocks b left join users u on u.id=b.deleted_by where b.deleted_at is not null order by b.deleted_at desc`,
  );
  for (const b of blocks.rows) {
    const used = await q.query(
      `select distinct d.id, d.title from steps s join documents d on d.id=s.document_id
       where (s.block_id=$1 or $1 = any(s.block_refs)) and d.deleted_at is null order by d.title`,
      [b.id],
    );
    items.push({
      type: 'block',
      id: b.id,
      title: 'בלוק משותף: ' + b.title,
      meta: `shared/${b.slug} · ${b.kind === 'script' ? 'תסריט' : 'שלב'} · היה ב-${used.rowCount} מסמכים`,
      deletedBy: b.deleted_by ?? 'מערכת',
      deletedAt: iso(b.deleted_at)!,
      purgeAt: purgeAt(b.deleted_at, days),
      impact: {
        brokenLinks: used.rowCount ?? 0,
        documents: used.rows.map((x) => ({ id: x.id as string, title: x.title as string })),
      },
    });
  }

  const fields = await q.query(
    `select f.name, f.status, f.deleted_at, u.display_name deleted_by from crm_fields f
     left join users u on u.id=f.deleted_by where f.deleted_at is not null order by f.deleted_at desc`,
  );
  for (const f of fields.rows)
    items.push({
      type: 'field',
      id: f.name,
      title: f.name,
      meta: 'crm-fields.json · ' + f.status,
      deletedBy: f.deleted_by ?? 'מערכת',
      deletedAt: iso(f.deleted_at)!,
      purgeAt: purgeAt(f.deleted_at, days),
      impact: emptyImpact,
    });

  // Scripts are type-T documents since 0030, so they are already listed above as documents.

  return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

const TABLE: Record<TrashType, { table: string; key: string }> = {
  document: { table: 'documents', key: 'id' },
  block: { table: 'blocks', key: 'id' },
  field: { table: 'crm_fields', key: 'name' },
  /** Scripts are documents since 0030; old /trash/script/:id links keep working. */
  script: { table: 'documents', key: 'id' },
};

export async function restore(tx: Tx, type: TrashType, id: string, userId: string): Promise<void> {
  const t = TABLE[type];
  const r = await tx.query(
    `update ${t.table} set deleted_at=null, deleted_by=null where ${t.key}=$1 and deleted_at is not null returning ${t.key}`,
    [id],
  );
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'הפריט לא נמצא בסל המיחזור');
  if (type === 'document') {
    const doc = await getDocument(tx, id);
    if (doc) {
      // Version number unchanged: restoring is not a new edition, only a bookkeeping entry.
      await tx.query(
        `insert into document_versions(document_id, version, snapshot, author_id, label, kind)
         values ($1,$2,$3,$4,'שוחזר מסל מיחזור','system')
         on conflict (document_id, version) do update set kind='system', label='שוחזר מסל מיחזור',
           snapshot=excluded.snapshot, author_id=excluded.author_id, created_at=now()`,
        [id, doc.currentVersion, JSON.stringify(doc), userId],
      );
      await recomputeDerived(tx, doc);
    }
  }
  if (type === 'block' || type === 'field') {
    const affected = await tx.query(
      type === 'block'
        ? `select distinct s.document_id id from steps s where s.block_id=$1 or $1 = any(s.block_refs)`
        : `select distinct d.id from documents d where d.deleted_at is null and d.search_text ilike '%' || $1 || '%'`,
      [id],
    );
    for (const row of affected.rows) {
      const doc = await getDocument(tx, row.id as string);
      if (doc) await recomputeDerived(tx, doc);
    }
  }
}

/**
 * PRD §10 / spec §2.2: an item that was ever published is never hard-deleted, even from the
 * trash. `purgeExpired` has carried this rule since wave 2; the two operator-facing routes
 * (`DELETE /trash/:type/:id`, `DELETE /trash`) did not, which made them a route to permanent,
 * unrecoverable loss of published content and its whole `document_versions` history.
 *
 * `script` maps onto `documents` (0030), so it is guarded too.
 */
export const isOncePublished = async (q: Q, type: TrashType, id: string): Promise<boolean> =>
  (type === 'document' || type === 'script') && (await hasPublishedVersion(q, id));

export const oncePublishedError = () =>
  httpError(409, 'ONCE_PUBLISHED', 'פריט שפורסם בעבר אינו נמחק לצמיתות; הוא נשאר בסל המיחזור', {
    allowed: ['invalid', 'archived'],
  });

/**
 * Hard-delete one trashed item. Returns false when the once-published rule skipped it, which
 * only happens under `{ skipOncePublished: true }` — empty-trash passes it so one protected
 * document does not abort the whole operation; the single-item route lets the 409 through.
 */
export async function purge(
  tx: Tx,
  type: TrashType,
  id: string,
  opts: { skipOncePublished?: boolean } = {},
): Promise<boolean> {
  if (await isOncePublished(tx, type, id)) {
    if (opts.skipOncePublished) return false;
    throw oncePublishedError();
  }
  const t = TABLE[type];
  if (type === 'block') {
    await tx.query('update steps set block_id=null where block_id=$1', [id]);
    await tx.query('update steps set block_refs = array_remove(block_refs, $1) where $1 = any(block_refs)', [
      id,
    ]);
  }
  const r = await tx.query(
    `delete from ${t.table} where ${t.key}=$1 and deleted_at is not null returning ${t.key}`,
    [id],
  );
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'הפריט לא נמצא בסל המיחזור');
  return true;
}

/** Hard delete everything whose retention window has elapsed. Returns the number of rows removed. */
export async function purgeExpired(pool: pg.Pool, days: number): Promise<number> {
  const cutoff = `now() - interval '${Number(days)} days'`;
  let n = 0;
  const blocks = await pool.query(
    `select id from blocks where deleted_at is not null and deleted_at < ${cutoff}`,
  );
  for (const b of blocks.rows) {
    await pool.query('update steps set block_id=null where block_id=$1', [b.id]);
    await pool.query(
      'update steps set block_refs = array_remove(block_refs, $1) where $1 = any(block_refs)',
      [b.id],
    );
  }
  for (const table of ['documents', 'blocks', 'crm_fields']) {
    // PRD §10: an item that was ever published is never hard-deleted, even from the trash.
    const guard =
      table === 'documents'
        ? ` and not exists (select 1 from document_versions v where v.document_id=documents.id and v.kind='published')`
        : '';
    const r = await pool.query(
      `delete from ${table} where deleted_at is not null and deleted_at < ${cutoff}${guard}`,
    );
    n += r.rowCount ?? 0;
  }
  return n;
}
