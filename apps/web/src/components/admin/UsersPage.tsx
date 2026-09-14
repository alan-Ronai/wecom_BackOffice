import { useState } from 'react';
import type { Category } from '@wecom/shared';
import { useCreateUser, usePatchUser, useRoles } from '../../api/hooks/admin.js';
import { useAdminUsers } from '../../api/hooks/stage5.js';
import { useCan } from '../../api/hooks/me.js';
import type { AdminUserRow, AdminUsersQuery } from '../../api/stage5.js';
import { CATS, CAT_KEYS } from '../../lib/constants.js';
import { ago, fmtDate } from '../../lib/format.js';
import { useDebounced } from '../../lib/useDebounced.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { Chip, LoadError } from '../ui/index.js';

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
  scope?.length ? scope.map((c) => CATS[c]?.label ?? c).join(' · ') : 'כל הקטגוריות';

/**
 * The role + category-scope editor. Kept in a dialog rather than as two inline selects: a scope is
 * a *set* of categories, and the old single-select silently collapsed a two-category grant to one
 * every time anybody touched the row's role.
 */
function RoleEditor({
  user,
  roles,
  onSave,
}: {
  user: AdminUserRow;
  roles: { id: string; name: string }[];
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
          {CAT_KEYS.map((c) => (
            <label key={c} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                aria-label={CATS[c].label}
                checked={scope.includes(c)}
                onChange={(e) => setScope((s) => (e.target.checked ? [...s, c] : s.filter((x) => x !== c)))}
              />
              {CATS[c].label}
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
  const patch = usePatchUser();
  const create = useCreateUser();
  const modal = useModal();
  const toast = useToast();
  const can = useCan();
  const mayEdit = can('users.manage');

  const roleOptions = (roles.data ?? []).map((r) => ({ id: r.id, name: r.name }));
  const items = users.data?.items ?? [];

  const editRoles = (u: AdminUserRow) =>
    modal.open({
      title: `תפקיד · ${u.displayName}`,
      body: (
        <RoleEditor
          user={u}
          roles={roleOptions}
          onSave={async (roleId, categoryScope) => {
            modal.close();
            await patch.mutateAsync({ id: u.id, roles: [{ roleId, categoryScope }] });
            toast('התפקיד עודכן', 'ok');
          }}
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
            onChange={(e) => setSearch(e.target.value)}
          />
          <select aria-label="סינון לפי תפקיד" value={role} onChange={(e) => setRole(e.target.value)}>
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
            onClick={() => setTab(i)}
          >
            {label}
          </span>
        ))}
      </div>

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
              <tr key={u.id}>
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
                    onChange={async (e) => {
                      const active = e.target.checked;
                      await patch.mutateAsync({ id: u.id, active });
                      toast(active ? 'החשבון הופעל' : 'החשבון הושבת', 'ok');
                    }}
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
