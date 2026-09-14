import type { Notifier } from '@wecom/shared';
import type { Tx } from '../../lib/sql.js';
import type { Q } from './repo.js';

/** Live documents fed by a source: via `documents.source_id` or a `derived_from_source` link. */
export async function documentsForSource(q: Q, sourceId: string): Promise<string[]> {
  const r = await q.query(
    `select d.id from documents d
      where d.deleted_at is null
        and (d.source_id = $1 or exists (select 1 from document_links l where l.from_document_id=d.id and l.to_source_id=$1))
      order by d.title`,
    [sourceId],
  );
  return r.rows.map((x) => x.id as string);
}

/**
 * PRD §8: a change in the source marks the working view "נדרשת לבדיקה" and alerts the people
 * responsible. Idempotent — re-raising only refreshes the reason and timestamp; the alert is sent
 * once per raise (callers raise once per ingested revision).
 */
export async function markSourceReviewNeeded(
  tx: Tx,
  notifier: Notifier,
  documentId: string,
  reason: string,
): Promise<void> {
  const r = await tx.query(
    `update documents set source_review_needed=true, source_review_reason=$2, source_review_at=now()
      where id=$1 and deleted_at is null returning title, owner_id, editor_id`,
    [documentId, reason],
  );
  if (!r.rowCount) return;
  const { title, owner_id, editor_id } = r.rows[0] as {
    title: string;
    owner_id: string | null;
    editor_id: string | null;
  };
  const userIds = [...new Set([owner_id, editor_id].filter((x): x is string => !!x))];
  if (!userIds.length) return;
  await notifier.notify({
    userIds,
    kind: 'source',
    title: 'שינוי במקור הידע: ' + title,
    body: reason,
    href: `/doc/${documentId}`,
    entityType: 'document',
    entityId: documentId,
  });
}

export async function clearSourceReview(tx: Tx, documentId: string): Promise<void> {
  await tx.query(
    `update documents set source_review_needed=false, source_review_reason=null, source_review_at=null where id=$1`,
    [documentId],
  );
}
