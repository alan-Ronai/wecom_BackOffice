import { useEvents } from '../../api/events.js';
import { useHealth } from '../../api/hooks/admin.js';

const dot = (ok: boolean) => (
  <span className={'chip ' + (ok ? 'chip-green' : 'chip-red')}>{ok ? 'תקין' : 'לא זמין'}</span>
);

/**
 * Renders exactly what `GET /system/health` publishes. The port also queried `GET /admin/system`
 * for database size, per-connector health and the backup list; that route does not exist on the
 * API, so those rows were dropped rather than left permanently blank behind a retrying query.
 */
export function SystemPage() {
  const health = useHealth();
  const events = useEvents();
  const h = health.data;

  return (
    <>
      <div className="lib-head">
        <div>
          <h1>
            מצב מערכת<span>גרסה {h?.version ?? '—'}</span>
          </h1>
          <p>מצב הרכיבים על השרת הפנימי · מתעדכן גם דרך אירועי system.status.</p>
        </div>
      </div>
      {health.isError ? (
        <div className="empty">
          <b>לא ניתן לקרוא את מצב המערכת</b>
        </div>
      ) : null}
      <table className="table">
        <tbody>
          <tr>
            <th>מסד נתונים</th>
            <td>{dot(!!h?.db)}</td>
          </tr>
          <tr>
            <th>מודל מקומי</th>
            <td>{dot(!!h?.model)}</td>
          </tr>
          <tr>
            <th>תור עבודות</th>
            <td>{h?.queue ?? 0}</td>
          </tr>
          <tr>
            <th>זמן פעילות</th>
            <td>{h ? `${Math.round(h.uptimeSec / 60)} דק׳` : '—'}</td>
          </tr>
          <tr>
            <th>עדכונים חיים (SSE)</th>
            <td>{dot(events.connected)}</td>
            <td>{events.last ? events.last.name : ''}</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
