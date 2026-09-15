import { describe, it, expect } from 'vitest';
import type { SuggestionPayload } from '@wecom/shared';
import { applyRows, diffRows, rowsOf } from '../../src/lib/suggestionRows.js';

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
    expect(rowsOf({ type: 'deprecate-step', reason: 'ישן' })).toEqual([
      { rowId: 'reason', label: 'סיבת ההוצאה משימוש', value: 'ישן', required: true },
    ]);
    expect(rowsOf({ type: 'field-alert', fieldName: 'x', issue: 'unknown' })).toEqual([
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

  it('removes an atomic group whole when any of its rows is removed', () => {
    const out = applyRows(updateStep, { type: 'update-step', rows: [{ rowId: 'rep-a1', op: 'remove' }] });
    expect(out).toMatchObject({ replaceActions: [] });
    // The other groups are untouched.
    expect((out as Extract<SuggestionPayload, { type: 'update-step' }>).outcomes).toHaveLength(2);
  });

  it('removes every outcome when one is removed', () => {
    const out = applyRows(updateStep, { type: 'update-step', rows: [{ rowId: 'out-1', op: 'remove' }] });
    expect(out).toMatchObject({ outcomes: [] });
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
      applyRows(updateStep, { type: 'update-step', rows: [{ rowId: 'branch', op: 'edit', value: 'ש2?' }] }),
    ).toMatchObject({ branch: { q: 'ש2?' } });
    expect(
      applyRows(updateStep, { type: 'update-step', rows: [{ rowId: 'branch', op: 'remove' }] }),
    ).toMatchObject({ branch: null });
  });

  it('edits a step title inside a new-card phase and drops a step', () => {
    expect(
      applyRows(newCard, { type: 'new-card', rows: [{ rowId: 'step-0-0', op: 'edit', value: 'אחר' }] }),
    ).toMatchObject({ phases: [{ steps: [{ title: 'אחר' }] }] });
    expect(
      applyRows(newCard, { type: 'new-card', rows: [{ rowId: 'step-0-0', op: 'remove' }] }),
    ).toMatchObject({ phases: [{ steps: [] }] });
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
