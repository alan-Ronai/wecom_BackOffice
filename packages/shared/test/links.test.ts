import { describe, it, expect } from 'vitest';
import { detectFieldRefs, detectLinks, stepText } from '../src/format/index.js';
import type { Document } from '../src/schemas/index.js';

const D1 = '11111111-1111-4111-8111-111111111111', D2 = '22222222-2222-4222-8222-222222222222';
const doc = {
  id: D1, slug: 'a', title: 'a', description: '', category: 'tech', wave: 1, priority: 'm', kind: 'steps', status: 'published', currentVersion: 1,
  related: [{ documentId: D2, why: 'x' }], createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
  phases: [{ id: 'p1', label: '', steps: [
    { key: 's1', num: '1', title: 'x', actions: [{ id: 'a', text: 'פתח CRM ↗ שדה "גלישה בארץ" ואז [[doc:' + D2 + ']]' }], outcomes: [], blockRefs: [], deps: [] },
    { key: 's2', num: '2', title: 'y', actions: [{ id: 'b', text: 'עבור למסלול R-02' }], outcomes: [], blockRefs: [], deps: [] },
  ] }],
} as unknown as Document;

describe('links', () => {
  it('detects field refs per step', () => {
    expect(detectFieldRefs(doc, ['גלישה בארץ', 'APN'], new Map())).toEqual([{ stepKey: 's1', fieldName: 'גלישה בארץ' }]);
  });
  it('detects outgoing links by token, code and related', () => {
    const links = detectLinks(doc, [{ id: D2, title: 'b', code: 'R-02' }], new Map());
    expect(links.map((l) => [l.fromStepKey, l.toDocumentId, l.type])).toEqual([['s1', D2, 'link'], ['s2', D2, 'link'], [null, D2, 'related']]);
  });
  it('flattens step text', () => { expect(stepText(doc.phases[0].steps[0])).toContain('גלישה בארץ'); });
});
