/**
 * Structured (field-level) suggestion editing — spec §1.8.
 *
 * Every `SuggestionPayload` becomes an ordered list of addressable rows (`rowsOf`). The row ids
 * are the contract between the editor UI (X4a renders one control per row) and the API (X3
 * applies exactly those ids), so they are defined here once and nowhere else:
 *
 * | type            | rows                                                                             |
 * |-----------------|----------------------------------------------------------------------------------|
 * | `update-step`   | `add-<i>`, `rep-<action.id>` (atomic `replace`), `branch`, `out-<i>` (atomic       |
 * |                 | `outcomes`), `patch-<key>`                                                         |
 * | `new-card`      | `meta` (required), `step-<phase>-<step>`                                           |
 * | `new-step`      | `meta` (required), `act-<i>`, `out-<i>` (at least one action must remain)          |
 * | `update-block`  | `act-<action.id>` (atomic `actions`), `script`                                     |
 * | `deprecate-step`| `reason` (required, whole-or-nothing)                                              |
 * | `field-alert`   | `alert` (required, whole-or-nothing)                                               |
 *
 * Ids are stable across edits because every edit is applied to the **original** payload, never
 * to the previously edited one — so `add-1` means the same proposed line on the second pass as
 * on the first, and a stored `edit_diff` always reads "original → current".
 */
import {
  SuggestionPayloadSchema,
  type StructuredEdit,
  type StructuredEditDiff,
  type StructuredEditRow,
  type SuggestionPayload,
  type SuggestionType,
} from '../schemas/pipeline.js';
import type { Phase } from '../schemas/content.js';

export interface SuggestionRow {
  /** Stable address of this row inside its payload; see the table above. */
  rowId: string;
  group: string;
  /** The whole group is applied or none of it (a subset would corrupt the change). */
  atomic: boolean;
  /** Cannot be removed by an edit, and is always included in a partial apply. */
  required: boolean;
  /** Hebrew label the structured editor shows. */
  label: string;
  value: unknown;
  editable: 'text' | 'action' | 'outcome' | 'branch' | 'step' | 'json' | 'none';
}

/** A `parts` selection that cuts through an atomic group, or leaves an unappliable payload. */
export class NotSplittableError extends Error {
  constructor(
    public readonly group: string,
    message: string,
  ) {
    super(message);
    this.name = 'NotSplittableError';
  }
}

const L = {
  add: 'הוראה חדשה',
  replace: 'הוראה (החלפה מלאה)',
  branch: 'הסתעפות',
  outcomes: 'תוצאה',
  patch: 'שדה',
  meta: 'פרטי הכרטיס',
  stepMeta: 'פרטי השלב',
  step: 'שלב',
  action: 'הוראה',
  actions: 'הוראת בלוק',
  script: 'תסריט',
  reason: 'סיבת ההוצאה משימוש',
  alert: 'התראת שדה',
};

/**
 * Row ids whose number is a position in a list rather than a stable key. A removal shifts the
 * ones after it, so `diffPayloads` matches those groups by value instead of by id.
 */
const POSITIONAL: Record<SuggestionType, RegExp | null> = {
  'update-step': /^(add|out)-\d+$/,
  'new-card': /^step-\d+-\d+$/,
  'new-step': /^(act|out)-\d+$/,
  'update-block': null,
  'deprecate-step': null,
  'field-alert': null,
};

