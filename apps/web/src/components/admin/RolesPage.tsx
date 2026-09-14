import { Fragment, useMemo, useState } from 'react';
import { ADMIN_LOCKED, type Permission } from '@wecom/shared';
import { useDeleteRole, useUpsertRole } from '../../api/hooks/admin.js';
import { useRoleMatrix } from '../../api/hooks/stage5.js';
import { useCan } from '../../api/hooks/me.js';
import type { MatrixRole } from '../../api/stage5.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { LoadError } from '../ui/index.js';

/** roleId → the permissions it should have once the operator presses שמור. */
type Draft = Record<string, Permission[]>;

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/**
 * The matrix comes from `GET /admin/roles/matrix`, which carries what the old `GET /admin/roles`
 * could not: each permission's resource group and human description, and how many users hold each
 * role — the number that turns "untick fields.edit" from a shrug into a decision.
 *
 * Edits are staged locally and saved per changed role, so toggling five cells is one review and
 * one save rather than five round trips (and five audit entries) as the operator thinks aloud.
 */
export function RolesPage() {
  const matrix = useRoleMatrix();
  const upsert = useUpsertRole();
  const remove = useDeleteRole();
  const modal = useModal();
  const toast = useToast();
  const can = useCan();
  const mayEdit = can('roles.manage');

  const [draft, setDraft] = useState<Draft>({});

  const roles = matrix.data?.roles ?? [];
  const permissions = matrix.data?.permissions ?? [];

  /** Permissions in the order the server sent them, grouped by resource for the row headers. */
  const groups = useMemo(() => {
    const out: { resource: string; rows: typeof permissions }[] = [];
    for (const p of permissions) {
      const last = out.at(-1);
      if (last && last.resource === p.resource) last.rows.push(p);
      else out.push({ resource: p.resource, rows: [p] });
    }
    return out;
  }, [permissions]);

  const permsOf = (r: MatrixRole): Permission[] => draft[r.id] ?? r.permissions;
  const isDirty = (r: MatrixRole) => !!draft[r.id] && !sameSet(draft[r.id], r.permissions);
  const dirty = roles.filter(isDirty);

  /** The admin role must keep the keys to the building — the server refuses this too. */
  const locked = (r: MatrixRole, p: Permission) => r.name === 'admin' && ADMIN_LOCKED.includes(p);

  const toggle = (r: MatrixRole, p: Permission, on: boolean) =>
    setDraft((d) => {
      const current = d[r.id] ?? r.permissions;
      return { ...d, [r.id]: on ? [...current, p] : current.filter((x) => x !== p) };
    });

  const save = async () => {
    for (const r of dirty) {
      await upsert.mutateAsync({ id: r.id, name: r.name, description: '', permissions: permsOf(r) });
    }
    setDraft({});
    toast(`נשמרו ${dirty.length} תפקידים`, 'ok');
  };

  return (
    <>
      {matrix.isError ? <LoadError what="מטריצת ההרשאות" error={matrix.error} /> : null}
      <div className="lib-head">
        <div>
          <h1>
            תפקידים והרשאות<span>{roles.length} תפקידים</span>
          </h1>
          <p>הרשאות נאכפות בשרת; המסך מסתיר או מנטרל פקדים בהתאם.</p>
        </div>
        {mayEdit ? (
          <div className="facets">
            <button
              className="btn sm"
              onClick={async () => {
                const name = await modal.prompt('תפקיד חדש', 'שם התפקיד');
                if (!name?.trim()) return;
                await upsert.mutateAsync({ name: name.trim(), description: '', permissions: ['docs.read'] });
                toast('התפקיד נוצר', 'ok');
              }}
            >
              ✚ תפקיד
            </button>
            <button
              className="btn primary sm"
              disabled={!dirty.length || upsert.isPending}
              onClick={() => void save()}
            >
              {dirty.length ? `שמור (${dirty.length} שינויים)` : 'שמור'}
            </button>
          </div>
        ) : null}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="table perm-matrix">
          <thead>
            <tr>
              <th>הרשאה</th>
              {roles.map((r) => (
                <th key={r.id} className={isDirty(r) ? 'dirty' : ''}>
                  {r.name}
                  <div className="small muted">{r.users} משתמשים</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.resource}>
                <tr className="grouprow">
                  <th colSpan={roles.length + 1}>{g.resource}</th>
                </tr>
                {g.rows.map((p) => (
                  <tr key={p.name}>
                    <td>
                      <bdi className="lat" dir="ltr">
                        {p.name}
                      </bdi>
                      <div className="small muted">{p.description}</div>
                    </td>
                    {roles.map((r) => {
                      const isLocked = locked(r, p.name);
                      return (
                        <td key={r.id}>
                          <input
                            type="checkbox"
                            aria-label={`${p.name} · ${r.name}`}
                            checked={permsOf(r).includes(p.name)}
                            disabled={!mayEdit || isLocked}
                            title={isLocked ? 'נעול בתפקיד מנהל' : undefined}
                            onChange={(e) => toggle(r, p.name, e.target.checked)}
                          />
                          {isLocked ? <span aria-hidden="true"> 🔒</span> : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
            {mayEdit ? (
              <tr>
                <td className="small muted">תפקידי מערכת לא נמחקים</td>
                {roles.map((r) => (
                  <td key={r.id}>
                    {r.system ? (
                      <span className="small muted">מערכת</span>
                    ) : (
                      <button
                        className="btn xs danger"
                        onClick={async () => {
                          const ok = await modal.confirm(
                            'מחיקת תפקיד',
                            `התפקיד "${r.name}" יוסר מ-${r.users} משתמשים.`,
                            'מחק',
                            'danger',
                          );
                          if (!ok) return;
                          await remove.mutateAsync(r.id);
                          toast('התפקיד נמחק', 'ok');
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

      {dirty.length ? (
        <div className="small muted" style={{ marginTop: 10 }}>
          שינוי שלא נשמר ב-{dirty.map((r) => r.name).join(' · ')} · {dirty[0].users} משתמשים מושפעים
        </div>
      ) : null}
      <div className="small muted" style={{ marginTop: 6 }}>
        תפקיד מנהל לא יכול לאבד את{' '}
        <bdi className="lat" dir="ltr">
          {ADMIN_LOCKED.join(' / ')}
        </bdi>{' '}
        — זה נועל את המערכת מחוץ להישג יד.
      </div>
    </>
  );
}
