import { describe, it, expect } from 'vitest';
import {
  rowsOf,
  applyStructuredEdit,
  diffPayloads,
  splitByParts,
  NotSplittableError,
  StructuredEditSchema,
  type SuggestionPayload,
} from '../src/index.js';

const updateStep: SuggestionPayload = {
  type: 'update-step',
  addActions: ['ודא ניתוק מ-Wi-Fi', 'הרץ Speedtest'],
  replaceActions: [
    { id: 'a1', text: 'בדוק APN' },
    { id: 'a2', text: 'אתחל מכשיר' },
  ],
  branch: { q: 'יש קליטה?', options: [{ kind: 'if', label: 'כן', text: 'המשך', goto: 's2' }] },
  outcomes: [
    { kind: 'ok', text: 'נפתר' },
    { kind: 'next', text: 'המשך', goto: 's9' },
  ],
  patch: { hint: 'טיפ חדש', tone: 'alert' },
};
const newCard: SuggestionPayload = {
  type: 'new-card',
  title: 'כרטיס',
  description: '',
  category: 'tech',
  wave: 1,
  priority: 'h',
  phases: [
    {
      id: 'p1',
      label: '',
      steps: [
        {
          key: 's1',
          num: '1',
          title: 'שלב א',
          actions: [{ id: 'a1', text: 'עשה' }],
          outcomes: [],
          blockRefs: [],
          deps: [],
        },
        {
          key: 's2',
          num: '2',
          title: 'שלב ב',
          actions: [{ id: 'a1', text: 'עוד' }],
          outcomes: [],
          blockRefs: [],
          deps: [],
        },
      ],
    },
  ],
};
const newStep: SuggestionPayload = {
  type: 'new-step',
  afterStepKey: 's3',
  title: 'שלב חדש',
  actions: ['א', 'ב'],
  outcomes: [{ kind: 'ok', text: 'סיום' }],
};
const updateBlock: SuggestionPayload = {
  type: 'update-block',
  actions: [
    { id: 'b1', text: 'ראשון' },
    { id: 'b2', text: 'שני' },
  ],
  script: 'תסריט',
};
const deprecate: SuggestionPayload = { type: 'deprecate-step', reason: 'בוטל' };
const alert: SuggestionPayload = { type: 'field-alert', fieldName: 'sim block lbl', issue: 'unknown' };

describe('rowsOf', () => {
  it('update-step rows follow the id scheme and mark atomic groups', () => {
    const rows = rowsOf(updateStep);
    expect(rows.map((r) => r.rowId)).toEqual([
      'add-0',
      'add-1',
      'rep-a1',
      'rep-a2',
      'branch',
      'out-0',
      'out-1',
      'patch-hint',
      'patch-tone',
    ]);
    expect(rows.find((r) => r.rowId === 'rep-a1')).toMatchObject({
      group: 'replace',
      atomic: true,
      required: false,
    });
    expect(rows.find((r) => r.rowId === 'out-1')).toMatchObject({ group: 'outcomes', atomic: true });
    expect(rows.find((r) => r.rowId === 'add-1')).toMatchObject({
      group: 'add',
      atomic: false,
      editable: 'text',
      value: 'הרץ Speedtest',
    });
  });
  it('new-card has a required meta row and one row per step', () => {
    expect(rowsOf(newCard).map((r) => r.rowId)).toEqual(['meta', 'step-0-0', 'step-0-1']);
    expect(rowsOf(newCard)[0]).toMatchObject({ required: true, editable: 'json' });
  });
  it('new-step, update-block, deprecate-step, field-alert', () => {
    expect(rowsOf(newStep).map((r) => r.rowId)).toEqual(['meta', 'act-0', 'act-1', 'out-0']);
    expect(rowsOf(updateBlock).map((r) => r.rowId)).toEqual(['act-b1', 'act-b2', 'script']);
    expect(rowsOf(updateBlock)[0]).toMatchObject({ group: 'actions', atomic: true });
    expect(rowsOf(deprecate)).toMatchObject([{ rowId: 'reason', required: true }]);
    expect(rowsOf(alert)).toMatchObject([{ rowId: 'alert', required: true }]);
  });
  /**
   * X0's `STRUCTURED_EDIT_ROW_GROUPS` is what the wire schema validates a `rowId` against, so a
   * row id this module mints that the schema rejects would be an edit no client could send.
   */
  it('every minted row id is accepted by StructuredEditSchema', () => {
    for (const p of [updateStep, newCard, newStep, updateBlock, deprecate, alert])
      expect(
        StructuredEditSchema.safeParse({
          type: p.type,
          rows: rowsOf(p).map((r) => ({ rowId: r.rowId, op: 'keep' })),
        }).success,
      ).toBe(true);
  });
});

