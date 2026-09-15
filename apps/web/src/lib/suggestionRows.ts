import { rowsOf as sharedRowsOf, type StructuredEdit, type SuggestionPayload } from '@wecom/shared';

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
  value: string;
  /** Extra read-only context for the drawer (the branch's options, a step's number). */
  hint?: string;
  /** Rows sharing an atomic group are kept or removed together. */
  atomic?: string;
  /** A required row can be edited but never removed. */
  required?: boolean;
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
    };
  });
}

/**
 * The effective verdict per row: required rows can never be `remove`, and an atomic group in
 * which anything was removed is removed whole.
 */
function verdicts(
  p: SuggestionPayload,
  edit: StructuredEdit,
): Map<string, { op: 'keep' | 'edit' | 'remove'; value?: unknown }> {
  const rows = rowsOf(p);
  const byId = new Map(rows.map((r) => [r.rowId, r]));
  const out = new Map<string, { op: 'keep' | 'edit' | 'remove'; value?: unknown }>();
  const removedGroups = new Set<string>();
  for (const r of edit.rows) {
    const row = byId.get(r.rowId);
    if (!row) continue;
    if (r.op === 'remove' && row.required) continue;
    out.set(r.rowId, { op: r.op, value: r.value });
    if (r.op === 'remove' && row.atomic) removedGroups.add(row.atomic);
  }
  for (const row of rows)
    if (row.atomic && removedGroups.has(row.atomic)) out.set(row.rowId, { op: 'remove' });
  return out;
}

/**
 * A pure preview of an edit — the server applies the real thing; this is what the drawer's
 * "תוצאה" line summarises, so an editor can see the payload they are about to save.
 */
export function applyRows(p: SuggestionPayload, edit: StructuredEdit): SuggestionPayload {
  const ops = verdicts(p, edit);
  /** `null` means "drop this row"; anything else is the (possibly rewritten) value. */
  const decide = <T>(rowId: string, current: T, rewrite: (s: string) => T): T | null => {
    const r = ops.get(rowId);
    if (!r || r.op === 'keep') return current;
    if (r.op === 'remove') return null;
    return typeof r.value === 'string' ? rewrite(r.value) : current;
  };
  const kept = <T>(xs: (T | null)[]): T[] => xs.filter((x): x is T => x !== null);
  const text = (rowId: string, current: string): string => decide(rowId, current, (s) => s) ?? current;

  switch (p.type) {
    case 'update-step':
      return {
        ...p,
        addActions: kept(p.addActions.map((a, i) => decide(`add-${i}`, a, (s) => s))),
        ...(p.replaceActions
          ? {
              replaceActions: kept(
                p.replaceActions.map((a) => decide(`rep-${a.id}`, a, (s) => ({ ...a, text: s }))),
              ),
            }
          : {}),
        ...(p.outcomes
          ? { outcomes: kept(p.outcomes.map((o, i) => decide(`out-${i}`, o, (s) => ({ ...o, text: s })))) }
          : {}),
        ...(p.branch ? { branch: decide('branch', p.branch, (s) => ({ ...p.branch!, q: s })) } : {}),
        patch: Object.fromEntries(
          kept(
            Object.entries(p.patch).map(([k, v]) =>
              decide(`patch-${k}`, [k, v] as [string, unknown], (s) => [k, s] as [string, unknown]),
            ),
          ),
        ),
      };
    case 'new-card':
      return {
        ...p,
        title: text('meta', p.title),
        phases: p.phases.map((ph, pi) => ({
          ...ph,
          steps: kept(ph.steps.map((s, si) => decide(`step-${pi}-${si}`, s, (t) => ({ ...s, title: t })))),
        })),
      };
    case 'new-step':
      return {
        ...p,
        title: text('meta', p.title),
        actions: kept(p.actions.map((a, i) => decide(`act-${i}`, a, (s) => s))),
        outcomes: kept(p.outcomes.map((o, i) => decide(`out-${i}`, o, (s) => ({ ...o, text: s })))),
      };
    case 'update-block': {
      const script = p.script === undefined ? undefined : (decide('script', p.script, (s) => s) ?? undefined);
      return {
        ...p,
        actions: kept(p.actions.map((a) => decide(`act-${a.id}`, a, (s) => ({ ...a, text: s })))),
        ...(script === undefined ? {} : { script }),
      };
    }
    case 'deprecate-step':
      return { ...p, reason: text('reason', p.reason) };
    case 'field-alert':
      // One row, and it is the identity of the suggestion: an edit here would be a different alert.
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
