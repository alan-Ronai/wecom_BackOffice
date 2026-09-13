import { NavLink, Outlet } from 'react-router-dom';
import { useCan } from '../../api/hooks/me.js';
import { Hamburger } from '../shell/MobileDrawer.js';

const LINKS: [string, string][] = [
  ['users', 'משתמשים'],
  ['roles', 'תפקידים והרשאות'],
  ['groups', 'מיפוי קבוצות'],
  ['sessions', 'חיבורים פעילים'],
  ['audit', 'יומן פעולות'],
  ['system', 'מצב מערכת'],
];

export function AdminLayout() {
  const can = useCan();
  const allowed = can('users.manage') || can('roles.manage') || can('audit.read') || can('system.admin');
  if (!allowed)
    return (
      <div className="empty">
        <b>אין הרשאה לאזור הניהול</b>
        פנו למנהל המערכת כדי לקבל גישה
      </div>
    );

  return (
    <>
      <div className="topbar">
        <Hamburger />
        <div className="crumb">
          <b>ניהול</b>
        </div>
      </div>
      <div className="admin-layout">
        <nav className="admin-nav">
          {LINKS.map(([to, label]) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="scroll-area">
          <div className="lib-body">
            <Outlet />
          </div>
        </div>
      </div>
    </>
  );
}
