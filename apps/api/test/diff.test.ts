import { describe, it, expect } from 'vitest';
import { diffDocuments, diffStats } from '../src/modules/documents/diff.js';
import type { Document } from '@wecom/shared';

const base = (steps: object[]): Document =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'a',
    title: 'a',
    description: '',
    category: 'tech',
    wave: 1,
    priority: 'm',
    kind: 'steps',
    status: 'published',
    currentVersion: 1,
    phases: [{ id: 'p1', label: '', steps: steps as never }],
    related: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  }) as Document;

const st = (key: string, num: string, title: string, text: string) => ({
  key,
  num,
  title,
  actions: [{ id: 'a', text }],
  outcomes: [],
  blockRefs: [],
  deps: [],
});

describe('diffDocuments', () => {
  it('aligns by key and classifies rows', () => {
    const rows = diffDocuments(
      base([st('s8', '8', 'מהירות', 'מעל 5 מגה'), st('s11', '11', 'ריענון', 'x')]),
      base([st('s8', '8', 'מהירות', 'מעל 6 מגה'), st('s13', '13', 'החלפה', 'y')]),
      new Map(),
    );
    expect(rows.map((r) => r.kind)).toEqual(['changed', 'removed', 'added']);
    expect(rows[0].oldStep!.lines[0]).toContain('<del class="d">5</del>');
    expect(rows[0].newStep!.lines[0]).toContain('<ins class="d">6</ins>');
    expect(diffStats(rows)).toEqual({ changed: 1, added: 1, removed: 1 });
  });

  it('marks identical steps as same', () => {
    const rows = diffDocuments(
      base([st('s1', '1', 'כותרת', 'זהה')]),
      base([st('s1', '1', 'כותרת', 'זהה')]),
      new Map(),
    );
    expect(rows.map((r) => r.kind)).toEqual(['same']);
    expect(diffStats(rows)).toEqual({ changed: 0, added: 0, removed: 0 });
  });
});
