import { describe, it, expect } from 'vitest';
import type { Document } from '@wecom/shared';
import { generateFromDocument } from '../../src/modules/learning/fallback.js';

const U = '11111111-1111-4111-8111-111111111111';
const T = '2026-09-15T10:00:00.000Z';
const base = {
  id: U,
  slug: 'r-01',
  title: 'ניתוק גלישה',
  description: '',
  category: 'tech',
  wave: 1,
  priority: 'h',
  kind: 'steps',
  status: 'published',
  currentVersion: 2,
  phases: [],
  related: [],
  createdAt: T,
  updatedAt: T,
} as unknown as Document;

const doc: Document = {
  ...base,
  phases: [
    {
      id: 'p1',
      label: 'סינון',
      steps: [
        {
          key: 's1',
          num: '1',
          title: 'בדיקת חסימה',
          actions: [{ id: 'a1', text: 'CRM ↗ שדה "גלישה בארץ"' }],
          outcomes: [{ kind: 'ok', text: 'לא חסום', goto: 's2' }],
          blockRefs: [],
          deps: [],
        },
        {
          key: 's2',
          num: '2',
          title: 'סוג מכשיר',
          actions: [],
          outcomes: [],
          blockRefs: [],
          deps: [],
          branch: {
            q: 'איזה מכשיר ללקוח?',
            options: [
              { kind: 'if', label: 'אייפון', text: 'עבור לשלב 3', goto: 's3' },
              { kind: 'if', label: 'אנדרואיד', text: 'בדוק APN', goto: 's4' },
            ],
          },
        },
        {
          key: 's3',
          num: '3',
          title: 'איפוס רשת',
          actions: [{ id: 'a1', text: 'הגדרות ↗ איפוס' }],
          outcomes: [{ kind: 'ok', text: 'סיום' }],
          blockRefs: [],
          deps: [],
        },
        {
          key: 's4',
          num: '4',
          title: 'הגדרת APN',
          actions: [{ id: 'a1', text: 'CRM ↗ שדה "APN"' }],
          outcomes: [{ kind: 'ok', text: 'סיום' }],
          blockRefs: [],
          deps: [],
        },
      ],
    },
  ],
} as Document;

describe('rule-based question generation', () => {
  it('turns a branch into one question per option with the branch texts as options', () => {
    const qs = generateFromDocument(doc, 10);
    const branch = qs.filter((q) => q.stepKey === 's2');
    expect(branch).toHaveLength(2);
    expect(branch[0].stem).toBe('בשלב "סוג מכשיר", אם אייפון — מה עושים?');
    expect(branch[0].options.map((o) => o.text)).toEqual(['עבור לשלב 3', 'בדוק APN']);
    expect(branch[0].options.map((o) => o.correct)).toEqual([true, false]);
    expect(branch[1].options.map((o) => o.correct)).toEqual([false, true]);
    expect(branch[0].explanation).toBe('איזה מכשיר ללקוח?');
  });
  it('turns a goto outcome into a next-step question with the goto step correct', () => {
    const q = generateFromDocument(doc, 10).find((x) => x.stepKey === 's1' && x.stem.startsWith('מה השלב הבא'))!;
    expect(q.options[0]).toEqual({ id: 'o1', text: 'סוג מכשיר', correct: true });
    expect(q.options.map((o) => o.text)).toEqual(['סוג מכשיר', 'איפוס רשת', 'הגדרת APN', 'בדיקת חסימה']);
  });
  it('asks which CRM field with other fields as distractors', () => {
    const q = generateFromDocument(doc, 10).find((x) => x.stepKey === 's1' && x.stem.startsWith('באיזה שדה'))!;
    expect(q.options.find((o) => o.correct)?.text).toBe('גלישה בארץ');
    expect(q.options.map((o) => o.text)).toContain('APN');
  });
  it('adds one ordering question for documents with three or more steps', () => {
    const q = generateFromDocument(doc, 10).find((x) => x.kind === 'order')!;
    expect(q.stepKey).toBeNull();
    expect(q.options.map((o) => o.text)).toEqual(['בדיקת חסימה', 'סוג מכשיר', 'איפוס רשת', 'הגדרת APN']);
    expect(q.options.every((o) => o.correct)).toBe(true);
  });
  it('caps per document in priority order and marks everything generated', () => {
    const qs = generateFromDocument(doc, 2);
    expect(qs).toHaveLength(2);
    expect(qs.every((q) => q.generated && q.modelConf === null && q.documentId === U)).toBe(true);
    expect(qs[0].stepKey).toBe('s2'); // branch first
  });
  it('returns nothing for a text document', () => {
    expect(generateFromDocument({ ...base, kind: 'text', phases: [] } as Document, 3)).toEqual([]);
  });
});
