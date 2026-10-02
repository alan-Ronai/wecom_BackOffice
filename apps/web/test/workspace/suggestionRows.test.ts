import { describe, it, expect } from 'vitest';
import type { SuggestionPayload } from '@wecom/shared';
import { applyRows, diffRows, rowsOf, structuredValue } from '../../src/lib/suggestionRows.js';

/** What the drawer sends for a row it edited: the typed line folded back into the row's shape. */
const edited = (payload: SuggestionPayload, rowId: string, typed: string) => ({
  rowId,
  op: 'edit' as const,
  value: structuredValue(
    rowsOf(payload).find((r) => r.rowId === rowId)!,
    typed,
  ),
});

const updateStep: SuggestionPayload = {
  type: 'update-step',
  addActions: ['א', 'ב'],
  replaceActions: [
    { id: 'a1', text: 'ישן 1' },
    { id: 'a2', text: 'ישן 2' },
  ],
  branch: { q: 'ש?', options: [{ kind: 'if', label: 'כן', text: 'המשך' }] },
  outcomes: [
    { kind: 'ok', text: 'סיום' },
    { kind: 'next', text: 'המשך' },
  ],
  patch: { hint: 'רמז' },
};

const newCard: SuggestionPayload = {
  type: 'new-card',
  title: 'כרטיס',
  description: 'תיאור',
  category: 'sim',
  wave: 1,
  priority: 'h',
  phases: [
    {
      id: 'p1',
      label: 'שלב א',
      steps: [
        { key: 's1', num: '1', title: 'שלב ראשון', deps: [], blockRefs: [], actions: [], outcomes: [] },
      ],
    },
  ],
};

const newStep: SuggestionPayload = {
  type: 'new-step',
  afterStepKey: 's1',
  title: 'שלב חדש',
  actions: ['פעולה א', 'פעולה ב'],
  outcomes: [{ kind: 'ok', text: 'סיום' }],
};

const updateBlock: SuggestionPayload = {
  type: 'update-block',
  actions: [
    { id: 'b1', text: 'פעולה 1' },
    { id: 'b2', text: 'פעולה 2' },
  ],
  script: 'תסריט',
};

describe('rowsOf follows X3’s pinned row-id scheme', () => {
  it('update-step', () => {
    expect(rowsOf(updateStep).map((r) => r.rowId)).toEqual([
      'add-0',
      'add-1',
      'rep-a1',
      'rep-a2',
      'branch',
      'out-0',
      'out-1',
      'patch-hint',
    ]);
    expect(rowsOf(updateStep).filter((r) => r.atomic === 'replace')).toHaveLength(2);
    expect(rowsOf(updateStep).filter((r) => r.atomic === 'outcomes')).toHaveLength(2);
  });

  it('new-card, new-step, update-block', () => {
    expect(rowsOf(newCard).map((r) => r.rowId)).toEqual(['meta', 'step-0-0']);
    expect(rowsOf(newCard)[0]!.required).toBe(true);
    expect(rowsOf(newStep).map((r) => r.rowId)).toEqual(['meta', 'act-0', 'act-1', 'out-0']);
    expect(rowsOf(updateBlock).map((r) => r.rowId)).toEqual(['act-b1', 'act-b2', 'script']);
    expect(rowsOf(updateBlock).filter((r) => r.atomic === 'actions')).toHaveLength(2);
  });

  it('the single-row types expose one required row each', () => {
    expect(rowsOf({ type: 'deprecate-step', reason: 'ישן' })).toMatchObject([
      { rowId: 'reason', label: 'סיבת ההוצאה משימוש', value: 'ישן', required: true },
    ]);
    expect(rowsOf({ type: 'field-alert', fieldName: 'x', issue: 'unknown' })).toMatchObject([
      { rowId: 'alert', label: 'התראת שדה', value: 'x · unknown', required: true },
    ]);
  });
});

