import {
  applyStructuredEdit,
  rowsOf as sharedRowsOf,
  type StructuredEdit,
  type SuggestionPayload,
  type SuggestionRow as SharedRow,
} from '@wecom/shared';

/**
 * The row scheme the structured editor and X3's server-side apply share.
 *
 * X6: the ids, the Hebrew labels, the atomic groups and the required flags now come from X3's
 * shared `rowsOf` in `@wecom/shared` — the same function the route applies an edit with — so the
 * drawer and the server can no longer disagree about what a row is called or whether it may be
 * removed. Getting that right matters because a partial accept
 * (`POST /suggestions/:id/accept { parts }`) is a list of these strings and nothing else.
 *
 * What stays here is only the *display* projection the drawer needs and the shared row does not
 * carry: a single-line editable `value` and a read-only `hint` (a branch's options, a step's
 * phase, a card's description). `applyRows`/`diffRows` stay too — they are the drawer's local
 * preview of what the server will do, and they are asserted against the shared row ids.
 */
export interface SuggestionRow {
  rowId: string;
  label: string;
  /** The one line the drawer shows and edits. */
  value: string;
  /** Extra read-only context for the drawer (the branch's options, a step's number). */
  hint?: string;
  /** Rows sharing an atomic group are kept or removed together. */
  atomic?: string;
  /** A required row can be edited but never removed. */
  required?: boolean;
  /** The shared row's own value, which is what an edit must send back — see `structuredValue`. */
  raw: unknown;
  /** The shared row's editable kind, which says how the typed line folds back into `raw`. */
  editable: SharedRow['editable'];
}

/**
 * The inverse of the display projection: the typed line, folded back into the shape the row
 * really has.
 *
 * `applyStructuredEdit` substitutes a row's value **verbatim** — an `action` row is an
 * `{ id, text }`, a `new-card` `meta` row is the whole `{ title, description, category, wave,
 * priority }` object — so sending the display string back is a 400 on every row that is not plain
 * text. That is most of them, and it was why the structured editor could not save a `new-card` at
 * all. Each kind folds the line into the single field the projection displayed and keeps the rest
 * of the object untouched.
 */
export function structuredValue(row: SuggestionRow, typed: string): unknown {
  const raw = row.raw;
  if (typeof raw === 'string' || raw === null || raw === undefined) return typed;
  if (typeof raw === 'number') {
    const n = Number(typed);
    return Number.isFinite(n) && typed.trim() !== '' ? n : typed;
  }
  if (typeof raw !== 'object') return typed;
  const o = raw as Record<string, unknown>;
  switch (row.editable) {
    case 'action':
    case 'outcome':
      return { ...o, text: typed };
    case 'branch':
      return { ...o, q: typed };
    case 'step':
      return { ...o, title: typed };
    case 'json':
      // `meta` (both kinds) shows the title; the field alert shows `<field> · <issue>`.
      if ('title' in o) return { ...o, title: typed };
      if ('fieldName' in o && 'issue' in o) {
        const [fieldName, ...rest] = typed.split(' · ');
        return rest.length ? { ...o, fieldName, issue: rest.join(' · ') } : { ...o, issue: typed };
      }
      return typed;
    default:
      return typed;
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));

/** The per-type display projection: `rowId` → the line the drawer edits and the note beside it. */
function displayOf(p: SuggestionPayload): Map<string, { value: string; hint?: string }> {
  const rows = ((): { rowId: string; value: string; hint?: string }[] => {
    switch (p.type) {
      case 'update-step':
        return [
          ...p.addActions.map((a, i) => ({ rowId: `add-${i}`, value: a })),
          ...(p.replaceActions ?? []).map((a) => ({
            rowId: `rep-${a.id}`,
            value: a.text,
          })),
          ...(p.branch
            ? [
                {
                  rowId: 'branch',
                  value: p.branch.q,
                  hint: p.branch.options.map((o) => `${o.label}: ${o.text}`).join(' · '),
                },
              ]
            : []),
          ...(p.outcomes ?? []).map((o, i) => ({
            rowId: `out-${i}`,
            value: o.text,
          })),
          ...Object.entries(p.patch).map(([k, v]) => ({
            rowId: `patch-${k}`,
            value: str(v),
          })),
        ];
      case 'new-card':
        return [
          { rowId: 'meta', value: p.title, hint: p.description },
          ...p.phases.flatMap((ph, pi) =>
            ph.steps.map((s, si) => ({
              rowId: `step-${pi}-${si}`,
              value: s.title,
              hint: ph.label,
            })),
          ),
        ];
      case 'new-step':
        return [
          { rowId: 'meta', value: p.title },
          ...p.actions.map((a, i) => ({ rowId: `act-${i}`, value: a })),
          ...p.outcomes.map((o, i) => ({ rowId: `out-${i}`, value: o.text })),
        ];
      case 'update-block':
        return [
          ...p.actions.map((a) => ({
            rowId: `act-${a.id}`,
            value: a.text,
          })),
          ...(p.script === undefined ? [] : [{ rowId: 'script', value: p.script }]),
        ];
      case 'deprecate-step':
        return [{ rowId: 'reason', value: p.reason }];
      case 'field-alert':
        return [{ rowId: 'alert', value: `${p.fieldName} · ${p.issue}` }];
    }
  })();
  return new Map(rows.map((r) => [r.rowId, { value: r.value, ...(r.hint ? { hint: r.hint } : {}) }]));
}

export function rowsOf(p: SuggestionPayload): SuggestionRow[] {
  const display = displayOf(p);
  return sharedRowsOf(p).map((r) => {
    const d = display.get(r.rowId);
    return {
      rowId: r.rowId,
      label: r.label,
      value: d?.value ?? (typeof r.value === 'string' ? r.value : JSON.stringify(r.value)),
      ...(d?.hint ? { hint: d.hint } : {}),
      ...(r.atomic ? { atomic: r.group } : {}),
      ...(r.required ? { required: true } : {}),
      raw: r.value,
      editable: r.editable,
    };
  });
}

/**
 * A pure preview of an edit — what the drawer's "תוצאה" line summarises, so an editor can see the
 * payload they are about to save.
 *
 * X6: this is the shared `applyStructuredEdit`, the function the route itself applies an edit
 * with, rather than a second implementation of the same rules. The local copy rewrote only rows
 * whose value was a string, which quietly stopped previewing anything once the drawer began
 * sending structured values (see `structuredValue`). An edit the server would refuse previews as
 * the unchanged payload rather than throwing at the editor mid-keystroke.
 */
export function applyRows(p: SuggestionPayload, edit: StructuredEdit): SuggestionPayload {
  try {
    return applyStructuredEdit(p, edit).payload;
  } catch {
    return p;
  }
}

/** The edit that turns `from` into `to`, row by row — used to prefill the drawer from a refinement. */
export function diffRows(from: SuggestionPayload, to: SuggestionPayload): StructuredEdit['rows'] {
  if (from.type !== to.type) return [];
  const after = new Map(rowsOf(to).map((r) => [r.rowId, r.value]));
  const rows: StructuredEdit['rows'] = [];
  for (const r of rowsOf(from)) {
    const next = after.get(r.rowId);
    if (next !== undefined && next !== r.value) rows.push({ rowId: r.rowId, op: 'edit', value: next });
  }
  return rows;
}
