import { useEffect, useMemo, useState } from 'react';
import type { StructuredEdit, Suggestion, SuggestionPayload } from '@wecom/shared';
import { useFocusTrap } from '../ui/useFocusTrap.js';
import { payloadSummary } from '../sources/SuggestionCard.js';
import { applyRows, diffRows, rowsOf, type SuggestionRow } from '../../lib/suggestionRows.js';

type Verdict = 'keep' | 'edit' | 'remove';
interface RowState {
  op: Verdict;
  value: string;
}

const LABEL: Record<Verdict, string> = { keep: 'שמור', edit: 'ערוך', remove: 'הסר' };

const initialState = (rows: SuggestionRow[], prefill?: SuggestionPayload | null, base?: SuggestionPayload) => {
  const preset = new Map(
    prefill && base ? diffRows(base, prefill).map((r) => [r.rowId, String(r.value ?? '')]) : [],
  );
  const out: Record<string, RowState> = {};
  for (const r of rows)
    out[r.rowId] = preset.has(r.rowId)
      ? { op: 'edit', value: preset.get(r.rowId)! }
      : { op: 'keep', value: r.value };
  return out;
};

/**
 * The field-level suggestion editor (spec §1.8).
 *
 * Every row carries a verdict — keep it as proposed, rewrite it, or drop it — and only the rows
 * that are not `keep` are sent, so the payload the server stores records what an editor actually
 * changed rather than a wholesale rewrite. The original payload is never overwritten: X3 keeps it
 * next to `editedPayload` and the diff, which is what the acceptance analytics measure.
 *
 * Two rules come from the row scheme rather than from this component: a required row has no "הסר"
 * at all, and an atomic group is removed whole — ticking "הסר" on one of its rows moves the lot.
 */
export function StructuredEditDrawer({
  suggestion,
  open,
  onClose,
  onSave,
  prefill,
}: {
  suggestion: Suggestion;
  open: boolean;
  onClose: () => void;
  onSave: (edit: StructuredEdit) => void;
  /** A payload the chat refined: rows whose value differs start as "ערוך" with the new text. */
  prefill?: SuggestionPayload | null;
}) {
  const base = suggestion.editedPayload ?? suggestion.payload;
  const rows = useMemo(() => rowsOf(base), [base]);
  const [state, setState] = useState<Record<string, RowState>>(() => initialState(rows, prefill, base));
  const trap = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    if (open) setState(initialState(rows, prefill, base));
  }, [open, rows, prefill, base]);

  const set = (row: SuggestionRow, op: Verdict) =>
    setState((s) => {
      const next = { ...s, [row.rowId]: { ...s[row.rowId]!, op } };
      // Atomic groups move together — keep-all or remove-all.
      if (row.atomic)
        for (const r of rows)
          if (r.atomic === row.atomic && r.rowId !== row.rowId && (op === 'remove' || s[r.rowId]!.op === 'remove'))
            next[r.rowId] = { ...s[r.rowId]!, op: op === 'remove' ? 'remove' : 'keep' };
      return next;
    });

  const edit: StructuredEdit = {
    type: base.type,
    rows: rows
      .filter((r) => state[r.rowId]?.op !== 'keep')
      .map((r) =>
        state[r.rowId]!.op === 'remove'
          ? { rowId: r.rowId, op: 'remove' as const }
          : { rowId: r.rowId, op: 'edit' as const, value: state[r.rowId]!.value },
      ),
  } as StructuredEdit;

  if (!open) return null;

  return (
    <div
      className="sed-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="עריכת ההצעה"
      dir="rtl"
      ref={trap}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="hd">
        <b>עריכת ההצעה</b>
        <span className="small muted">{suggestion.title}</span>
      </div>

      <div className="rows">
        {rows.map((row) => {
          const st = state[row.rowId]!;
          const options: Verdict[] = row.required ? ['keep', 'edit'] : ['keep', 'edit', 'remove'];
          return (
            <fieldset key={row.rowId} data-row={row.rowId} className={st.op === 'remove' ? 'removed' : ''}>
              <legend>
                {row.label}
                {row.atomic ? <span className="small muted"> · קבוצה אחת</span> : null}
                {row.required ? <span className="small muted"> · חובה</span> : null}
              </legend>
              <div className="orig">{row.value}</div>
              {row.hint ? <div className="small muted">{row.hint}</div> : null}
              <div className="verdicts">
                {options.map((op) => (
                  <label key={op}>
                    <input
                      type="radio"
                      name={`row-${row.rowId}`}
                      checked={st.op === op}
                      onChange={() => set(row, op)}
                    />
                    {LABEL[op]}
                  </label>
                ))}
              </div>
              {st.op === 'edit' ? (
                <textarea
                  rows={2}
                  dir="rtl"
                  aria-label={`ערך חדש · ${row.label}`}
                  value={st.value}
                  onChange={(e) =>
                    setState((s) => ({ ...s, [row.rowId]: { ...s[row.rowId]!, value: e.target.value } }))
                  }
                />
              ) : null}
            </fieldset>
          );
        })}
      </div>

      <div className="small muted sed-result">תוצאה: {payloadSummary(applyRows(base, edit))}</div>
      <div className="foot">
        <button type="button" className="btn sm" onClick={onClose}>
          ביטול
        </button>
        <button type="button" className="btn sm primary" onClick={() => onSave(edit)}>
          שמור עריכה
        </button>
      </div>
    </div>
  );
}
