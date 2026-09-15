import { useLearningDashboard } from '../../../api/hooks/learningManage.js';
import { attempts } from '../../../lib/count.js';
import { worldLabel } from '../../taxonomy/TypeBadge.js';
import { LoadError } from '../../ui/index.js';

const pct = (r: number) => `${Math.round(r * 100)}%`;

/** Spec §5: completion rates, overdue, top failed questions — the manager's summary strip. */
export function LearningDashboardPanel({ world }: { world?: string }) {
  const d = useLearningDashboard(world);
  if (d.isError) return <LoadError what="לוח למידה" error={d.error} />;
  if (!d.data) return <div className="route-loading">טוען…</div>;
  const t = d.data.totals;
  return (
    <section className="learning-dashboard" aria-label="לוח למידה">
      <div className="stats">
        <div className="stat">
          <b>{t.items}</b>
          <span>פריטי למידה</span>
        </div>
        <div className="stat">
          <b>{t.assigned}</b>
          <span>הוקצו</span>
        </div>
        <div className="stat">
          <b>{t.completed}</b>
          <span>הושלמו</span>
        </div>
        <div className="stat warn">
          <b>{t.overdue}</b>
          <span>באיחור</span>
        </div>
        <div className="stat">
          <b>{t.refreshPending}</b>
          <span>ממתינים לרענון</span>
        </div>
      </div>
      {d.data.byWorld.length ? (
        <table className="table compact">
          <thead>
            <tr>
              <th>עולם תוכן</th>
              <th>הוקצו</th>
              <th>הושלמו</th>
              <th>באיחור</th>
              <th>שיעור</th>
            </tr>
          </thead>
          <tbody>
            {d.data.byWorld.map((w) => (
              <tr key={w.worldSlug}>
                <td>{worldLabel(w.worldSlug)}</td>
                <td>{w.assigned}</td>
                <td>{w.completed}</td>
                <td>{w.overdue}</td>
                <td>{pct(w.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {d.data.failedQuestions.length ? (
        <div className="failed-questions">
          <h3>שאלות שנכשלות הכי הרבה</h3>
          <ul>
            {d.data.failedQuestions.map((q) => (
              <li key={q.questionId}>
                <span className="chip chip-red">{pct(q.failRate)}</span> {q.stem}{' '}
                <small>
                  · {q.itemTitle} · {attempts(q.attempts)}
                </small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