describe('applyStructuredEdit', () => {
  it('edits and removes rows of an update-step and reports the diff', () => {
    const { payload, diff } = applyStructuredEdit(updateStep, {
      type: 'update-step',
      rows: [
        { rowId: 'add-0', op: 'edit', value: 'ודא ניתוק מ-Wi-Fi לפני הבדיקה' },
        { rowId: 'add-1', op: 'remove' },
        { rowId: 'patch-tone', op: 'remove' },
        { rowId: 'out-0', op: 'edit', value: { kind: 'ok', text: 'נפתר – תעד' } },
      ],
    });
    if (payload.type !== 'update-step') throw new Error('type');
    expect(payload.addActions).toEqual(['ודא ניתוק מ-Wi-Fi לפני הבדיקה']);
    expect(payload.patch).toEqual({ hint: 'טיפ חדש' });
    expect(payload.outcomes?.[0]).toEqual({ kind: 'ok', text: 'נפתר – תעד' });
    expect(payload.replaceActions).toEqual(
      updateStep.type === 'update-step' ? updateStep.replaceActions : [],
    );
    expect(diff.rows.map((r) => [r.rowId, r.op])).toEqual([
      ['add-0', 'edit'],
      ['add-1', 'remove'],
      ['out-0', 'edit'],
      ['patch-tone', 'remove'],
    ]);
    // X0's diff rows carry text, so an object row is stored as its JSON.
    expect(diff.rows[0]).toMatchObject({
      before: 'ודא ניתוק מ-Wi-Fi',
      after: 'ודא ניתוק מ-Wi-Fi לפני הבדיקה',
    });
    expect(diff.rows[2].after).toBe(JSON.stringify({ kind: 'ok', text: 'נפתר – תעד' }));
  });
  it('rejects removing a required row, an unknown row id, and a type mismatch', () => {
    expect(() =>
      applyStructuredEdit(deprecate, { type: 'deprecate-step', rows: [{ rowId: 'reason', op: 'remove' }] }),
    ).toThrow(/required/);
    expect(() =>
      applyStructuredEdit(newStep, { type: 'new-step', rows: [{ rowId: 'act-9', op: 'edit', value: 'x' }] }),
    ).toThrow(/unknown row/);
    expect(() => applyStructuredEdit(newStep, { type: 'update-step', rows: [] } as never)).toThrow(/type/);
  });
  it('new-step keeps at least one action', () => {
    expect(() =>
      applyStructuredEdit(newStep, {
        type: 'new-step',
        rows: [
          { rowId: 'act-0', op: 'remove' },
          { rowId: 'act-1', op: 'remove' },
        ],
      }),
    ).toThrow(/at least one action/);
  });
  it('validates edited values against the payload schema', () => {
    expect(() =>
      applyStructuredEdit(updateStep, {
        type: 'update-step',
        rows: [{ rowId: 'out-0', op: 'edit', value: { kind: 'nope', text: 'x' } }],
      }),
    ).toThrow();
  });
  it('is idempotent: applying an all-keep edit returns an equal payload and an empty diff', () => {
    const { payload, diff } = applyStructuredEdit(newCard, {
      type: 'new-card',
      rows: rowsOf(newCard).map((r) => ({ rowId: r.rowId, op: 'keep' as const })),
    });
    expect(payload).toEqual(newCard);
    expect(diff.rows).toEqual([]);
  });
  /** Removing every proposed replacement must not become "replace the step's actions with none". */
  it('drops an optional list that empties instead of writing []', () => {
    const { payload } = applyStructuredEdit(updateStep, {
      type: 'update-step',
      rows: [
        { rowId: 'rep-a1', op: 'remove' },
        { rowId: 'rep-a2', op: 'remove' },
      ],
    });
    if (payload.type !== 'update-step') throw new Error('type');
    expect(payload.replaceActions).toBeUndefined();
  });
});

