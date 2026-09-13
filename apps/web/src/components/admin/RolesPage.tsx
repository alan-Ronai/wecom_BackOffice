import { ADMIN_LOCKED, PERMISSIONS, type Permission } from '@wecom/shared';
import { useDeleteRole, useRoles, useUpsertRole } from '../../api/hooks/admin.js';
import { useCan } from '../../api/hooks/me.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';

/** Permission matrix: PERMISSIONS × roles, with the admin role's locked cells disabled. */
export function RolesPage() {
  const roles = useRoles();
  const upsert = useUpsertRole();
  const remove = useDeleteRole();
  const modal = useModal();
  const toast = useToast();
  const can = useCan();
  const mayEdit = can('roles.manage');
  const list = roles.data ?? [];

  const toggle = (roleId: string, p: Permission, on: boolean) => {
    const role = list.find((r) => r.id === roleId);
    if (!role) return;
    const permissions = on ? [...role.permissions, p] : role.permissions.filter((x) => x !== p);
    upsert.mutate({ id: role.id, name: role.name, description: role.description, permissions });
  };

  return (
    <>
      <div className="lib-head">
        <div>
          <h1>
            תפקידים והרשאות<span>{list.length} תפקידים</span>
          </h1>
          <p>הרשאות נאכפות בשרת; המסך מסתיר או מנטרל פקדים בהתאם.</p>
        </div>
        {mayEdit ? (
          <button
            className="btn primary sm"
            onClick={async () => {
              const name = await modal.prompt('תפקיד חדש', 'שם התפקיד');
              if (!name?.trim()) return;
              await upsert.mutateAsync({ name: name.trim(), description: '', permissions: ['docs.read'] });
              toast('התפקיד נוצר', 'ok');
            }}
          >
            ✚ תפקיד חדש
          </button>
        ) : null}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table perm-matrix">
          <thead>
            <tr>
              <th>הרשאה</th>
              {list.map((r) => (
                <th key={r.id}>{r.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((p) => (
              <tr key={p}>
                <td>
                  <bdi className="lat" dir="ltr">
                    {p}
                  </bdi>
                </td>
                {list.map((r) => {
                  const locked = r.name === 'admin' && ADMIN_LOCKED.includes(p);
                  return (
                    <td key={r.id}>
                      <input
                        type="checkbox"
                        aria-label={`${p} · ${r.name}`}
                        checked={r.permissions.includes(p)}
                        disabled={!mayEdit || locked}
                        onChange={(e) => toggle(r.id, p, e.target.checked)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            {mayEdit ? (
              <tr>
                <td />
                {list.map((r) => (
                  <td key={r.id}>
                    {r.system ? (
                      <span className="small muted">מערכת</span>
                    ) : (
                      <button
                        className="btn xs danger"
                        onClick={async () => {
                          const ok = await modal.confirm(
                            'מחיקת תפקיד',
                            `התפקיד "${r.name}" יוסר מכל המשתמשים.`,
                            'מחק',
                            'danger',
                          );
                          if (ok) await remove.mutateAsync(r.id);
                        }}
                      >
                        מחק
                      </button>
                    )}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
