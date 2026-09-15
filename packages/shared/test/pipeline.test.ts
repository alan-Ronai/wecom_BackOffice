import { describe, it, expect } from 'vitest';
import {
  AcceptSuggestionBodySchema,
  AffectsItemSchema,
  ParagraphSchema,
  STRUCTURED_EDIT_ROW_GROUPS,
  StructuredEditDiffSchema,
  StructuredEditSchema,
  SuggestionAnalyticsQuerySchema,
  SuggestionAnalyticsSchema,
  SuggestionSchema,
  type StructuredEdit,
} from '../src/schemas/index.js';

describe('pipeline schemas', () => {
  it('validates an update-step suggestion payload by type', () => {
    const ok = SuggestionSchema.safeParse({
      id: '22222222-2222-4222-8222-222222222222',
      sourceRevisionId: '33333333-3333-4333-8333-333333333333',
      anchor: '§4.8',
      type: 'update-step',
      targetDocumentId: '11111111-1111-4111-8111-111111111111',
      targetStepKey: 's8',
      targetBlockId: null,
      payload: { type: 'update-step', addActions: ['ודא שהלקוח מנותק מ-Wi-Fi'], branch: null, patch: {} },
      confidence: 0.96,
      rationale: 'ערך מספרי שונה',
      status: 'pending',
      title: 'סף Speedtest',
      createdAt: '2025-06-12T00:00:00.000Z',
    });
    expect(ok.success).toBe(true);
    const bad = SuggestionSchema.safeParse({ ...ok.data, payload: { type: 'new-card' } });
    expect(bad.success).toBe(false);
  });
  it('keeps tracked-change runs', () => {
    const p = ParagraphSchema.parse({
      ref: '4.8',
      heading: 'בדיקת מהירות גלישה',
      runs: [
        { t: 'מעל 5 מגה', del: true, author: 'ענבר' },
        { t: 'מעל 6 מגה', add: true },
      ],
    });
    expect(p.runs[0].del).toBe(true);
  });
});

describe('wave 6 additions to a suggestion', () => {
  const base = {
    id: '22222222-2222-4222-8222-222222222222',
    sourceRevisionId: '33333333-3333-4333-8333-333333333333',
    anchor: '§4.8',
    type: 'update-step' as const,
    targetDocumentId: '11111111-1111-4111-8111-111111111111',
    targetStepKey: 's8',
    targetBlockId: null,
    payload: { type: 'update-step' as const, addActions: ['ודא ניתוק מ-Wi-Fi'], patch: {} },
    confidence: 0.9,
    rationale: 'ערך מספרי שונה',
    status: 'pending' as const,
    title: 'סף Speedtest',
    createdAt: '2025-06-12T00:00:00.000Z',
  };
  it('a suggestion written before wave 6 still parses, with affects defaulting to []', () => {
    const s = SuggestionSchema.parse(base);
    expect(s.affects).toEqual([]);
    expect(s.promptVersion).toBeUndefined();
    expect(s.model).toBeUndefined();
    expect(s.editDiff).toBeUndefined();
    expect(s.appliedParts).toBeUndefined();
  });
  it('carries impact, prompt version, model and the edit diff', () => {
    const s = SuggestionSchema.parse({
      ...base,
      affects: [{ kind: 'block', id: 'b1', title: 'בלוק זיהוי לקוח', why: 'משמש 4 מסמכים' }],
      promptVersion: 'v3.2.1',
      model: 'dictalm2.0-instruct:7b-q4_K_M',
      editDiff: { rows: [{ rowId: 'add-0', op: 'edit', before: 'א', after: 'ב' }] },
      appliedParts: ['add-0'],
    });
    expect(s.affects[0]?.kind).toBe('block');
    expect(s.editDiff?.rows).toHaveLength(1);
    expect(AffectsItemSchema.parse({ kind: 'field', id: 'f1', title: 'סטטוס' }).why).toBe('');
    expect(StructuredEditDiffSchema.parse({}).rows).toEqual([]);
    expect(() =>
      SuggestionSchema.parse({ ...base, affects: [{ kind: 'user', id: 'u', title: 't' }] }),
    ).toThrow();
  });
});

describe('structured suggestion editing', () => {
  it('accepts a per-row update-step edit', () => {
    const edit: StructuredEdit = StructuredEditSchema.parse({
      type: 'update-step',
      rows: [{ rowId: 'add-0', op: 'edit', value: 'ודא שהלקוח מנותק מ-Wi-Fi ומחובר בכבל' }],
    });
    expect(edit.type).toBe('update-step');
    expect(edit.rows[0]?.op).toBe('edit');
    expect(StructuredEditSchema.parse({ type: 'deprecate-step' }).rows).toEqual([]);
  });
  it('rejects an unknown op, an edit without a value, and a foreign row group', () => {
    expect(() =>
      StructuredEditSchema.parse({ type: 'update-step', rows: [{ rowId: 'add-0', op: 'merge' }] }),
    ).toThrow();
    expect(() =>
      StructuredEditSchema.parse({ type: 'update-step', rows: [{ rowId: 'add-0', op: 'edit' }] }),
    ).toThrow();
    // `action-0` belongs to update-block, not to deprecate-step.
    expect(() =>
      StructuredEditSchema.parse({ type: 'deprecate-step', rows: [{ rowId: 'action-0', op: 'remove' }] }),
    ).toThrow();
    expect(() => StructuredEditSchema.parse({ type: 'bogus', rows: [] })).toThrow();
  });
  it('names a row group for every suggestion type', () => {
    expect(Object.keys(STRUCTURED_EDIT_ROW_GROUPS).sort()).toEqual([
      'deprecate-step',
      'field-alert',
      'new-card',
      'new-step',
      'update-block',
      'update-step',
    ]);
    expect(STRUCTURED_EDIT_ROW_GROUPS['field-alert']).toEqual(['alert']);
  });
  it('accept with no body applies the whole suggestion', () => {
    expect(AcceptSuggestionBodySchema.parse({}).parts).toBeUndefined();
    expect(AcceptSuggestionBodySchema.parse({ parts: ['add-0', 'patch:title'] }).parts).toHaveLength(2);
  });
  it('validates the analytics query and response', () => {
    expect(SuggestionAnalyticsQuerySchema.parse({ type: 'new-card' }).type).toBe('new-card');
    expect(() => SuggestionAnalyticsQuerySchema.parse({ type: 'nope' })).toThrow();
    const a = SuggestionAnalyticsSchema.parse({
      total: 3,
      byType: [{ key: 'update-step', total: 3, accepted: 2, edited: 1, rejected: 1 }],
      rates: { accepted: 0.67, edited: 0.33, rejected: 0.33 },
    });
    expect(a.bySource).toEqual([]);
    expect(a.meanMinutesToDecision).toBeNull();
    expect(a.byType[0]?.pending).toBe(0);
  });
});
