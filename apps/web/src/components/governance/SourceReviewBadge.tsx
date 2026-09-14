import type { Category } from '@wecom/shared';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { useCan } from '../../api/hooks/me.js';
import { useClearSourceReview } from '../../api/hooks/governance.js';

/** The slice of a document (or card) the badge needs. */
export type SourceReviewDoc = {
  id: string;
  sourceReviewNeeded?: boolean;
  sourceReviewReason?: string | null;
  category?: Category;
};

/**
 * Amber "נדרשת בדיקה" marker, raised when a new revision of the source landed under a published
 * item (§5.2). The reason is the tooltip rather than body text so the badge stays one line in a
 * card meta row; an editor clears it with a note, which is audited on the server.
 */
export function SourceReviewBadge({ doc }: { doc: SourceReviewDoc }) {
  const can = useCan();
  const modal = useModal();
  const toast = useToast();
  const clear = useClearSourceReview();
  if (!doc.sourceReviewNeeded) return null;
  const editable = doc.category ? can('docs.edit', { category: doc.category }) : can('docs.edit');
  return (
    <span className="chip chip-amber source-review" title={doc.sourceReviewReason ?? ''}>
      ⚑ נדרשת בדיקה — המקור השתנה
      {editable ? (
        <button
          type="button"
          className="btn xs"
          onClick={async () => {
            const note = await modal.prompt('סימון כנבדק', 'הערה', '', true);
            if (!note?.trim()) return;
            try {
              await clear.mutateAsync({ id: doc.id, note: note.trim() });
              toast('סומן כנבדק', 'ok');
            } catch {
              toast('הפעולה נכשלה', 'warn');
            }
          }}
        >
          סמן כנבדק
        </button>
      ) : null}
    </span>
  );
}
