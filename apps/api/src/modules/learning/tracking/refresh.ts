import type { ChangeFlag, Document } from '@wecom/shared';
import { makeEvent } from '@wecom/shared';
import type { Tx } from '../../../lib/sql.js';
import { getWorkflowSettings } from '../../../lib/workflowSettings.js';
import { getVersion, loadBlocksMap, loadFieldNames } from '../../documents/repo.js';
import { detectSignificantChange } from './changeDetector.js';
import { createAssignments, type TrackingDeps } from './audiences.js';
import { getPublishedItem, itemSourceVersions, listItemsReferencing } from './itemsPort.js';

export interface ChangeFlagInput {
  documentId: string;
  /** The version just written. The comparison baseline is `version - 1`'s frozen snapshot. */
  version: number;
  after: Document;
  override?: boolean;
  actorId: string | null;
}

const OVERRIDE_REASON = 'סומן כשינוי מהותי על ידי העורך';

/**
 * Spec §1.5. Detection runs on every publish and is recorded; the editor's checkbox overrides the
 * verdict either way. A significant publish invalidates every learning assignment of an item whose
 * current version pins this document at an older version and hands each affected user a refresh
 * assignment (reason `refresh`) due in `learning.refreshDueDays`.
 *
 * Refresh assignments are themselves never invalidated: a second significant publish while one is
 * still open re-points its `refresh_reason` at the newest version instead of stacking a second row
 * on the same (item, version, user) — the user already owes exactly one refresh.
 *
 * The baseline is read here rather than handed in: the publish route's `before` is the *working*
 * document, which already carries the edit being published, so comparing against it would always
 * say "nothing changed". `document_versions` at `version - 1` is what the last publish froze.
 */
export async function applyChangeFlag(
  tx: Tx,
  deps: Pick<TrackingDeps, 'notifier' | 'events'>,
  i: ChangeFlagInput,
): Promise<ChangeFlag> {
  const previous = i.version > 1 ? await getVersion(tx, i.documentId, i.version - 1) : null;
  const detected = previous
    ? detectSignificantChange(previous, i.after, await loadBlocksMap(tx), await loadFieldNames(tx))
    : { significant: false, reasons: [] }; // a first publish has nothing pinned to invalidate
  let significant = detected.significant;
  let reasons = detected.reasons;
  if (i.override === true) {
    significant = true;
    reasons = detected.significant ? [...detected.reasons, OVERRIDE_REASON] : [OVERRIDE_REASON];
  } else if (i.override === false) {
    significant = false;
    reasons = [];
  }
  await tx.query(
    `insert into document_change_flags(document_id, version, significant, reasons, decided_by) values ($1,$2,$3,$4,$5)
     on conflict (document_id, version)
       do update set significant=excluded.significant, reasons=excluded.reasons, decided_by=excluded.decided_by`,
    [i.documentId, i.version, significant, JSON.stringify(reasons), i.actorId],
  );
  if (!significant) return { significant, reasons, affectedItems: 0, refreshAssignments: 0 };
  /**
   * `learning_items` is V1's table (migration 0039). Until it is on main this lane's migration
   * can still be applied on its own, and a publish must not fail because the item side of wave 5
   * is missing: the flag is recorded either way, and the fan-out simply has nothing to walk.
   */
  const items = await tx.query(`select to_regclass('learning_items') t`);
  if (!items.rows[0]?.t) return { significant, reasons, affectedItems: 0, refreshAssignments: 0 };

  const settings = await getWorkflowSettings(tx);
  // Published items whose current version pins this document below the version just published.
  const affected: { itemId: string; itemVersion: number }[] = [];
  for (const it of await listItemsReferencing(tx, i.documentId)) {
    if (it.status !== 'published') continue;
    const pins = await itemSourceVersions(tx, it.itemId, it.currentVersion);
    if (pins.some((p) => p.documentId === i.documentId && p.version < i.version))
      affected.push({ itemId: it.itemId, itemVersion: it.currentVersion });
  }
  const users = new Set<string>();
  let refreshAssignments = 0;
  const reason = `שינוי מהותי במסמך "${i.after.title}" (גרסה ${i.version})`;
  for (const it of affected) {
    const inv = await tx.query(
      `update learning_assignments set status='invalidated', invalidated_at=now(), invalidated_reason=$3
        where item_id=$1 and item_version=$2 and reason in ('audience','manual')
          and status in ('open','overdue','completed') returning user_id`,
      [it.itemId, it.itemVersion, reason],
    );
    const standing = await tx.query(
      `select user_id from learning_assignments
        where item_id=$1 and item_version=$2 and reason='refresh' and status in ('open','overdue')`,
      [it.itemId, it.itemVersion],
    );
    const userIds = [
      ...new Set([...inv.rows, ...standing.rows].map((r) => r.user_id as string)),
    ];
    if (!userIds.length) continue;
    const pub = await getPublishedItem(tx, it.itemId);
    if (!pub) continue;
    const r = await createAssignments(tx, deps, {
      item: pub.item,
      userIds,
      reason: 'refresh',
      dueDays: settings.learning.refreshDueDays,
      refreshReason: reason,
      actorId: i.actorId,
    });
    refreshAssignments += r.assigned;
    // Re-point any refresh already standing for this item version at the newest reason.
    await tx.query(
      `update learning_assignments set refresh_reason=$3
        where item_id=$1 and item_version=$2 and reason='refresh' and status in ('open','overdue')`,
      [it.itemId, it.itemVersion, reason],
    );
    for (const u of userIds) users.add(u);
  }
  await deps.events.publish(
    tx,
    makeEvent('learning.refresh_required', {
      documentId: i.documentId,
      version: i.version,
      affectedUsers: users.size,
    }),
  );
  return { significant, reasons, affectedItems: affected.length, refreshAssignments };
}