describe('applyRows', () => {
  it('edits and removes only the addressed rows', () => {
    const out = applyRows(
      { type: 'update-step', addActions: ['א', 'ב', 'ג'], patch: {} },
      {
        type: 'update-step',
        rows: [
          { rowId: 'add-1', op: 'edit', value: 'ב2' },
          { rowId: 'add-2', op: 'remove' },
        ],
      },
    );
    expect(out).toMatchObject({ addActions: ['א', 'ב2'] });
  });

  /**
   * X6: the atomic-group rule lives in the **drawer**, which widens a "הסר" across the group
   * before sending, and in `splitByParts`, which refuses a `parts` selection that cuts through
   * one. `applyStructuredEdit` — which is what this preview and the route both run — applies
   * exactly the rows it is given. The two tests below therefore assert the apply, and the
   * widening is asserted where it happens, in `StructuredEditDrawer.test.tsx`.
   */
  it('applies exactly the rows it is given, leaving the rest of the group alone', () => {
    const out = applyRows(updateStep, { type: 'update-step', rows: [{ rowId: 'rep-a1', op: 'remove' }] });
    expect(out).toMatchObject({ replaceActions: [{ id: 'a2' }] });
    expect((out as Extract<SuggestionPayload, { type: 'update-step' }>).outcomes).toHaveLength(2);
  });

  it('omits an optional list the edit emptied rather than writing []', () => {
    // `replaceActions: []` is an instruction to wipe the step's action list, which is never what
    // "the editor dropped every proposed replacement" means (X3's rule, now the only one).
    const out = applyRows(updateStep, {
      type: 'update-step',
      rows: [
        { rowId: 'rep-a1', op: 'remove' },
        { rowId: 'rep-a2', op: 'remove' },
      ],
    });
    expect('replaceActions' in out).toBe(false);
  });

  it('refuses to remove a required row', () => {
    expect(applyRows(newCard, { type: 'new-card', rows: [{ rowId: 'meta', op: 'remove' }] })).toMatchObject({
      title: 'כרטיס',
    });
    expect(
      applyRows(
        { type: 'deprecate-step', reason: 'ישן' },
        {
          type: 'deprecate-step',
          rows: [{ rowId: 'reason', op: 'remove' }],
        },
      ),
    ).toMatchObject({ reason: 'ישן' });
  });

  it('edits the branch question and drops the whole branch on remove', () => {
    expect(
      applyRows(updateStep, { type: 'update-step', rows: [edited(updateStep, 'branch', 'ש2?')] }),
    ).toMatchObject({ branch: { q: 'ש2?' } });
    expect(
      'branch' in applyRows(updateStep, { type: 'update-step', rows: [{ rowId: 'branch', op: 'remove' }] }),
    ).toBe(false);
  });

  it('edits a step title inside a new-card phase and drops a step', () => {
    expect(
      applyRows(newCard, { type: 'new-card', rows: [edited(newCard, 'step-0-0', 'אחר')] }),
    ).toMatchObject({ phases: [{ steps: [{ title: 'אחר' }] }] });
    // A phase left with no steps is dropped, not kept empty.
    expect(
      applyRows(newCard, { type: 'new-card', rows: [{ rowId: 'step-0-0', op: 'remove' }] }),
    ).toMatchObject({ phases: [] });
  });

  it('edits a patch value and drops a patch key', () => {
    expect(
      applyRows(updateStep, {
        type: 'update-step',
        rows: [{ rowId: 'patch-hint', op: 'edit', value: 'ר2' }],
      }),
    ).toMatchObject({ patch: { hint: 'ר2' } });
    expect(
      applyRows(updateStep, { type: 'update-step', rows: [{ rowId: 'patch-hint', op: 'remove' }] }),
    ).toMatchObject({ patch: {} });
  });

  it('ignores a row id that belongs to another type', () => {
    expect(applyRows(newStep, { type: 'new-step', rows: [{ rowId: 'patch-hint', op: 'remove' }] })).toEqual(
      newStep,
    );
  });
});

describe('diffRows', () => {
  it('reports only the rows a refinement actually changed', () => {
    const refined: SuggestionPayload = { ...newStep, title: 'שלב מעודן', actions: ['פעולה א', 'ב2'] };
    expect(diffRows(newStep, refined)).toEqual([
      { rowId: 'meta', op: 'edit', value: 'שלב מעודן' },
      { rowId: 'act-1', op: 'edit', value: 'ב2' },
    ]);
  });
});
