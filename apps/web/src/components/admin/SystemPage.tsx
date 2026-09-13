import { useEvents } from '../../api/events.js';
import { useSystem } from '../../api/hooks/admin.js';
import { fmtDate } from '../../lib/format.js';
import { LoadError } from '../ui/index.js';

const dot = (ok: boolean) => (
  <span className={'chip ' + (ok ? 'chip-green' : 'chip-red')}>{ok ? 'תקין' : 'לא זמין'}</span>
);
const Lat = ({ children }: { children: React.ReactNode }) => (
  <bdi className="lat" dir="ltr">
    {children}
  </bdi>
);

/**
 * `GET /admin/system` — the operator's diagnostic view. Every field here comes from the published
 * `AdminSystemSchema`; nothing is invented, so a backend change shows up as a typecheck error
 * rather than a blank row.
 */
export function SystemPage() {
  const system = useSystem();
  const events = useEvents();
  const s = system.data;

  if (system.isError) return <LoadError what="מצב מערכת" error={system.error} />;

  return (
    <>
      <div className="lib-head">
        <div>
          <h1>
            מצב מערכת<span>גרסה {s?.version ?? '—'}</span>
          </h1>
          <p>מצב הרכיבים על השרת הפנימי · מתעדכן גם דרך אירועי system.status.</p>
        </div>
      </div>

      <table className="table">
        <tbody>
          <tr>
            <th>מסד נתונים</th>
            <td>{dot(!!s?.db)}</td>
            <td />
          </tr>
          <tr>
            <th>מודל מקומי</th>
            <td>{dot(!!s?.model)}</td>
            <td>{s?.modelName ? <Lat>{s.modelName}</Lat> : null}</td>
          </tr>
          <tr>
            <th>תור עבודות</th>
            <td>{s?.queue ?? '—'}</td>
            <td>
              {Object.entries(s?.queues ?? {})
                .filter(([, n]) => n > 0)
                .map(([q, n]) => `${q}: ${n}`)
                .join(' · ')}
            </td>
          </tr>
          <tr>
            <th>זמן פעילות</th>
            <td>{s ? `${Math.round(s.uptimeSec / 60)} דק׳` : '—'}</td>
            <td />
          </tr>
          <tr>
            <th>גיבוי אחרון</th>
            <td>{dot(!!s?.backup.ok)}</td>
            <td>
              {s?.backup.latestFile ? <Lat>{s.backup.latestFile}</Lat> : 'אין גיבוי'}
              {s?.backup.ageHours != null ? ` · לפני ${Math.round(s.backup.ageHours)} שעות` : ''}
            </td>
          </tr>
          <tr>
            <th>מסמכי מקור</th>
            <td>{s ? `${s.sources.pending} ממתינים` : '—'}</td>
            <td>{s?.sources.error ? `${s.sources.error} בשגיאה` : ''}</td>
          </tr>
          <tr>
            <th>הצעות לסקירה</th>
            <td>{s ? s.suggestions.pending : '—'}</td>
            <td />
          </tr>
          <tr>
            <th>עדכונים חיים (SSE)</th>
            <td>{dot(events.connected)}</td>
            <td>{events.last ? events.last.name : ''}</td>
          </tr>
        </tbody>
      </table>

      <div className="eyebrow" style={{ margin: '18px 0 8px' }}>
        מחברים
      </div>
      {s?.connectors.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>מחבר</th>
              <th>סוג</th>
              <th>מצב</th>
              <th>ריצה אחרונה</th>
              <th>התנגשויות</th>
            </tr>
          </thead>
          <tbody>
            {s.connectors.map((c) => (
              <tr key={c.id}>
                <td>
                  <Lat>{c.name}</Lat>
                </td>
                <td>
                  <Lat>{c.type}</Lat>
                </td>
                <td>{c.enabled ? dot(c.lastStatus !== 'error') : <span className="chip">מושבת</span>}</td>
                <td>{c.lastRunAt ? fmtDate(c.lastRunAt) : '—'}</td>
                <td>{c.conflicts ? <span className="chip chip-amber">{c.conflicts}</span> : '0'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="small muted">לא הוגדרו מחברים</div>
      )}
    </>
  );
}
