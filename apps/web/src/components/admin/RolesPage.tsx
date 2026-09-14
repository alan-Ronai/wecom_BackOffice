import { Fragment, useMemo, useState } from 'react';
import { ADMIN_LOCKED, type Permission } from '@wecom/shared';
import { useDeleteRole, useUpsertRole } from '../../api/hooks/admin.js';
import { useRoleMatrix } from '../../api/hooks/stage5.js';
import { useCan } from '../../api/hooks/me.js';
import type { MatrixRole } from '../../api/stage5.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { LoadError } from '../ui/index.js';
import { counted, users as nUsers } from '../../lib/count.js';

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

  /**
   * roleId → the role it is a strict superset of, if any (card 3c's "ירושה מתפקיד נמוך").
   *
   * The roles are not a declared hierarchy — the contract publishes a flat list — but the system
   * roles are one in practice (`agent ⊂ lead ⊂ admin`), and that containment is visible in the
   * data. Computing it rather than hard-coding the three names means a system role added later
   * slots into the picture on its own, and one that breaks the pattern shows no inheritance
   * instead of a wrong one.
   *
   * Only **system** roles can be a base. A custom role is an ad-hoc set, not a rung: "צוות חו״ל"
   * happening to be a subset of `lead` is a coincidence of who was given what, and describing
   * lead as built on it would be both wrong and unstable — every custom role anyone adds would
   * rewrite the picture for the roles that actually are a ladder.
   *
   * Among the eligible bases, each role takes the **largest** one it strictly contains, so
   * `admin` reads as inheriting from `lead` rather than from `agent` — the nearest rung, which is
   * the one an operator would name.
   */
  const inheritsFrom = useMemo(() => {
    const out: Record<string, MatrixRole | undefined> = {};
    for (const r of roles) {
      const mine = new Set(permsOf(r));
      out[r.id] = roles
        .filter((o) => o.system && o.id !== r.id && o.permissions.length < mine.size)
        .filter((o) => o.permissions.every((p) => mine.has(p)))
        .sort((a, b) => b.permissions.length - a.permissions.length)[0];
    }
    return out;
    // `draft` rather than `permsOf`: the picture has to follow unsaved edits, or a cell the
    // operator just ticked would keep describing the state before they touched it.
  }, [roles, draft]);

  /** Held here, and also held by the role this one is built on — so it is not a free choice. */
  const inherited = (r: MatrixRole, p: Permission) =>
    permsOf(r).includes(p) && !!inheritsFrom[r.id]?.permissions.includes(p);

  /**
   * The "מה משתנה" preview: every cell that differs from what the server currently has, in
   * words, before anything is written.
   *
   * `שמור (3 שינויים)` counts *roles*, which answers "how many requests" and not "what did I
   * actually do" — and after five minutes of ticking, the second question is the one an operator
   * cannot answer from the grid alone.
   */
  const changes = useMemo(
    () =>
      roles.flatMap((r) => {
        const before = new Set(r.permissions);
        const after = new Set(permsOf(r));
        return [
          ...[...after].filter((p) => !before.has(p)).map((p) => ({ role: r, perm: p, added: true })),
          ...[...before].filter((p) => !after.has(p)).map((p) => ({ role: r, perm: p, added: false })),
        ];
      }),
    [roles, draft],
  );

  const showChanges = () =>
    modal.open({
      title: 'מה משתנה',
      body: (
        <div className="change-preview">
          {changes.map(({ role, perm, added }) => (
            <div key={`${role.id}:${perm}`} className="change-row">
              <span className={added ? 'added' : 'removed'}>{added ? '✚' : '✕'}</span>
              <b>{role.name}</b>
              <bdi className="lat" dir="ltr">
                {perm}
              </bdi>
              <span className="small muted">{nUsers(role.users)}</span>
            </div>
          ))}
        </div>
      ),
      buttons: [{ label: 'סגור' }],
    });

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
            <button className="btn sm" disabled={!changes.length} onClick={showChanges}>
              מה משתנה
            </button>
            <button
              className="btn primary sm"
              disabled={!dirty.length || upsert.isPending}
              onClick={() => void save()}
            >
              {changes.length ? `שמור (${changes.length} שינויים)` : 'שמור'}
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
                  <div className="small muted">{nUsers(r.users)}</div>
                  {inheritsFrom[r.id] ? (
                    <div className="small muted">כולל את {inheritsFrom[r.id]!.name}</div>
                  ) : null}
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
                      const isInherited = !isLocked && inherited(r, p.name);
                      const base = inheritsFrom[r.id];
                      return (
                        <td key={r.id} className={isInherited ? 'inherited' : ''}>
                          <input
                            type="checkbox"
                            // The label *names* the cell and nothing else; the state goes in
                            // `title`, which AT reads as the description. A name that changes
                            // when the state does is a name you cannot refer to.
                            aria-label={`${p.name} · ${r.name}`}
                            checked={permsOf(r).includes(p.name)}
                            disabled={!mayEdit || isLocked}
                            title={
                              isLocked
                                ? 'נעול בתפקיד מנהל'
                                : isInherited
                                  ? `בירושה מתפקיד ${base!.name}`
                                  : undefined
                            }
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
                            `התפקיד "${r.name}" יוסר מ-${nUsers(r.users)}.`,
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
          שינוי שלא נשמר ב-{dirty.map((r) => r.name).join(' · ')} ·{' '}
          {counted(dirty[0].users, nUsers, 'מושפע', 'מושפעים')}
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
