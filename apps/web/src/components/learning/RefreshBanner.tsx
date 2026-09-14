import { Link } from 'react-router-dom';
import { useDocumentLearning } from '../../api/hooks/learning.js';
import { useCan } from '../../api/hooks/me.js';

/**
 * Spec §5 refresh: shown on the article for the affected user until the refresh assignment is done.
 *
 * The link target comes from the contract's own `refreshAssignmentId` (the caller's open refresh
 * assignment for this document) rather than from scanning `/learning/my` for a `reason: 'refresh'`
 * row — that scan would happily link to a refresh for some *other* document.
 */
export function RefreshBanner({ documentId }: { documentId: string }) {
  const can = useCan();
  const dl = useDocumentLearning(documentId, can('learning.read'));
  if (!dl.data?.refreshRequired) return null;
  const target = dl.data.refreshAssignmentId;
  const reasons = dl.data.lastSignificantChange?.reasons ?? [];
  return (
    // V6: named so the article mount (and the real e2e) can address the live region itself
    // rather than the sentence inside it, which grows a reason list.
    <div className="banner banner-amber learning-refresh" role="status" aria-label="רענון ידע נדרש">
      <b>רענון ידע נדרש</b>
      {reasons.length ? <span> · {reasons.join(', ')}</span> : null}
      {target ? (
        <Link to={`/learning/${target}`} className="btn btn-sm">
          למטלת הרענון
        </Link>
      ) : null}
    </div>
  );
}
