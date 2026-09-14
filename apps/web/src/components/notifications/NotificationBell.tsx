import { useEffect, useRef, useState } from 'react';
import { useNotifications } from '../../api/hooks/collab.js';
import { NotificationList } from './NotificationList.js';

/**
 * The bell (6d). Lives in the sidebar because that is the only chrome present on every route —
 * each page owns its own topbar — so the unread count is visible from anywhere.
 *
 * The count comes from the list response's `unread` field rather than from counting the rows:
 * the list is paged, and counting a page would under-report the moment there are more than 50.
 */
export function NotificationBell({ onOpenFull }: { onOpenFull: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = useNotifications();
  const unread = list.data?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc, true);
    };
  }, [open]);

  return (
    <div className="bell-wrap" ref={box}>
      <button
        className="bell"
        aria-label={unread ? `התראות · ${unread} שלא נקראו` : 'התראות'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        🔔
        {unread ? <span className="b">{unread > 99 ? '99+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="bell-panel" role="dialog" aria-label="מרכז התראות">
          <NotificationList onNavigate={() => setOpen(false)} />
          <button
            className="btn xs ghost"
            onClick={() => {
              setOpen(false);
              onOpenFull();
            }}
          >
            פתח בעמוד מלא
          </button>
        </div>
      ) : null}
    </div>
  );
}
