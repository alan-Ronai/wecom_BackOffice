import { useState } from 'react';
import type { Category } from '@wecom/shared';
import { useCreateUser, usePatchUser, useRoles } from '../../api/hooks/admin.js';
import { useAdminUsers } from '../../api/hooks/stage5.js';
import { useCan } from '../../api/hooks/me.js';
import type { AdminUserRow, AdminUsersQuery } from '../../api/stage5.js';
import { useWorlds } from '../../api/hooks/taxonomy.js';
import { cat } from '../../lib/constants.js';
import { ago, fmtDate } from '../../lib/format.js';
import { useDebounced } from '../../lib/useDebounced.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { Chip, LoadError } from '../ui/index.js';
import { users as nUsers } from '../../lib/count.js';

const SOURCE_LABEL: Record<AdminUserRow['source'], string> = {
  entra: 'Entra',
  paloalto: 'GlobalProtect',
  local: 'מקומי',
};

/** The facet strip: one filter object per tab, so "לא פעילים" is a tab and not a second control. */
const TABS: [string, AdminUsersQuery][] = [
  ['הכל', {}],
  ['Entra', { source: 'entra' }],
  ['GlobalProtect', { source: 'paloalto' }],
  ['מקומי', { source: 'local' }],
  ['לא פעילים', { active: false }],
];

const scopeLabel = (scope: Category[] | null | undefined): string =>
  scope?.length ? scope.map((c) => cat(c).label).join(' · ') : 'כל הקטגוריות';

/**
 * The role + category-scope editor. Kept in a dialog rather than as two inline selects: a scope is
 * a *set* of categories, and the old single-select silently collapsed a two-category grant to one
 * every time anybody touched the row's role.
 */
function RoleEditor({
  user,
  roles,
  worlds,
  onSave,
}: {
  user: AdminUserRow;
  roles: { id: string; name: string }[];
  /** Slugs from `GET /worlds`, not the six seeded keys: a world an admin just created has to be
      grantable without a deploy (spec §9). Passed as a prop because the dialog body is rendered
      through `modal.open`, and a query hook belongs on the page that owns the data. */
  worlds: string[];
  onSave: (roleId: string, categoryScope: Category[] | null) => void;
}) {
  const [roleId, setRoleId] = useState(user.roles[0]?.roleId ?? roles[0]?.id ?? '');
  const [scope, setScope] = useState<Category[]>(user.roles[0]?.categoryScope ?? []);
  const [allCats, setAllCats] = useState(!user.roles[0]?.categoryScope?.length);

  return (
    <div className="form">
      <label>
        תפקיד
        <select aria-label="תפקיד" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          aria-label="כל הקטגוריות"
          checked={allCats}
          onChange={(e) => setAllCats(e.target.checked)}
        />
        כל הקטגוריות
      </label>
      {!allCats ? (
        <div className="cat-checks">
          {worlds.map((c) => (
            <label key={c} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                aria-label={cat(c).label}
                checked={scope.includes(c)}
                onChange={(e) => setScope((s) => (e.target.checked ? [...s, c] : s.filter((x) => x !== c)))}
              />
              {cat(c).label}
            </label>
          ))}
        </div>
      ) : null}
      <div className="small muted">הרשאות ה-docs של התפקיד יחולו רק על הקטגוריות שנבחרו.</div>
      <button className="btn primary" onClick={() => onSave(roleId, allCats || !scope.length ? null : scope)}>
        שמור תפקיד
      </button>
    </div>
  );
}

function CreateUserForm({
  roles,
  onCreate,
}: {
  roles: { id: string; name: string }[];
  onCreate: (body: { email: string; password: string; displayName: string; roleId: string }) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '');
  // The route enforces this too; saying so up front beats a 400 the operator has to decode.
  const tooShort = password.length > 0 && password.length < 12;

  return (
    <div className="form">
      <label>
        דוא״ל
        <input aria-label="דוא״ל" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        שם לתצוגה
        <input aria-label="שם לתצוגה" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label>
        סיסמה
        <input
          aria-label="סיסמה"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {tooShort ? <div className="field-error">לפחות 12 תווים</div> : null}
      <label>
        תפקיד
        <select aria-label="תפקיד לחשבון" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <div className="small muted">
        חשבון מקומי לא עובר דרך Entra ID — לשימוש כחשבון שירות או ככניסת חירום בלבד.
      </div>
      <button
        className="btn primary"
        disabled={!email || password.length < 12}
        onClick={() => onCreate({ email, password, displayName: displayName || email, roleId })}
      >
        צור חשבון
      </button>
    </div>
  );
}

