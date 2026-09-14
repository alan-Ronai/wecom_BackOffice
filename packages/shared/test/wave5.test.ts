import { describe, it, expect } from 'vitest';
import {
  LearningItemSchema,
  LearningVersionSchema,
  WorkflowSettingsSchema,
  SourceVersionSchema,
  WORKFLOW_SETTINGS_KEY,
  type LearningItemCreate,
  type Gap,
} from '../src/index.js';

const U = '11111111-1111-4111-8111-111111111111';
const T = '2026-09-15T10:00:00.000Z';

describe('wave5 schemas (approved spec)', () => {
  it('pins referenced document versions on items and versions', () => {
    expect(SourceVersionSchema.parse({ documentId: U, version: 3 })).toEqual({
      documentId: U,
      version: 3,
    });
    const item = LearningItemSchema.parse({
      id: U,
      kind: 'quiz',
      title: 'q',
      description: '',
      worldSlug: null,
      status: 'draft',
      currentVersion: 0,
      passMark: 80,
      maxAttempts: null,
      estimatedMinutes: null,
      entries: [],
      questions: [],
      createdBy: null,
      updatedAt: T,
      publishedAt: null,
    });
    expect(item.sourceVersions).toEqual([]);
    const v = LearningVersionSchema.parse({
      version: 1,
      label: 'v1',
      authorName: 'x',
      createdAt: T,
      sourceVersions: [{ documentId: U, version: 2 }],
    });
    expect(v.sourceVersions[0].version).toBe(2);
  });
  it('defaults quizzes to unlimited attempts and pass mark 80', () => {
    const s = WorkflowSettingsSchema.parse({ learning: {}, gaps: {} });
    expect(s.learning.defaultMaxAttempts).toBeNull();
    expect(s.learning.defaultPassMark).toBe(80);
    expect(s.requireApprover).toBe(false);
    expect(WORKFLOW_SETTINGS_KEY).toBe('workflow');
  });
  it('exports type aliases (compile-time check)', () => {
    const c: LearningItemCreate = { kind: 'briefing', title: 'b' } as LearningItemCreate;
    const g = { id: U } as unknown as Gap;
    expect(c.kind).toBe('briefing');
    expect(g.id).toBe(U);
  });
});
