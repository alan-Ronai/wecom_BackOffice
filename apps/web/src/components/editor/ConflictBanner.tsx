/**
 * Card 6c's conflict banner.
 *
 * `PUT /documents/:id/structure` answers **412** when the `If-Match` etag is stale — someone
 * published while this editor was open. Before this, that surfaced as a toast with a status code
 * and the editor kept the now-unsavable draft on screen.
 *
 * The two ways out are genuinely different, so both are offered rather than picked for the user:
 *
 *  - **טען מחדש** — throw away this draft and start from what is now published. Right when the
 *    other person's change supersedes yours.
 *  - **הצג הבדלים** — open the history diff for the version that landed, keeping the draft intact,
 *    so the edits can be re-applied on top. Right when both changes matter.
 *
 * Nothing is discarded automatically: the draft is still on the server, and the only safe default
 * is to let the person who typed it decide.
 */
export function ConflictBanner({
  who,
  onReload,
  onShowDiff,
  onDismiss,
}: {
  who: string | null;
  onReload: () => void;
  onShowDiff: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="conflict-banner" role="alert" aria-live="assertive">
      <span className="ic">⚠</span>
      <span className="tx">
        {who ? `${who} שמר/ה גרסה חדשה` : 'נשמרה גרסה חדשה של המסמך'} — השמירה שלך נעצרה כדי לא לדרוס אותה.
        הטיוטה שלך נשמרה.
      </span>
      <button className="btn xs" onClick={onShowDiff}>
        הצג הבדלים
      </button>
      <button className="btn xs primary" onClick={onReload}>
        טען מחדש
      </button>
      <button className="btn xs ghost" aria-label="סגור התראה" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}