/** Every payload becomes an ordered list of addressable rows. Ids are stable across edits. */
export function rowsOf(p: SuggestionPayload): SuggestionRow[] {
  const rows: SuggestionRow[] = [];
  const push = (r: SuggestionRow) => rows.push(r);
  switch (p.type) {
    case 'update-step':
      p.addActions.forEach((t, i) =>
        push({
          rowId: `add-${i}`,
          group: 'add',
          atomic: false,
          required: false,
          label: L.add,
          value: t,
          editable: 'text',
        }),
      );
      (p.replaceActions ?? []).forEach((a) =>
        push({
          rowId: `rep-${a.id}`,
          group: 'replace',
          atomic: true,
          required: false,
          label: L.replace,
          value: a,
          editable: 'action',
        }),
      );
      if (p.branch !== undefined)
        push({
          rowId: 'branch',
          group: 'branch',
          atomic: false,
          required: false,
          label: L.branch,
          value: p.branch,
          editable: 'branch',
        });
      (p.outcomes ?? []).forEach((o, i) =>
        push({
          rowId: `out-${i}`,
          group: 'outcomes',
          atomic: true,
          required: false,
          label: L.outcomes,
          value: o,
          editable: 'outcome',
        }),
      );
      Object.entries(p.patch).forEach(([k, v]) =>
        push({
          rowId: `patch-${k}`,
          group: 'patch',
          atomic: false,
          required: false,
          label: `${L.patch} ${k}`,
          value: v,
          editable: 'json',
        }),
      );
      return rows;
    case 'new-card':
      push({
        rowId: 'meta',
        group: 'meta',
        atomic: false,
        required: true,
        label: L.meta,
        value: {
          title: p.title,
          description: p.description,
          category: p.category,
          wave: p.wave,
          priority: p.priority,
        },
        editable: 'json',
      });
      p.phases.forEach((ph, pi) =>
        ph.steps.forEach((s, si) =>
          push({
            rowId: `step-${pi}-${si}`,
            group: 'steps',
            atomic: false,
            required: false,
            label: `${L.step} ${s.num || si + 1}`,
            value: s,
            editable: 'step',
          }),
        ),
      );
      return rows;
    case 'new-step':
      push({
        rowId: 'meta',
        group: 'meta',
        atomic: false,
        required: true,
        label: L.stepMeta,
        value: { afterStepKey: p.afterStepKey, title: p.title },
        editable: 'json',
      });
      p.actions.forEach((t, i) =>
        push({
          rowId: `act-${i}`,
          group: 'actions',
          atomic: false,
          required: false,
          label: L.action,
          value: t,
          editable: 'text',
        }),
      );
      p.outcomes.forEach((o, i) =>
        push({
          rowId: `out-${i}`,
          group: 'outcomes',
          atomic: false,
          required: false,
          label: L.outcomes,
          value: o,
          editable: 'outcome',
        }),
      );
      return rows;
    case 'update-block':
      p.actions.forEach((a) =>
        push({
          rowId: `act-${a.id}`,
          group: 'actions',
          atomic: true,
          required: false,
          label: L.actions,
          value: a,
          editable: 'action',
        }),
      );
      if (p.script !== undefined)
        push({
          rowId: 'script',
          group: 'script',
          atomic: false,
          required: false,
          label: L.script,
          value: p.script,
          editable: 'text',
        });
      return rows;
    case 'deprecate-step':
      return [
        {
          rowId: 'reason',
          group: 'reason',
          atomic: false,
          required: true,
          label: L.reason,
          value: p.reason,
          editable: 'text',
        },
      ];
    case 'field-alert':
      return [
        {
          rowId: 'alert',
          group: 'alert',
          atomic: false,
          required: true,
          label: L.alert,
          value: { fieldName: p.fieldName, issue: p.issue },
          editable: 'json',
        },
      ];
  }
  return rows;
}

type Decision = { op: 'keep' | 'edit' | 'remove'; value?: unknown };

/**
 * Rebuilds a payload from one decision per row (`keep` for rows the caller says nothing about).
 *
 * An optional list that ends up empty is **omitted**, not written as `[]`: `replaceActions: []`
 * and `outcomes: []` are instructions to wipe the step's action / outcome list, which is never
 * what "the editor removed the proposed replacements" means.
 */
