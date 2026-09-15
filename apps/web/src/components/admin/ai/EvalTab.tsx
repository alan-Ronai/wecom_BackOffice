import { useEvalRuns, useRunEval } from '../../../api/hooks/aiAdmin.js';
import { fmtDate, fmtTime } from '../../../lib/format.js';
import { useToast } from '../../ui/Toast.js';

const pct = (x: number) => Math.round(x * 100) + '%';

/**
 * הערכה — the offline evaluation harness (spec §1.9).
 *
 * The three scores are what makes a model or prompt change arguable rather than anecdotal: a run
 * is stamped with the model, the prompt version and the embedder it ran under, so two rows are
 * comparable and "the new prompt is better" has a number behind it.
 *
 * A run that has started but not finished shows "רץ…" rather than a blank cell — it is queued
 * work, not a failure, and the table refetches while it is in flight.
 */
export function EvalTab() {
  const runs = useEvalRuns();
  const run = useRunEval();
  const toast = useToast();
  return (
    <div className="ai-eval">
      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={run.isPending}
          onClick={() =>
            void run
              .mutateAsync()
              .then(() => toast('ההערכה נוספה לתור', 'ok'))
              .catch(() => toast('לא ניתן להפעיל הערכה', 'warn'))
          }
        >
          הרץ הערכה
        </button>
        <span className="muted small">
          ההערכה רצה על סט המקרים המחויב במאגר ומודדת פגיעה בשלב היעד, בסוג ההצעה ובחפיפת התוכן.
        </span>
      </div>
      <table className="table" aria-label="ריצות הערכה">
        <thead>
          <tr>
            <th>התחלה</th>
            <th>מודל</th>
            <th>גרסת הנחיות</th>
            <th>הטמעה</th>
            <th>מקרים</th>
            <th>שלב יעד</th>
            <th>סוג</th>
            <th>חפיפת תוכן</th>
            <th>הערות</th>
          </tr>
        </thead>
        <tbody>
          {(runs.data ?? []).map((r) => (
            <tr key={r.id}>
              <td>
                {fmtDate(r.startedAt)} {fmtTime(r.startedAt)}
              </td>
              <td dir="ltr">{r.model}</td>
              <td dir="ltr">{r.promptVersion}</td>
              <td dir="ltr">{r.embedModel}</td>
              <td>{r.cases}</td>
              <td>{pct(r.hitTarget)}</td>
              <td>{pct(r.hitType)}</td>
              <td>{pct(r.contentOverlap)}</td>
              <td>{r.finishedAt ? r.notes : 'רץ…'}</td>
            </tr>
          ))}
          {!runs.data?.length ? (
            <tr>
              <td colSpan={9} className="muted">
                עדיין לא בוצעה הערכה.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
