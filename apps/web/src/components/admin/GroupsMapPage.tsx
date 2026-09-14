import { useEffect, useMemo, useState } from 'react';
import { useGroupsMap, useRoles, useSaveGroupsMap } from '../../api/hooks/admin.js';
import { useRoleMatrix } from '../../api/hooks/stage5.js';
import { useCan } from '../../api/hooks/me.js';
import { useToast } from '../ui/Toast.js';
import { LoadError } from '../ui/index.js';
import type { GroupMap } from '../../api/types.js';

const same = (a: GroupMap[], b: GroupMap[]) =>
  a.length === b.length &&
  a.every(
    (x, i) =>
      x.idpGroupId === b[i].idpGroupId && x.idpGroupName === b[i].idpGroupName && x.roleId === b[i].roleId,
  );

export function GroupsMapPage() {
  const map = useGroupsMap();
  const roles = useRoles();
  const matrix = useRoleMatrix();
  const save = useSaveGroupsMap();
  const toast = useToast();
  const can = useCan();
  const mayEdit = can('roles.manage');
  const [entries, setEntries] = useState<GroupMap[]>([]);

  useEffect(() => {
    if (map.data) setEntries(map.data);
  }, [map.data]);

  const dirty = !!map.data && !same(entries, map.data);
  const roleList = roles.data ?? [];

  /** roleId → how many users already hold it, so a mapping's reach is visible before saving. */
  const userCounts = useMemo(
    () => Object.fromEntries((matrix.data?.roles ?? []).map((r) => [r.id, r.users])),
    [matrix.data],
  );

  const patch = (i: number, p: Partial<GroupMap>) =>
    setEntries((list) => list.map((e, j) => (j === i ? { ...e, ...p } : e)));

  const incomplete = entries.some((e) => !e.idpGroupId.trim() || !e.roleId);

  return (
    <>
      {map.isError ? <LoadError what="מיפוי הקבוצות" error={map.error} /> : null}
      <div className="lib-head">
        <div>
          <h1>
            מיפוי קבוצות<span>{entries.length} מיפויים</span>
          </h1>
          <p>קבוצת Entra ID → תפקיד. משתמש שהוסר מהקבוצה מאבד את התפקיד בכניסה הבאה, לא באמצע פעילות.</p>
        </div>
      </div>

      {!entries.length && !map.isPending ? (
        <div className="empty">
          <b>אין מיפויים</b>
          בלי מיפוי, משתמש שנכנס דרך Entra ID מקבל את תפקיד ברירת המחדל בלבד
        </div>
      ) : null}

      {entries.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>מזהה קבוצה</th>
              <th>שם הקבוצה</th>
              <th>תפקיד</th>
              <th>משתמשים בתפקיד</th>
              {mayEdit ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              // Keyed by position, not by `idpGroupId`: that field is being typed into, and a key
              // that changes on every keystroke remounts the input and eats the focus with it.
              <tr key={i}>
                <td>
                  <input
                    aria-label={`מזהה קבוצה ${i + 1}`}
                    value={e.idpGroupId}
                    disabled={!mayEdit}
                    onChange={(ev) => patch(i, { idpGroupId: ev.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`שם קבוצה ${i + 1}`}
                    value={e.idpGroupName}
                    disabled={!mayEdit}
                    onChange={(ev) => patch(i, { idpGroupName: ev.target.value })}
                  />
                </td>
                <td>
                  <select
                    aria-label={`תפקיד לקבוצה ${i + 1}`}
                    value={e.roleId}
                    disabled={!mayEdit}
                    onChange={(ev) => patch(i, { roleId: ev.target.value })}
                  >
                    <option value="">— בחרו תפקיד —</option>
                    {roleList.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="small muted">{userCounts[e.roleId] ?? '—'}</td>
                {mayEdit ? (
                  <td>
                    <button
                      className="btn xs danger"
                      aria-label={`הסר מיפוי ${i + 1}`}
                      onClick={() => setEntries((l) => l.filter((_, j) => j !== i))}
                    >
                      הסר
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {mayEdit ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <button
            className="btn sm"
            onClick={() => setEntries((l) => [...l, { idpGroupId: '', idpGroupName: '', roleId: '' }])}
          >
            ✚ הוסף מיפוי
          </button>
          <button
            className="btn primary sm"
            // A half-filled row would be saved as a mapping to nowhere; the server rejects it and
            // the whole PUT fails, losing the rest of the operator's edits with it.
            disabled={!dirty || incomplete || save.isPending}
            onClick={async () => {
              await save.mutateAsync(entries);
              toast('המיפוי נשמר', 'ok');
            }}
          >
            שמור
          </button>
          {incomplete ? <span className="field-error">יש מיפוי בלי מזהה קבוצה או בלי תפקיד</span> : null}
          {dirty && !incomplete ? <span className="small muted">שינוי שלא נשמר</span> : null}
        </div>
      ) : null}
    </>
  );
}