describe('diffPayloads (legacy full-payload edit)', () => {
  it('reports row-wise edits between two payloads of the same type', () => {
    const after: SuggestionPayload = {
      ...updateBlock,
      actions: [
        { id: 'b1', text: 'ראשון!' },
        { id: 'b2', text: 'שני' },
      ],
    } as SuggestionPayload;
    expect(diffPayloads(updateBlock, after).rows).toEqual([
      {
        rowId: 'act-b1',
        op: 'edit',
        before: JSON.stringify({ id: 'b1', text: 'ראשון' }),
        after: JSON.stringify({ id: 'b1', text: 'ראשון!' }),
      },
    ]);
  });
  it('reads a removal out of a positional group as one removal, not N edits', () => {
    const after: SuggestionPayload = { type: 'new-step', ...newStep, actions: ['ב'] } as SuggestionPayload;
    expect(diffPayloads(newStep, after).rows).toEqual([{ rowId: 'act-0', op: 'remove', before: 'א' }]);
  });
});

describe('splitByParts', () => {
  it('splits an update-step into applied and remainder, respecting atomic groups', () => {
    const { applied, remainder } = splitByParts(updateStep, ['add-0', 'patch-hint']);
    if (applied.type !== 'update-step' || remainder?.type !== 'update-step') throw new Error('type');
    expect(applied).toEqual({
      type: 'update-step',
      addActions: ['ודא ניתוק מ-Wi-Fi'],
      patch: { hint: 'טיפ חדש' },
    });
    expect(remainder.addActions).toEqual(['הרץ Speedtest']);
    expect(remainder.replaceActions).toHaveLength(2);
    expect(remainder.branch).toBeTruthy();
    expect(remainder.outcomes).toHaveLength(2);
    expect(remainder.patch).toEqual({ tone: 'alert' });
  });
  it('a whole atomic group may be selected; a partial one may not', () => {
    expect(() => splitByParts(updateStep, ['rep-a1'])).toThrow(NotSplittableError);
    const { applied } = splitByParts(updateStep, ['rep-a1', 'rep-a2']);
    if (applied.type !== 'update-step') throw new Error('type');
    expect(applied.replaceActions).toHaveLength(2);
    expect(applied.addActions).toEqual([]);
  });
  it('new-card: meta is always applied; unselected steps become the remainder', () => {
    const { applied, remainder } = splitByParts(newCard, ['step-0-1']);
    if (applied.type !== 'new-card' || remainder?.type !== 'new-card') throw new Error('type');
    expect(applied.phases[0].steps.map((s) => s.key)).toEqual(['s2']);
    expect(remainder.phases[0].steps.map((s) => s.key)).toEqual(['s1']);
  });
  it('selecting every row yields no remainder; whole-or-nothing types refuse subsets', () => {
    expect(splitByParts(deprecate, ['reason']).remainder).toBeNull();
    expect(() => splitByParts(updateBlock, ['act-b1'])).toThrow(NotSplittableError);
    // The block's action list *is* the change, so an actions-less remainder cannot be applied:
    // leaving `script` out of the selection drops that half of the suggestion knowingly.
    expect(splitByParts(updateBlock, ['act-b1', 'act-b2']).remainder).toBeNull();
    expect(() => splitByParts(alert, [])).toThrow(NotSplittableError);
  });
  it('new-step: the applied part keeps meta and at least one action', () => {
    expect(() => splitByParts(newStep, ['out-0'])).toThrow(/לפחות הוראה אחת/);
    expect(() => splitByParts(newStep, ['out-0'])).toThrow(NotSplittableError);
    const { applied, remainder } = splitByParts(newStep, ['act-0']);
    if (applied.type !== 'new-step') throw new Error('type');
    expect(applied.actions).toEqual(['א']);
    expect(remainder).toMatchObject({
      type: 'new-step',
      actions: ['ב'],
      outcomes: [{ kind: 'ok', text: 'סיום' }],
    });
  });
  it('an unknown row id is not splittable', () => {
    expect(() => splitByParts(updateStep, ['nope'])).toThrow(NotSplittableError);
  });
});
