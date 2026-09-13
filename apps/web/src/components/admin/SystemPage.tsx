import { useEvents } from '../../api/events.js';
import { useHealth, useSystem } from '../../api/hooks/admin.js';
import { fmtDate } from '../../lib/format.js';

const dot = (ok: boolean) => (
  <span className={'chip ' + (ok ? 'chip-green' : 'chip-red')}>{ok ? 'תקין' : 'לא זמין'}</span>
);

export function SystemPage() {
  const system = useSystem();
  const health = useHealth();
  const events = useEvents();
  const s = system.data;

  return (
    <>
      <div className="lib-head">
        <div>
          <h1>
            מצב מערכת<span>גרסה {health.data?.version ?? '—'}</span>
          </h1>
          <p>מצב הרכיבים על השרת הפנימי · מתעדכן גם דרך אירועי system.status.</p>
        </div>
      </div>
      <table className="table">
        <tbody>
          <tr>
            <th>מסד נתונים</th>
            <td>{dot(!!(s?.db ?? health.data?.db))}</td>
            <td>{s ? `${s.dbSizeMb} MB` : ''}</td>
          </tr>
          <tr>
            <th>מודל מקומי</th>
            <td>{dot(!!(s?.model ?? health.data?.model))}</td>
            <td />
          </tr>
          <tr>
            <th>תור עבודות</th>
            <td>{s?.queue ?? health.data?.queue ?? 0}</td>
            <td />
          </tr>
          <tr>
            <th>עדכונים חיים (SSE)</th>
            <td>{dot(events.connected)}</td>
            <td>{events.last ? events.last.name : ''}</td>
          </tr>
          {Object.entries(s?.connectors ?? {}).map(([name, ok]) => (
            <tr key={name}>
              <th>
                מחבר{' '}
                <bdi className="lat" dir="ltr">
                  {name}
                </bdi>
              </th>
              <td>{dot(ok)}</td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>

      <div className="eyebrow" style={{ margin: '18px 0 8px' }}>
        גיבויים
      </div>
      {s?.backups.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>קובץ</th>
              <th>גודל</th>
              <th>מתי</th>
            </tr>
          </thead>
          <tbody>
            {s.backups.map((b) => (
              <tr key={b.name}>
                <td>
                  <bdi className="lat" dir="ltr">
                    {b.name}
                  </bdi>
                </td>
                <td>{b.sizeMb} MB</td>
                <td>{fmtDate(b.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="small muted">אין גיבויים עדיין</div>
      )}
    </>
  );
}