export function UsersPage() {
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const q = useDebounced(search, 200);

  const query: AdminUsersQuery = { ...TABS[tab][1], ...(q ? { q } : {}), ...(role ? { role } : {}) };
  const users = useAdminUsers(query);
  const roles = useRoles();
  const worlds = useWorlds();
  const patch = usePatchUser();
  const create = useCreateUser();
  const modal = useModal();
  const toast = useToast();
  const can = useCan();
  const mayEdit = can('users.manage');

  const roleOptions = (roles.data ?? []).map((r) => ({ id: r.id, name: r.name }));
  const worldSlugs = (worlds.data ?? []).map((w) => w.slug);
  const items = users.data?.items ?? [];

  /**
   * Selection is keyed by id and cleared whenever the filter changes.
   *
   * Keeping a selection across a filter change would let "assign lead to the 4 selected" act on
   * rows the operator can no longer see, which is the one way a bulk toolbar becomes dangerous.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const visibleSelected = items.filter((u) => selected.has(u.id));
  const allSelected = !!items.length && visibleSelected.length === items.length;
  const toggleOne = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /**
   * Bulk assign: one PATCH per user, because `PATCH /admin/users/{id}` is what the contract
   * publishes and there is no bulk route. `allSettled` so one 403 does not leave the rest
   * unattempted, and the toast reports the real count rather than claiming success for all.
   */
  const bulkAssign = (roleId: string, categoryScope: Category[] | null) => {
    const targets = visibleSelected;
    modal.close();
    void (async () => {
      const results = await Promise.allSettled(
        targets.map((u) => patch.mutateAsync({ id: u.id, roles: [{ roleId, categoryScope }] })),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      setSelected(new Set());
      toast(
        failed
          ? `${targets.length - failed} מתוך ${targets.length} משתמשים עודכנו`
          : `התפקיד הוקצה ל-${nUsers(targets.length)}`,
        failed ? 'warn' : 'ok',
      );
    })();
  };

  /**
   * Deactivating is one click away from locking somebody out mid-shift, and the row's checkbox
   * gives no pause before it happens. The undo is the pause: the toast holds the reverse patch
   * for six seconds, which is long enough to notice the wrong row and short enough that it is
   * not a second, competing source of truth.
   */
  const setActive = async (u: AdminUserRow, active: boolean) => {
    await patch.mutateAsync({ id: u.id, active });
    toast(active ? 'החשבון הופעל' : 'החשבון הושבת', 'ok', () => {
      void (async () => {
        await patch.mutateAsync({ id: u.id, active: !active });
        toast(active ? 'ההפעלה בוטלה' : 'ההשבתה בוטלה', 'ok');
      })();
    });
  };

  const editRoles = (u: AdminUserRow) =>
    modal.open({
      title: `תפקיד · ${u.displayName}`,
      body: (
        <RoleEditor
          user={u}
          roles={roleOptions}
          worlds={worldSlugs}
          onSave={async (roleId, categoryScope) => {
            modal.close();
            await patch.mutateAsync({ id: u.id, roles: [{ roleId, categoryScope }] });
            toast('התפקיד עודכן', 'ok');
          }}
        />
      ),
      buttons: [{ label: 'ביטול' }],
    });

  const bulkRoleDialog = () =>
    modal.open({
      title: `הקצאת תפקיד ל-${nUsers(visibleSelected.length)}`,
      body: (
        <RoleEditor
          // Seeded from the first selected user so the dialog opens on something, not on blank.
          user={visibleSelected[0]}
          roles={roleOptions}
          worlds={worldSlugs}
          onSave={bulkAssign}
        />
      ),
      buttons: [{ label: 'ביטול' }],
    });

  const newLocalUser = () =>
    modal.open({
      title: 'חשבון מקומי / חשבון שירות',
      body: (
        <CreateUserForm
          roles={roleOptions}
          onCreate={async (b) => {
            modal.close();
            try {
              await create.mutateAsync({
                email: b.email,
                password: b.password,
                displayName: b.displayName,
                roles: b.roleId ? [{ roleId: b.roleId, categoryScope: null }] : undefined,
              });
              toast('החשבון נוצר', 'ok');
            } catch (e) {
              toast(e instanceof Error ? e.message : 'יצירת החשבון נכשלה', 'warn');
            }
          }}
        />
      ),
      buttons: [{ label: 'ביטול' }],
    });

  return (
    <>
      <div className="lib-head">
        <div>
          <h1>
            משתמשים<span>{users.data?.total ?? 0} חשבונות</span>
          </h1>
          <p>משתמשים פדרטיביים נוצרים בכניסה הראשונה דרך Entra ID; חשבון מקומי נוצר כאן, לחירום או לשירות.</p>
        </div>
        <div className="facets">
          <input
            aria-label="חיפוש משתמש"
            placeholder="חפש לפי שם או דוא״ל"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelected(new Set());
            }}
          />
          <select
            aria-label="סינון לפי תפקיד"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setSelected(new Set());
            }}
          >
            <option value="">כל התפקידים</option>
            {roleOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {mayEdit ? (
            <button className="btn primary sm" onClick={newLocalUser}>
              ✚ משתמש מקומי
            </button>
          ) : null}
        </div>
      </div>

      <div className="pill-toggle" role="tablist" aria-label="סינון לפי מקור">
        {TABS.map(([label], i) => (
          <span
            key={label}
            role="tab"
            tabIndex={0}
            aria-selected={i === tab}
            className={i === tab ? 'on' : ''}
            onClick={() => {
              setTab(i);
              setSelected(new Set());
            }}
          >
            {label}
          </span>
        ))}
      </div>

      {mayEdit && visibleSelected.length ? (
        /* The same floating pill the library's list mode uses — a second bulk-action treatment
           would be a second thing to learn for the same idea. */
        <div className="bulkbar" role="region" aria-label="פעולות על המשתמשים שנבחרו">
          <b>{visibleSelected.length} נבחרו</b>
          <button className="btn sm primary" onClick={bulkRoleDialog}>
            הקצה תפקיד
          </button>
          <button className="btn sm" onClick={() => setSelected(new Set())}>
            נקה בחירה
          </button>
        </div>
      ) : null}

      {users.isError ? <LoadError what="משתמשים" error={users.error} /> : null}
      {!users.isPending && !users.isError && !items.length ? (
        <div className="empty">
          <b>אין משתמשים שמתאימים לסינון</b>
          נסו מסנן אחר או נקו את החיפוש
        </div>
      ) : null}

      {items.length ? (
        <table className="table">
          <thead>
            <tr>
              {mayEdit ? (
                <th>
                  <input
                    type="checkbox"
                    aria-label="בחר את כל המשתמשים המוצגים"
                    checked={allSelected}
                    onChange={(e) => setSelected(new Set(e.target.checked ? items.map((u) => u.id) : []))}
                  />
                </th>
              ) : null}
              <th>משתמש</th>
              <th>מקור</th>
              <th>תפקידים</th>
              <th>היקף קטגוריות</th>
              <th>קבוצות</th>
              <th>מושבים</th>
              <th>כניסה אחרונה</th>
              <th>פעיל</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id} className={selected.has(u.id) ? 'sel' : ''}>
                {mayEdit ? (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`בחר את ${u.displayName}`}
                      checked={selected.has(u.id)}
                      onChange={(e) => toggleOne(u.id, e.target.checked)}
                    />
                  </td>
                ) : null}
                <td>
                  <b>{u.displayName}</b>
                  <div className="small muted">
                    <bdi className="lat" dir="ltr">
                      {u.email ?? u.subject}
                    </bdi>
                  </div>
                </td>
                <td>
                  <Chip tone={u.source === 'local' ? 'chip-amber' : 'chip-gray'}>
                    {SOURCE_LABEL[u.source]}
                  </Chip>
                </td>
                <td>
                  {u.roles.length ? (
                    u.roles.map((r) => (
                      <Chip key={r.roleId} tone="chip-blue">
                        {r.roleName}
                      </Chip>
                    ))
                  ) : (
                    <span className="small muted">ללא תפקיד</span>
                  )}
                  {mayEdit ? (
                    <button
                      className="btn xs"
                      style={{ marginInlineStart: 6 }}
                      onClick={() => editRoles(u)}
                      aria-label={`ערוך תפקיד של ${u.displayName}`}
                    >
                      ערוך
                    </button>
                  ) : null}
                </td>
                <td>{scopeLabel(u.roles[0]?.categoryScope)}</td>
                <td className="small muted">{u.groups.length ? u.groups.join(', ') : '—'}</td>
                <td>{u.sessions ? <Chip tone="chip-green">{u.sessions}</Chip> : '—'}</td>
                <td title={u.lastLoginAt ? fmtDate(u.lastLoginAt) : undefined}>
                  {u.lastLoginAt ? ago(u.lastLoginAt) : 'מעולם לא'}
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`פעיל: ${u.displayName}`}
                    checked={u.active}
                    disabled={!mayEdit}
                    onChange={(e) => void setActive(u, e.target.checked)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
