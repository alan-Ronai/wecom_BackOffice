import { useRevokeSession, useSessions } from '../../api/hooks/admin.js';
import { useAdminUsers } from '../../api/hooks/stage5.js';
import { useCan } from '../../api/hooks/me.js';
import { ago, fmtDate, fmtTime } from '../../lib/format.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { Chip, LoadError } from '../ui/index.js';

/**
 * A user agent is not a device, but it is what the session row carries, and "Chrome · Windows"
 * is the thing an operator can actually match against "the machine at desk 12".
 */
function device(ua: string | null): { icon: string; label: string } {
  if (!ua) return { icon: '🖥', label: 'לא ידוע' };
  const browser = /Edg/.test(ua)
    ? 'Edge'
    : /Chrome/.test(ua)
      ? 'Chrome'
      : /Safari/.test(ua)
        ? 'Safari'
        : /Firefox/.test(ua)
          ? 'Firefox'
          : ua.split('/')[0];
  const mobile = /iPhone|iPad|Android/.test(ua);
  // iOS before macOS: an iPhone's user agent says "like Mac OS X", and testing for macOS first
  // labels every iPhone a Mac.
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return { icon: mobile ? '📱' : '💻', label: os ? `${browser} · ${os}` : browser };
}

export function SessionsPage() {
  const sessions = useSessions();
  // Sessions carry a userId, not a name. Resolving it here is the difference between "who is
  // still signed in" and a column of uuids nobody can act on.
  const users = useAdminUsers({ pageSize: 200 });
  const revoke = useRevokeSession();
  const modal = useModal();
  const toast = useToast();
  const can = useCan();
  const mayRevoke = can('users.manage');

  const names = Object.fromEntries((users.data?.items ?? []).map((u) => [u.id, u.displayName]));
  const list = (sessions.data ?? []).filter((s) => !s.revokedAt);
  const expired = (iso: string) => new Date(iso).getTime() < Date.now();

  return (
    <>
      {sessions.isError ? <LoadError what="חיבורים פעילים" error={sessions.error} /> : null}
      <div className="lib-head">
        <div>
          <h1>
            חיבורים פעילים<span>{list.length} חיבורים</span>
          </h1>
          <p>הפגה מתגלגלת לפי ההגדרה במסך הזהות · ניתוק מבטל את העוגייה מיד ונרשם ביומן הביקורת.</p>
        </div>
      </div>
      {!list.length && !sessions.isPending ? (
        <div className="empty">
          <b>אין חיבורים פעילים</b>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>משתמש</th>
              <th>מכשיר</th>
              <th>כתובת IP</th>
              <th>נראה לאחרונה</th>
              <th>פג בתאריך</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((s) => {
              const d = device(s.userAgent);
              const name = names[s.userId];
              return (
                <tr key={s.id}>
                  <td>
                    {name ?? (
                      <bdi className="lat" dir="ltr">
                        {s.userId}
                      </bdi>
                    )}
                  </td>
                  <td>
                    <span aria-hidden="true">{d.icon} </span>
                    {d.label}
                    <div className="small muted" title={s.userAgent ?? undefined}>
                      נכנס {fmtDate(s.createdAt)} {fmtTime(s.createdAt)}
                    </div>
                  </td>
                  <td>
                    <bdi className="lat" dir="ltr">
                      {s.ip ?? '—'}
                    </bdi>
                  </td>
                  <td>{ago(s.lastSeenAt)}</td>
                  <td>
                    {expired(s.expiresAt) ? (
                      <Chip tone="chip-amber">פג</Chip>
                    ) : (
                      `${fmtDate(s.expiresAt)} ${fmtTime(s.expiresAt)}`
                    )}
                  </td>
                  <td>
                    {mayRevoke ? (
                      <button
                        className="btn xs danger"
                        aria-label={`נתק ${name ?? s.id}`}
                        onClick={async () => {
                          const ok = await modal.confirm(
                            'ניתוק חיבור',
                            `${name ?? 'המשתמש'} יידרש להיכנס מחדש במכשיר הזה.`,
                            'נתק',
                            'danger',
                          );
                          if (!ok) return;
                          await revoke.mutateAsync(s.id);
                          toast('החיבור נותק', 'ok');
                        }}
                      >
                        נתק
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
