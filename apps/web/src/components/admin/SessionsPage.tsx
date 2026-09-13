import { useRevokeSession, useSessions } from '../../api/hooks/admin.js';
import { useCan } from '../../api/hooks/me.js';
import { ago, fmtDate } from '../../lib/format.js';

export function SessionsPage() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const can = useCan();
  const list = (sessions.data ?? []).filter((s) => !s.revokedAt);

  return (
    <>
      <div className="lib-head">
        <div>
          <h1>
            חיבורים פעילים<span>{list.length} חיבורים</span>
          </h1>
          <p>הפגה מתגלגלת של 8 שעות · ניתוק מבטל את העוגייה מיד.</p>
        </div>
      </div>
      {!list.length ? (
        <div className="empty">
          <b>אין חיבורים פעילים</b>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>משתמש</th>
              <th>כתובת IP</th>
              <th>דפדפן</th>
              <th>נראה לאחרונה</th>
              <th>פג בתאריך</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td>
                  <bdi className="lat" dir="ltr">
                    {s.userId}
                  </bdi>
                </td>
                <td>
                  <bdi className="lat" dir="ltr">
                    {s.ip ?? '—'}
                  </bdi>
                </td>
                <td>
                  <bdi className="lat" dir="ltr">
                    {s.userAgent ?? '—'}
                  </bdi>
                </td>
                <td>{ago(s.lastSeenAt)}</td>
                <td>{fmtDate(s.expiresAt)}</td>
                <td>
                  {can('users.manage') ? (
                    <button className="btn xs danger" onClick={() => revoke.mutate(s.id)}>
                      נתק
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
