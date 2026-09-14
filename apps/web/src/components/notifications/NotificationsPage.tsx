import { useNavigate } from 'react-router-dom';
import { Hamburger } from '../shell/MobileDrawer.js';
import { NotificationList } from './NotificationList.js';

/** The full-page notification centre (6d desktop, 6g mobile) — the same list as the bell panel. */
export function NotificationsPage() {
  const go = useNavigate();
  return (
    <>
      <div className="topbar">
        <Hamburger />
        <div className="crumb">
          <a role="button" tabIndex={0} onClick={() => go('/library')}>
            ספרייה
          </a>
          <span className="sep">/</span>
          <b>התראות</b>
        </div>
      </div>
      <div className="scroll-area">
        <div className="lib-body notif-page">
          <NotificationList />
        </div>
      </div>
    </>
  );
}
