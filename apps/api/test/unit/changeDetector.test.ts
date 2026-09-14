import { describe, it, expect } from 'vitest';
import type { Block, Document, Step } from '@wecom/shared';
import { detectSignificantChange } from '../../src/modules/learning/tracking/changeDetector.js';

const T = '2026-09-15T00:00:00.000Z';
const step = (key: string, over: Partial<Step> = {}): Step => ({
  key,
  num: key,
  title: 'שלב ' + key,
  blockRefs: [],
  deps: [],
  actions: [{ id: key + 'a', text: 'פעולה' }],
  outcomes: [{ kind: 'next', text: 'המשך' }],
  ...over,
});
const doc = (steps: Step[]): Document => ({
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'd',
  title: 'מסמך',
  description: '',
  category: 'tech',
  wave: 1,
  priority: 'm',
  kind: 'steps',
  status: 'published',
  currentVersion: 1,
  phases: [{ id: 'p1', label: '', steps }],
  related: [],
  createdAt: T,
  updatedAt: T,
  tags: [],
  worlds: ['tech'],
  topics: [],
  sourceReviewNeeded: false,
});
const blocks = new Map<string, Block>();

describe('detectSignificantChange', () => {
  it('a title-only change is not significant', () => {
    const a = doc([step('s1'), step('s2'), step('s3')]);
    const b = doc([step('s1', { title: 'כותרת אחרת' }), step('s2'), step('s3')]);
    expect(detectSignificantChange(a, b, blocks, [])).toEqual({ significant: false, reasons: [] });
  });

  it('a removed step is significant', () => {
    const a = doc([step('s1'), step('s2')]);
    const r = detectSignificantChange(a, doc([step('s1')]), blocks, []);
    expect(r.significant).toBe(true);
    expect(r.reasons[0]).toMatch(/שלב הוסר/);
  });

  it('a changed outcome or branch option is significant', () => {
    const a = doc([step('s1'), step('s2')]);
    const b = doc([step('s1', { outcomes: [{ kind: 'alert', text: 'עצור' }] }), step('s2')]);
    expect(detectSignificantChange(a, b, blocks, []).reasons).toContainEqual(
      expect.stringMatching(/תוצאה/),
    );
    const c = doc([
      step('s1', { branch: { q: 'יש קליטה?', options: [{ kind: 'if', label: 'כן', text: 'המשך' }] } }),
      step('s2'),
    ]);
    const d = doc([
      step('s1', { branch: { q: 'יש קליטה?', options: [{ kind: 'if', label: 'לא', text: 'המשך' }] } }),
      step('s2'),
    ]);
    expect(detectSignificantChange(c, d, blocks, []).reasons).toContainEqual(
      expect.stringMatching(/הסתעפות/),
    );
  });

  it('a CRM field reference change is significant', () => {
    const a = doc([step('s1', { actions: [{ id: 'x', text: 'בדוק {{IMSI}}' }] })]);
    const b = doc([step('s1', { actions: [{ id: 'x', text: 'בדוק {{PUK}}' }] })]);
    const r = detectSignificantChange(a, b, blocks, ['IMSI', 'PUK']);
    expect(r.significant).toBe(true);
    expect(r.reasons.join(' ')).toMatch(/שדה CRM/);
  });

  it('more than 40% of steps changed in text is significant even without structural change', () => {
    const a = doc([step('s1'), step('s2'), step('s3'), step('s4'), step('s5')]);
    const b = doc([
      step('s1', { actions: [{ id: '1', text: 'אחר' }] }),
      step('s2', { actions: [{ id: '2', text: 'אחר' }] }),
      step('s3', { actions: [{ id: '3', text: 'אחר' }] }),
      step('s4'),
      step('s5'),
    ]);
    expect(detectSignificantChange(a, b, blocks, []).reasons).toContain('יותר מ-40% מהשלבים השתנו');
  });
});
