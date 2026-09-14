import { useDocumentSyncState } from '../../api/hooks/stage5.js';

/**
 * What WordPress currently thinks of this item, on the article itself.
 *
 * The wave-4 ruling was that a pending push is an operator's business and belongs on `/sync`, and
 * that the source-review flag next to this badge answers a different question — it does ("the
 * source moved, decide what to do"), and the two stay separate. What that left open is the case
 * the ruling itself named: after a remote edit *and* a local publish the link is `conflict`, an
 * editor can clear the review flag believing the loop is closed, and WordPress still shows the old
 * text. This badge is the missing half of that sentence.
 *
 * Only the two states an editor can do something about are shown. `synced` needs no chip — the
 * absence of one is the good news — and `pending_import` is the queue pulling *towards* us, which
 * resolves itself on the next run without anybody's help. `null` means the document is not
 * connected to a connector at all.
 *
 * It is read-only here on purpose: resolving a conflict needs `sources.manage` and the three-way
 * merge on `/sync`, so the badge names the state and stops.
 */
export function SyncStateBadge({ documentId }: { documentId: string }) {
  const q = useDocumentSyncState(documentId);
  const state = q.data?.state;
  if (state !== 'pending_push' && state !== 'conflict') return null;
  const where = q.data?.connectorName ? ` (${q.data.connectorName})` : '';
  return state === 'conflict' ? (
    <span
      className="chip chip-red sync-state"
      title={`הפריט והמקור המרוחק השתנו שניהם; נדרשת הכרעה במסך הסנכרון${where}`}
    >
      ⇄ קונפליקט
    </span>
  ) : (
    <span
      className="chip chip-amber sync-state"
      title={`השינוי המקומי טרם נדחף למקור המרוחק${where}`}
    >
      ⇡ ממתין לדחיפה
    </span>
  );
}
