import type { Category } from '@wecom/shared';
import { usePatchUser, useRoles, useUsers } from '../../api/hooks/admin.js';
import { useCan } from '../../api/hooks/me.js';
import { CATS, CAT_KEYS } from '../../lib/constants.js';
import { fmtDate } from '../../lib/format.js';

export function UsersPage() {
  const users = useUsers();
  const roles = useRoles();
  const patch = usePatchUser();
  const can = useCan();
  const mayEdit = can('users.manage');

  return (
    <>
      <div className="lib-head">
        <div>
          <h1>
            משתמשים<span>{users.data?.total ?? 0} חשבונות</span>
          </h1>
          <p>משתמשים נוצרים בכניסה הראשונה דרך Entra ID; תפקידים אפשר להגביל לקטגוריות.</p>
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>שם</th>
            <th>דוא״ל</th>
            <th>מקור</th>
            <th>תפקידים</th>
            <th>היקף קטגוריות</th>
            <th>כניסה אחרונה</th>
            <th>פעיל</th>
          </tr>
        </thead>
        <tbody>
          {(users.data?.items ?? []).map((u) => (
            <tr key={u.id}>
              <td>{u.displayName}</td>
              <td>
                <bdi className="lat" dir="ltr">
                  {u.email ?? '—'}
                </bdi>
              </td>
              <td>{u.source}</td>
              <td>
                {mayEdit ? (
                  <select
                    aria-label={`תפקיד של ${u.displayName}`}
                    value={u.roles?.[0]?.roleId ?? ''}
                    onChange={(e) =>
                      patch.mutate({
                        id: u.id,
                        roles: [
                          { roleId: e.target.value, categoryScope: u.roles?.[0]?.categoryScope ?? null },
                        ],
                      })
                    }
                  >
                    {(roles.data ?? []).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  (u.roles ?? []).map((r) => r.roleName).join(', ')
                )}
              </td>
              <td>
                {u.roles?.[0]?.categoryScope?.length
                  ? u.roles[0].categoryScope.map((c) => CATS[c as keyof typeof CATS]?.label ?? c).join(' · ')
                  : 'כל הקטגוריות'}
                {mayEdit ? (
                  <select
                    aria-label={`היקף קטגוריות של ${u.displayName}`}
                    value={u.roles?.[0]?.categoryScope?.[0] ?? ''}
                    onChange={(e) =>
                      patch.mutate({
                        id: u.id,
                        roles: [
                          {
                            roleId: u.roles?.[0]?.roleId ?? '',
                            categoryScope: e.target.value ? [e.target.value as Category] : null,
                          },
                        ],
                      })
                    }
                  >
                    <option value="">כל הקטגוריות</option>
                    {CAT_KEYS.map((c) => (
                      <option key={c} value={c}>
                        {CATS[c].label}
                      </option>
                    ))}
                  </select>
                ) : null}
              </td>
              <td>{u.lastLoginAt ? fmtDate(u.lastLoginAt) : '—'}</td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`פעיל: ${u.displayName}`}
                  checked={u.active}
                  disabled={!mayEdit}
                  onChange={(e) => patch.mutate({ id: u.id, active: e.target.checked })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
