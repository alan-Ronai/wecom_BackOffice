import { describe, it, expect } from 'vitest';
import {
  AssignmentSchema,
  AttemptResultSchema,
  DocumentLearningSchema,
  MyLearningResponseSchema,
  PlayerItemSchema,
  StartAttemptResponseSchema,
} from '@wecom/shared';
import {
  learningState,
  sampleAssignment,
  sampleBriefingPlayer,
  sampleQuizPlayer,
  sampleResult,
  sampleStart,
} from '../msw/learning-handlers.js';

describe('learning msw fixtures match the wave 5 contract', () => {
  it('assignments and the my-learning envelope parse', () => {
    expect(AssignmentSchema.safeParse(sampleAssignment()).success).toBe(true);
    expect(MyLearningResponseSchema.safeParse(learningState.my).success).toBe(true);
  });
  it('player payloads carry no correct flags', () => {
    const quiz = PlayerItemSchema.parse(sampleQuizPlayer());
    expect(quiz.questions[0].options[0]).not.toHaveProperty('correct');
    expect(PlayerItemSchema.safeParse(sampleBriefingPlayer()).success).toBe(true);
  });
  it('results, attempt starts and document learning parse', () => {
    expect(StartAttemptResponseSchema.safeParse(sampleStart(1)).success).toBe(true);
    expect(AttemptResultSchema.safeParse(sampleResult(true)).success).toBe(true);
    expect(DocumentLearningSchema.safeParse(learningState.docLearning).success).toBe(true);
  });
});
