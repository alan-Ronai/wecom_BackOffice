import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useMe } from '../../api/hooks/me.js';
import { ApiError } from '../../api/unwrap.js';
import { applyPrefs } from '../../lib/prefs.js';

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const loc = useLocation();

  useEffect(() => {
    if (me.data) applyPrefs(me.data.preferences);
  }, [me.data]);

  if (me.isPending) return <div className="route-loading">טוען…</div>;
  if (me.error instanceof ApiError && me.error.status === 401)
    return <Navigate to={`/login?returnTo=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (me.error)
    return (
      <div className="empty">
        <b>השרת לא זמין</b>
        {me.error.message}
      </div>
    );
  return <>{children}</>;
}
