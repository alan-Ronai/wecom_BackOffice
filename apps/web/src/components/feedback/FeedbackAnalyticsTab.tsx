import { FEEDBACK_KIND_LABELS } from '@wecom/shared';
import { useFeedbackAnalytics } from '../../api/hooks/feedback.js';
import { LoadError } from '../ui/index.js';
import { fmtDate } from '../../lib/format.js';

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** PRD §12 "אנליטיקה של משובים": plain numbers and tables; wave 3's dashboard cards are not a dependency. */
export function FeedbackAnalyticsTab({ world }: { world?: string }) {
  const a = useFeedbackAnalytics(world ? { world } : {});
  if (a.isPending) return <div className="route-loading">טוען…</div>;
  if (a.isError || !a.data) return <LoadError what="את האנליטיקה" error={a.error} />;
  const d = a.data;
  return (
    <div className="analytics">
      <div className="small muted">
        {fmtDate(d.from)} – {fmtDate(d.to)} · {d.total} משובים
      </div>
      <div className="stat-row">
        <div className="stat">
          <b>זמן ממוצע לטיפול</b>
          <span>{d.meanHoursToClose == null ? '—' : `${d.meanHoursToClose.toFixed(1)} שעות`}</span>
        </div>
        <div className="stat">
          <b>שיעור משובים שהובילו לשינוי תוכן</b>
          <span>{pct(d.changeRate)}</span>
        </div>
        <div className="stat">
          <b>סוגי המשובים הנפוצים</b>
          <ul>
            {d.byKind.map((k) => (
              <li key={k.kind}>
                {FEEDBACK_KIND_LABELS[k.kind]} · {k.count}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <table className="table" aria-label="פריטים עם הכי הרבה דיווחים">
        <thead>
          <tr>
            <th>פריט</th>
            <th>סוג</th>
            <th>דיווחים</th>
            <th>פתוחים</th>
          </tr>
        </thead>
        <tbody>
          {d.perItem.map((r) => (
            <tr key={r.documentId}>
              <td>
                <a href={`/feedback?documentId=${r.documentId}`}>{r.title}</a>
              </td>
              <td>{r.docType ?? '—'}</td>
              <td>{r.count}</td>
              <td>{r.open}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>נושאים שבהם חוזר אותו פער</h3>
      {d.recurringByTopic.length ? (
        <ul>
          {d.recurringByTopic.map((t) => (
            <li key={t.topicId + t.kind}>
              {t.topicName} · {FEEDBACK_KIND_LABELS[t.kind]} · {t.count}
            </li>
          ))}
        </ul>
      ) : (
        <div className="small muted">אין נושאים חוזרים בתקופה (או שנושאים טרם הוגדרו)</div>
      )}
    </div>
  );
}
