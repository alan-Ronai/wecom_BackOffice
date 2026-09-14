import { describe, it, expect } from 'vitest';
import {
  LearningItemSchema,
  LearningVersionSchema,
  WorkflowSettingsSchema,
  SourceVersionSchema,
  PlayerQuestionSchema,
  StartAttemptResponseSchema,
  DocumentLearningSchema,
  WORKFLOW_SETTINGS_KEY,
  PublishBodySchema,
  PublishResponseSchema,
  AssignResultSchema,
  LearningDashboardQuerySchema,
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
  it('gives the web player the ids it keys on', () => {
    // The agent-web lanes key the answer map by question id and link the article banner
    // straight at the open refresh assignment, so neither may be absent from the contract.
    expect(
      PlayerQuestionSchema.safeParse({
        documentId: U,
        stem: 's',
        kind: 'single',
        options: [{ id: 'a', text: 'a' }],
      }).success,
    ).toBe(false); // id missing
    const q = PlayerQuestionSchema.parse({
      id: U,
      documentId: U,
      stem: 's',
      kind: 'single',
      options: [{ id: 'a', text: 'a' }],
    });
    expect(q.id).toBe(U);
    expect(StartAttemptResponseSchema.parse({ attemptId: U, attemptNo: 2 }).attemptNo).toBe(2);
    expect(
      DocumentLearningSchema.parse({
        items: [],
        refreshRequired: false,
        refreshAssignmentId: null,
        lastSignificantChange: null,
      }).refreshAssignmentId,
    ).toBeNull();
  });
  it('publish carries significantChange and returns changeFlag', () => {
    expect(PublishBodySchema.parse({ label: 'v', significantChange: true }).significantChange).toBe(true);
    expect(PublishResponseSchema.shape.changeFlag.isOptional()).toBe(true);
  });
  it('exports type aliases (compile-time check)', () => {
    const c: LearningItemCreate = { kind: 'briefing', title: 'b' } as LearningItemCreate;
    const g = { id: U } as unknown as Gap;
    expect(c.kind).toBe('briefing');
    expect(g.id).toBe(U);
  });
});

describe('wave5 V2 additive schemas', () => {
  it('assign result and dashboard query', () => {
    expect(AssignResultSchema.parse({ assigned: 2, skipped: 1 })).toEqual({ assigned: 2, skipped: 1 });
    expect(LearningDashboardQuerySchema.parse({}).world).toBeUndefined();
    expect(LearningDashboardQuerySchema.parse({ world: 'tech' }).world).toBe('tech');
  });
});
