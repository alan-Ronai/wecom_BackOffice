import { NavLink, Outlet } from 'react-router-dom';
import { useCan } from '../../api/hooks/me.js';
import { Hamburger } from '../shell/MobileDrawer.js';

import type { Permission } from '@wecom/shared';

/**
 * Every entry names the permission its route needs, so the nav shows what the operator can
 * actually open instead of a list of links that answer 403.
 */
const LINKS: [to: string, label: string, needs: Permission][] = [
  ['users', 'משתמשים', 'users.manage'],
  ['roles', 'תפקידים והרשאות', 'roles.manage'],
  ['groups', 'מיפוי קבוצות', 'roles.manage'],
  ['sessions', 'חיבורים פעילים', 'users.manage'],
  ['audit', 'יומן פעולות', 'audit.read'],
  ['identity', 'זהות וכניסה', 'system.admin'],
  ['connectors', 'מחברים', 'connectors.manage'],
  ['system', 'מצב מערכת', 'system.admin'],
];

export function AdminLayout() {
  const can = useCan();
  const allowed =
    can('users.manage') ||
    can('roles.manage') ||
    can('audit.read') ||
    can('system.admin') ||
    can('connectors.manage');
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
          {LINKS.filter(([, , needs]) => can(needs)).map(([to, label]) => (
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
