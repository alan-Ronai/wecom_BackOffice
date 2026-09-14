import { useEffect, useState } from 'react';
import type { ColumnMapping, DataFile, MappingField } from '../../api/stage4.js';
import { MAPPING_FIELDS } from '../../lib/constants.js';

const isTaken = (mapping: ColumnMapping[], field: MappingField, column: string): boolean =>
  field !== 'ignore' && mapping.some((m) => m.field === field && m.column !== column);

/**
 * Column → card-field mapping (design card 5a).
 *
 * The draft is local until "שמור מיפוי": a half-finished mapping that reached the server would
 * be picked up by the next scheduled import, so the save is explicit and the row-level state
 * ("ממופה" / "לא ממופה" / "כפול") is shown before it is committed rather than after.
 */
export function MappingEditor({
  file,
  canManage,
  saving,
  onSave,
}: {
  file: DataFile;
  canManage: boolean;
  saving: boolean;
  onSave: (mapping: ColumnMapping[]) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<ColumnMapping[]>(file.mapping);

  // A different file (or a mapping saved elsewhere) replaces the draft — a stale draft silently
  // shown against another file's columns is how the wrong column gets imported as the title.
  useEffect(() => setDraft(file.mapping), [file.sourceId, file.mapping]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(file.mapping);
  const mapped = draft.filter((m) => m.field !== 'ignore').length;
  const duplicates = draft.filter((m) => isTaken(draft, m.field, m.column)).length;

  return (
    <section className="card data-card">
      <div className="hd">
        <b>מיפוי עמודות לשדות הכרטיס</b>
        <span className="small muted">
          {mapped} מתוך {draft.length} עמודות ממופות
        </span>
        {canManage ? (
          <button
            className="btn sm primary"
            disabled={!dirty || saving || duplicates > 0}
            onClick={() => void onSave(draft)}
          >
            {saving ? 'שומר…' : 'שמור מיפוי'}
          </button>
        ) : null}
      </div>
      {duplicates ? (
        <div className="small" style={{ padding: '0 14px 8px', color: 'var(--red-dark)' }} role="alert">
          אותו שדה כרטיס ממופה ליותר מעמודה אחת — בחרו שדה אחר לפני השמירה.
        </div>
      ) : null}
      <div className="data-scroll">
        <table className="table" data-testid="mapping-table">
          <thead>
            <tr>
              <th>עמודה בקובץ</th>
              <th>דוגמה</th>
              <th>שדה בכרטיס</th>
              <th>מצב</th>
            </tr>
          </thead>
          <tbody>
            {draft.map((m) => {
              const dup = isTaken(draft, m.field, m.column);
              return (
                <tr key={m.column}>
                  <td>
                    <bdi className="lat" dir="ltr">
                      {m.column}
                    </bdi>
                  </td>
                  <td className="muted">{m.sample ?? '—'}</td>
                  <td>
                    <select
                      aria-label={`שדה בכרטיס עבור ${m.column}`}
                      value={m.field}
                      disabled={!canManage}
                      onChange={(e) =>
                        setDraft((d) =>
                          d.map((x) =>
                            x.column === m.column ? { ...x, field: e.target.value as MappingField } : x,
                          ),
                        )
                      }
                    >
                      {MAPPING_FIELDS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {dup ? (
                      <span className="chip chip-red">כפול</span>
                    ) : m.field === 'ignore' ? (
                      <span className="chip chip-amber">לא ממופה</span>
                    ) : (
                      <span className="chip chip-green">✓ ממופה</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
