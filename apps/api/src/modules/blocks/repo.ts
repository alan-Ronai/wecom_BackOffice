import type { Block, BlockPage, UpsertBlockBody } from '@wecom/shared';
import { httpError } from '../../lib/http.js';
import type { Tx } from '../../lib/sql.js';
import { getDocument, iso, loadBlocksMap, recomputeDerived, slugify, type Q } from '../documents/repo.js';

export async function listBlocks(q: Q): Promise<Block[]> {
  const map = await loadBlocksMap(q);
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, 'he'));
}

export const getBlock = async (q: Q, id: string): Promise<Block | null> =>
  (await loadBlocksMap(q)).get(id) ?? null;

const writeChildren = async (tx: Tx, id: string, body: UpsertBlockBody) => {
  await tx.query('delete from block_actions where block_id=$1', [id]);
  await tx.query('delete from block_outcomes where block_id=$1', [id]);
  for (const [i, a] of body.actions.entries())
    await tx.query('insert into block_actions(block_id, position, text) values ($1,$2,$3)', [id, i, a.text]);
  for (const [i, o] of body.outcomes.entries())
    await tx.query(
      'insert into block_outcomes(block_id, position, kind, text, goto_step_key) values ($1,$2,$3,$4,$5)',
      [id, i, o.kind, o.text, o.goto ?? null],
    );
};

export interface PublishBlockOptions {
  actorId: string | null;
  label: string;
}

/**
 * Cross-lane block publish (canonical name, L2-owned): bump `blocks.current_version` and freeze
 * the assembled block into `block_versions`. Runs inside the caller's transaction.
 */
export async function publishBlock(
  tx: Tx,
  block: Block | string,
  opts: PublishBlockOptions,
): Promise<{ block: Block; version: number }> {
  const id = typeof block === 'string' ? block : block.id;
  const cur = await tx.query(
    'select current_version from blocks where id=$1 and deleted_at is null for update',
    [id],
  );
  if (!cur.rowCount) throw httpError(404, 'NOT_FOUND', 'הבלוק לא נמצא');
  const version = (cur.rows[0].current_version as number) + 1;
  await tx.query('update blocks set current_version=$2, updated_by=$3, updated_at=now() where id=$1', [
    id,
    version,
    opts.actorId,
  ]);
  const updated = (await getBlock(tx, id))!;
  await tx.query(
    'insert into block_versions(block_id, version, snapshot, author_id, label) values ($1,$2,$3,$4,$5)',
    [id, version, JSON.stringify(updated), opts.actorId, opts.label],
  );
  return { block: updated, version };
}

export async function createBlock(tx: Tx, body: UpsertBlockBody, userId: string | null): Promise<Block> {
  const r = await tx.query(
    `insert into blocks(slug, title, kind, description, script, current_version, created_by, updated_by)
     values ($1,$2,$3,$4,$5,0,$6,$6) returning id`,
    [
      body.slug ?? slugify(body.title),
      body.title,
      body.kind,
      body.description ?? null,
      body.script ?? null,
      userId,
    ],
  );
  const id = r.rows[0].id as string;
  await writeChildren(tx, id, body);
  const { block } = await publishBlock(tx, id, { actorId: userId, label: body.label ?? 'יצירה' });
  return block;
}

/** Documents whose steps embed (`block_id`) or reference (`block_refs`) the block. */
export async function blockUsage(q: Q, id: string) {
  const r = await q.query(
    `select d.id document_id, d.title, s.step_key, s.num, case when s.block_id=$1 then 'embedded' else 'reference' end mode
     from steps s join documents d on d.id=s.document_id
     where (s.block_id=$1 or $1 = any(s.block_refs)) and d.deleted_at is null
     order by d.title, s.position`,
    [id],
  );
  return r.rows.map((x) => ({
    documentId: x.document_id as string,
    title: x.title as string,
    stepKey: x.step_key as string,
    stepNum: x.num as string,
    mode: x.mode as 'embedded' | 'reference',
  }));
}

export async function updateBlock(
  tx: Tx,
  id: string,
  body: UpsertBlockBody,
  userId: string | null,
): Promise<{ block: Block; affected: string[] }> {
  const cur = await tx.query('select id from blocks where id=$1 and deleted_at is null for update', [id]);
  if (!cur.rowCount) throw httpError(404, 'NOT_FOUND', 'הבלוק לא נמצא');
  await tx.query('update blocks set title=$2, kind=$3, description=$4, script=$5 where id=$1', [
    id,
    body.title,
    body.kind,
    body.description ?? null,
    body.script ?? null,
  ]);
  if (body.slug) await tx.query('update blocks set slug=$2 where id=$1', [id, body.slug]);
  await writeChildren(tx, id, body);
  const { block } = await publishBlock(tx, id, { actorId: userId, label: body.label ?? 'עדכון בלוק' });
  const affected = [...new Set((await blockUsage(tx, id)).map((u) => u.documentId))];
  for (const docId of affected) {
    const doc = await getDocument(tx, docId);
    if (doc) await recomputeDerived(tx, doc);
  }
  return { block, affected };
}

export async function deleteBlock(tx: Tx, id: string, userId: string): Promise<string[]> {
  const affected = [...new Set((await blockUsage(tx, id)).map((u) => u.documentId))];
  const r = await tx.query(
    'update blocks set deleted_at=now(), deleted_by=$2 where id=$1 and deleted_at is null returning id',
    [id, userId],
  );
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'הבלוק לא נמצא');
  for (const docId of affected) {
    const doc = await getDocument(tx, docId);
    if (doc) await recomputeDerived(tx, doc);
  }
  return affected;
}

/* ── Stage 4: block page ────────────────────────────────────────────────── */

/** `blockUsage` plus the category the UI groups by — the shape `BlockPageSchema` asks for. */
export async function blockUsageRows(
  q: Q,
  id: string,
  scopes: string[] | null = null,
): Promise<BlockPage['usage']> {
  const r = await q.query(
    `select d.id document_id, d.title, d.category, s.step_key, s.num,
            case when s.block_id = $1 then 'embedded' else 'reference' end mode
       from steps s join documents d on d.id = s.document_id and d.deleted_at is null
      where (s.block_id = $1 or $1 = any(s.block_refs))
        and ($2::text[] is null or d.category = any($2))
      order by d.title, s.position`,
    [id, scopes],
  );
  return r.rows.map((x) => ({
    documentId: x.document_id as string,
    title: x.title as string,
    category: x.category as BlockPage['usage'][number]['category'],
    stepKey: x.step_key as string,
    stepNum: x.num as string,
    mode: x.mode as 'embedded' | 'reference',
  }));
}

export async function blockPage(q: Q, id: string, scopes: string[] | null = null): Promise<BlockPage | null> {
  const block = await getBlock(q, id);
  if (!block) return null;
  const [usage, versions] = await Promise.all([blockUsageRows(q, id, scopes), listBlockVersions(q, id)]);
  return { block, usage, versions };
}

export async function listBlockVersions(q: Q, id: string) {
  const r = await q.query(
    'select v.version, v.label, v.created_at, u.display_name from block_versions v left join users u on u.id=v.author_id where v.block_id=$1 order by v.version',
    [id],
  );
  return r.rows.map((v) => ({
    version: v.version as number,
    label: v.label as string,
    authorName: (v.display_name as string | null) ?? 'מערכת',
    createdAt: iso(v.created_at)!,
  }));
}