function rebuild(p: SuggestionPayload, decide: (row: SuggestionRow) => Decision): SuggestionPayload {
  const rows = rowsOf(p);
  const d = new Map(rows.map((r) => [r.rowId, decide(r)] as const));
  const keep = (id: string) => d.get(id)?.op !== 'remove';
  const val = <T>(id: string, orig: T): T => {
    const x = d.get(id);
    return x?.op === 'edit' ? (x.value as T) : orig;
  };
  for (const r of rows)
    if (r.required && d.get(r.rowId)?.op === 'remove')
      throw new Error(`required row cannot be removed: ${r.rowId}`);
  let out: SuggestionPayload;
  switch (p.type) {
    case 'update-step': {
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(p.patch)) if (keep(`patch-${k}`)) patch[k] = val(`patch-${k}`, v);
      const replaceActions = (p.replaceActions ?? [])
        .filter((a) => keep(`rep-${a.id}`))
        .map((a) => val(`rep-${a.id}`, a));
      const outcomes = (p.outcomes ?? [])
        .map((o, i) => [`out-${i}`, o] as const)
        .filter(([id]) => keep(id))
        .map(([id, o]) => val(id, o));
      out = {
        type: 'update-step',
        addActions: p.addActions
          .map((t, i) => [`add-${i}`, t] as const)
          .filter(([id]) => keep(id))
          .map(([id, t]) => val(id, t)),
        ...(replaceActions.length ? { replaceActions } : {}),
        ...(p.branch !== undefined && keep('branch') ? { branch: val('branch', p.branch) } : {}),
        ...(outcomes.length ? { outcomes } : {}),
        patch,
      };
      break;
    }
    case 'new-card': {
      const meta = val('meta', {
        title: p.title,
        description: p.description,
        category: p.category,
        wave: p.wave,
        priority: p.priority,
      }) as Record<string, unknown>;
      const phases: Phase[] = p.phases
        .map((ph, pi) => ({
          ...ph,
          steps: ph.steps
            .map((s, si) => [`step-${pi}-${si}`, s] as const)
            .filter(([id]) => keep(id))
            .map(([id, s]) => val(id, s)),
        }))
        .filter((ph) => ph.steps.length > 0);
      // A-M2: `type` re-asserted *after* the spread. `meta` is client-controlled, so spreading
      // it over the discriminant would let an edit rename the payload's type.
      out = { ...meta, phases, type: 'new-card' } as SuggestionPayload;
      break;
    }
    case 'new-step': {
      const meta = val('meta', { afterStepKey: p.afterStepKey, title: p.title }) as Record<string, unknown>;
      const actions = p.actions
        .map((t, i) => [`act-${i}`, t] as const)
        .filter(([id]) => keep(id))
        .map(([id, t]) => val(id, t));
      if (actions.length === 0) throw new Error('new-step must keep at least one action');
      out = {
        ...meta,
        type: 'new-step', // A-M2: after the spread, never before it.
        actions,
        outcomes: p.outcomes
          .map((o, i) => [`out-${i}`, o] as const)
          .filter(([id]) => keep(id))
          .map(([id, o]) => val(id, o)),
      } as SuggestionPayload;
      break;
    }
    case 'update-block':
      out = {
        type: 'update-block',
        actions: p.actions.filter((a) => keep(`act-${a.id}`)).map((a) => val(`act-${a.id}`, a)),
        ...(p.script !== undefined && keep('script') ? { script: val('script', p.script) } : {}),
      };
      break;
    case 'deprecate-step':
      out = { type: 'deprecate-step', reason: val('reason', p.reason) };
      break;
    case 'field-alert':
      out = {
        ...(val('alert', { fieldName: p.fieldName, issue: p.issue }) as Record<string, unknown>),
        type: 'field-alert', // A-M2: after the spread, never before it.
      } as SuggestionPayload;
      break;
  }
  // An edited value is client input like any other: it has to satisfy the payload schema.
  return SuggestionPayloadSchema.parse(out);
}

/**
 * Applies a per-row verdict to the **original** payload and reports what changed.
 * Throws on a type mismatch, an unknown row id, removing a required row, a `new-step` left with
 * no actions, or an edited value the payload schema rejects.
 */
export function applyStructuredEdit(
  p: SuggestionPayload,
  edit: StructuredEdit,
): { payload: SuggestionPayload; diff: StructuredEditDiff } {
  if (edit.type !== p.type) throw new Error(`type mismatch: payload ${p.type}, edit ${edit.type}`);
  const known = new Set(rowsOf(p).map((r) => r.rowId));
  for (const r of edit.rows as StructuredEditRow[])
    if (!known.has(r.rowId)) throw new Error(`unknown row: ${r.rowId}`);
  const ops = new Map((edit.rows as StructuredEditRow[]).map((r) => [r.rowId, r] as const));
  const payload = rebuild(p, (row) => ops.get(row.rowId) ?? { op: 'keep' });
  return { payload, diff: diffPayloads(p, payload) };
}

/**
 * Key-order-independent JSON. A payload that has been through `SuggestionPayloadSchema.parse`
 * comes back with the schema's key order, not the caller's, so comparing raw `JSON.stringify`
 * output reported every row of an untouched payload as an edit.
 */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

/** `StructuredEditDiff` stores row values as text (X0's schema); objects go in as JSON. */
const text = (v: unknown): string | undefined =>
  v === undefined ? undefined : typeof v === 'string' ? v : stable(v);

/**
 * Row-wise diff of two payloads of the same type — the legacy full-payload edit path and the
 * derivation behind every stored `edit_diff`. Kept rows are omitted; only `edit` and `remove`
 * appear (a structured edit can never add a row, and a full-payload edit that does is reported
 * as an edit at the new row's id).
 */
