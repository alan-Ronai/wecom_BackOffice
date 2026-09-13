import { describe, it, expect } from 'vitest';
import { SuggestionSchema, ParagraphSchema } from '../src/schemas/index.js';

describe('pipeline schemas', () => {
  it('validates an update-step suggestion payload by type', () => {
    const ok = SuggestionSchema.safeParse({
      id: '22222222-2222-4222-8222-222222222222', sourceRevisionId: '33333333-3333-4333-8333-333333333333', anchor: '§4.8',
      type: 'update-step', targetDocumentId: '11111111-1111-4111-8111-111111111111', targetStepKey: 's8', targetBlockId: null,
      payload: { type: 'update-step', addActions: ['ודא שהלקוח מנותק מ-Wi-Fi'], branch: null, patch: {} },
      confidence: 0.96, rationale: 'ערך מספרי שונה', status: 'pending', title: 'סף Speedtest', createdAt: '2025-06-12T00:00:00.000Z',
    });
    expect(ok.success).toBe(true);
    const bad = SuggestionSchema.safeParse({ ...ok.data, payload: { type: 'new-card' } });
    expect(bad.success).toBe(false);
  });
  it('keeps tracked-change runs', () => {
    const p = ParagraphSchema.parse({ ref: '4.8', heading: 'בדיקת מהירות גלישה', runs: [{ t: 'מעל 5 מגה', del: true, author: 'ענבר' }, { t: 'מעל 6 מגה', add: true }] });
    expect(p.runs[0].del).toBe(true);
  });
});
