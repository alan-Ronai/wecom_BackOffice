import { describe, it, expect } from 'vitest';
import { DocumentSchema, StepSchema, paginated, DocumentCardSchema } from '../src/schemas/index.js';

const step = {
  key: 's1', num: '1', title: 'בדיקת חסימת גלישה בארץ',
  actions: [{ id: 'a1', text: 'פתח CRM ↗ שדה "גלישה בארץ"' }],
  outcomes: [{ kind: 'ok', text: '✓ לא חסום – המשך לשלב 2', goto: 's2' }],
};

describe('content schemas', () => {
  it('accepts a minimal document', () => {
    const doc = DocumentSchema.parse({
      id: '11111111-1111-4111-8111-111111111111', slug: 'browsing', title: 'איטיות גלישה', description: '',
      category: 'tech', wave: 1, priority: 'hh', kind: 'steps', status: 'published', currentVersion: 7,
      phases: [{ id: 'p1', label: 'שלב 1 – מסנן', steps: [step] }],
      createdAt: '2025-06-12T00:00:00.000Z', updatedAt: '2025-06-12T00:00:00.000Z',
    });
    expect(doc.phases[0].steps[0].key).toBe('s1');
  });
  it('rejects an unknown category', () => {
    expect(() => StepSchema.parse({ ...step, key: '' })).toThrow();
    expect(DocumentSchema.safeParse({ category: 'x' }).success).toBe(false);
  });
  it('defaults optional step collections', () => {
    const s = StepSchema.parse({ key: 's9', num: '9', title: 'x' });
    expect(s.actions).toEqual([]);
    expect(s.outcomes).toEqual([]);
  });
  it('builds paginated schemas', () => {
    const P = paginated(DocumentCardSchema);
    expect(P.parse({ items: [], total: 0, page: 1, pageSize: 50 }).total).toBe(0);
  });
});