export function diffPayloads(before: SuggestionPayload, after: SuggestionPayload): StructuredEditDiff {
  if (before.type !== after.type) throw new Error(`type mismatch: ${before.type} vs ${after.type}`);
  const b = rowsOf(before);
  const a = rowsOf(after);
  const rows: StructuredEditDiff['rows'] = [];
  const same = (x: unknown, y: unknown) => stable(x ?? null) === stable(y ?? null);
  const re = POSITIONAL[before.type];
  const isPos = (id: string) => (re ? re.test(id) : false);

  const aById = new Map(a.filter((r) => !isPos(r.rowId)).map((r) => [r.rowId, r] as const));
  for (const r of b) {
    if (isPos(r.rowId)) continue;
    const hit = aById.get(r.rowId);
    if (!hit) rows.push({ rowId: r.rowId, op: 'remove', before: text(r.value) });
    else if (!same(r.value, hit.value))
      rows.push({ rowId: r.rowId, op: 'edit', before: text(r.value), after: text(hit.value) });
  }

  // Positional groups shift when a row is removed, so pair value-equal rows first and read the
  // leftovers in order: N removals then look like N removals, not like N edits plus a removal.
  const groups = new Set([...b, ...a].filter((r) => isPos(r.rowId)).map((r) => r.group));
  for (const g of groups) {
    const bg = b.filter((r) => r.group === g && isPos(r.rowId));
    const ag = a.filter((r) => r.group === g && isPos(r.rowId));
    const taken = new Set<number>();
    const leftB: SuggestionRow[] = [];
    for (const r of bg) {
      const i = ag.findIndex((x, j) => !taken.has(j) && same(r.value, x.value));
      if (i >= 0) taken.add(i);
      else leftB.push(r);
    }
    const leftA = ag.filter((_, j) => !taken.has(j));
    leftB.forEach((r, i) =>
      rows.push(
        i < leftA.length
          ? { rowId: r.rowId, op: 'edit', before: text(r.value), after: text(leftA[i].value) }
          : { rowId: r.rowId, op: 'remove', before: text(r.value) },
      ),
    );
    for (let i = leftB.length; i < leftA.length; i++)
      rows.push({ rowId: leftA[i].rowId, op: 'edit', after: text(leftA[i].value) });
  }
  rows.sort((x, y) => x.rowId.localeCompare(y.rowId));
  return { rows };
}

/**
 * Partial apply: `parts` are the row ids to apply now.
 *
 * Atomic groups are all-or-nothing, required rows are always applied, and whole-or-nothing types
 * (`deprecate-step`, `field-alert`) demand every row. What is left over comes back as the
 * `remainder` payload — re-queued by the API as a pending suggestion linked to its parent — or
 * as `null` when nothing appliable is left (only required rows, or an `update-block` with no
 * actions, whose action list is the whole change).
 */
export function splitByParts(
  p: SuggestionPayload,
  parts: string[],
): { applied: SuggestionPayload; remainder: SuggestionPayload | null } {
  const rows = rowsOf(p);
  const sel = new Set(parts);
  const known = new Set(rows.map((r) => r.rowId));
  for (const id of sel) if (!known.has(id)) throw new NotSplittableError('unknown', `שורה לא מוכרת: ${id}`);
  if (p.type === 'deprecate-step' || p.type === 'field-alert') {
    if (!rows.every((r) => sel.has(r.rowId)))
      throw new NotSplittableError(p.type, 'הצעה מסוג זה מיושמת בשלמותה בלבד');
    return { applied: p, remainder: null };
  }
  for (const r of rows) if (r.required) sel.add(r.rowId);
  const groups = new Map<string, SuggestionRow[]>();
  for (const r of rows) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  for (const [g, rs] of groups) {
    if (!rs[0].atomic) continue;
    const n = rs.filter((r) => sel.has(r.rowId)).length;
    if (n !== 0 && n !== rs.length)
      throw new NotSplittableError(g, `הקבוצה "${rs[0].label}" מיושמת בשלמותה או לא בכלל`);
  }
  if (p.type === 'update-block' && !(groups.get('actions') ?? []).every((r) => sel.has(r.rowId)))
    throw new NotSplittableError('actions', 'עדכון בלוק מחליף את כל ההוראות – יש לבחור את כולן');

  let applied: SuggestionPayload;
  try {
    applied = rebuild(p, (r) => ({ op: sel.has(r.rowId) ? 'keep' : 'remove' }));
  } catch (e) {
    const m = (e as Error).message;
    throw new NotSplittableError(
      'actions',
      /at least one action/.test(m)
        ? 'שלב חדש חייב לכלול לפחות הוראה אחת – יש לבחור הוראה'
        : 'הבחירה אינה מרכיבה הצעה תקינה',
    );
  }
  if (rows.every((r) => sel.has(r.rowId))) return { applied, remainder: null };

  let remainder: SuggestionPayload | null;
  try {
    remainder = rebuild(p, (r) => ({ op: sel.has(r.rowId) && !r.required ? 'remove' : 'keep' }));
  } catch {
    remainder = null; // e.g. a new-step whose every action was applied: nothing appliable is left
  }
  if (remainder && rowsOf(remainder).every((r) => r.required)) remainder = null; // only meta left
  if (remainder?.type === 'update-block' && remainder.actions.length === 0) remainder = null;
  return { applied, remainder };
}
