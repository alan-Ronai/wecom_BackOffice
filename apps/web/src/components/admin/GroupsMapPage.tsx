import { useEffect, useState } from 'react';
import { useGroupsMap, useRoles, useSaveGroupsMap } from '../../api/hooks/admin.js';
import { useCan } from '../../api/hooks/me.js';
import { useToast } from '../ui/Toast.js';
import type { GroupMap } from '../../api/types.js';

export function GroupsMapPage() {
  const map = useGroupsMap();
  const roles = useRoles();
  const save = useSaveGroupsMap();
  const toast = useToast();
  const can = useCan();
  const mayEdit = can('roles.manage');
  const [entries, setEntries] = useState<GroupMap[]>([]);

  useEffect(() => {
    if (map.data) setEntries(map.data.entries);
  }, [map.data]);

  const patch = (i: number, p: Partial<GroupMap>) =>
    setEntries((list) => list.map((e, j) => (j === i ? { ...e, ...p } : e)));

  return (
    <>
      <div className="lib-head">
        <div>
          <h1>
            מיפוי קבוצות<span>{entries.length} מיפויים</span>
          </h1>
          <p>קבוצת Entra ID → תפקיד. הסנכרון הלילי מחיל את המיפוי על כל המשתמשים.</p>
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>מזהה קבוצה</th>
            <th>שם הקבוצה</th>
            <th>תפקיד</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={e.idpGroupId + i}>
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
                  {(roles.data ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {mayEdit ? (
        <div className="btns" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            className="btn sm"
            onClick={() =>
              setEntries((l) => [
                ...l,
                { idpGroupId: '', idpGroupName: '', roleId: roles.data?.[0]?.id ?? '' },
              ])
            }
          >
            + מיפוי
          </button>
          <button
            className="btn primary sm"
            onClick={async () => {
              await save.mutateAsync(entries);
              toast('המיפוי נשמר', 'ok');
            }}
          >
            שמור
          </button>
        </div>
      ) : null}
    </>
  );
}
