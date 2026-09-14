import { useCallback, useState } from 'react';
import { useMentionable, useRequestReview } from '../../api/hooks/collab.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { ApiError } from '../../api/unwrap.js';

/**
 * "שלח לסקירה" — the control review item I6 removed rather than faking.
 *
 * It used to PATCH an empty body and toast success: nothing was persisted and no reviewer was
 * notified. `POST /documents/:id/request-review` is the real transition (document → `review`,
 * leads or the named reviewers notified), so the control comes back with a note and an explicit
 * reviewer choice instead of an implicit "someone will see it".
 */
function RequestReviewBody({
  documentId,
  title,
  onDone,
}: {
  documentId: string;
  title: string;
  onDone: () => void;
}) {
  const request = useRequestReview(documentId);
  const candidates = useMentionable('', true);
  const [note, setNote] = useState('');
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setReviewerIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = async () => {
    setError(null);
    try {
      await request.mutateAsync({
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(reviewerIds.length ? { reviewerIds } : {}),
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'לא ניתן לשלוח לסקירה');
    }
  };

  return (
    <div className="form review-request">
      <p className="muted small">
        “{title}” יעבור למצב <b>בסקירה</b>. מנהלי הצוות יקבלו התראה, ויוכלו לאשר ולפרסם או לבקש שינויים.
      </p>
      <label>
        מה השתנה? (מוצג למי שסוקר)
        <textarea
          aria-label="מה השתנה?"
          rows={3}
          value={note}
          autoFocus
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="eyebrow">סוקרים (ריק = כל מנהלי הצוות)</div>
      <div className="reviewer-list">
        {(candidates.data ?? []).map((c) => (
          <label key={c.id} className="reviewer">
            <input
              type="checkbox"
              checked={reviewerIds.includes(c.id)}
              onChange={() => toggle(c.id)}
              aria-label={c.displayName}
            />
            <span className="avatar sm">{c.initials}</span>
            <span>{c.displayName}</span>
          </label>
        ))}
      </div>
      {error ? <div className="field-error">{error}</div> : null}
      <div className="row">
        <button
          className="btn primary sm"
          type="button"
          disabled={request.isPending}
          onClick={() => void submit()}
        >
          שלח לסקירה
        </button>
      </div>
    </div>
  );
}

export function useRequestReviewDialog(): (doc: { id: string; title: string }) => void {
  const modal = useModal();
  const toast = useToast();
  return useCallback(
    (doc) => {
      const close = modal.open({
        title: '📤 שליחה לסקירה',
        body: (
          <RequestReviewBody
            documentId={doc.id}
            title={doc.title}
            onDone={() => {
              close();
              toast('נשלח לסקירה · מנהלי הצוות קיבלו התראה', 'ok');
            }}
          />
        ),
        buttons: [{ label: 'ביטול' }],
      });
    },
    [modal, toast],
  );
}
