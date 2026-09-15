import { describe, it, expect } from 'vitest';
import { gradeAttempt } from '../../src/modules/learning/tracking/scoring.js';
import type { StoredQuestion } from '../../src/modules/learning/tracking/itemsPort.js';

const Q: StoredQuestion[] = [
  {
    id: 'q1',
    documentId: 'd',
    stepKey: null,
    stem: 's',
    kind: 'single',
    explanation: 'e1',
    options: [
      { id: 'a', text: 'A', correct: true },
      { id: 'b', text: 'B', correct: false },
    ],
  },
  {
    id: 'q2',
    documentId: 'd',
    stepKey: null,
    stem: 'm',
    kind: 'multi',
    explanation: '',
    options: [
      { id: 'x', text: 'X', correct: true },
      { id: 'y', text: 'Y', correct: true },
      { id: 'z', text: 'Z', correct: false },
    ],
  },
  {
    id: 'q3',
    documentId: 'd',
    stepKey: null,
    stem: 'o',
    kind: 'order',
    explanation: '',
    options: [
      { id: '1', text: 'ראשון', correct: true },
      { id: '2', text: 'שני', correct: true },
    ],
  },
  {
    id: 'q4',
    documentId: 'd',
    stepKey: null,
    stem: 'f',
    kind: 'free',
    explanation: '',
    options: [{ id: 'k', text: 'איפוס', correct: true }],
  },
];

describe('gradeAttempt', () => {
  it('grades all four kinds and applies the pass mark', () => {
    const r = gradeAttempt(
      Q,
      [
        { questionId: 'q1', optionIds: ['a'] },
        { questionId: 'q2', optionIds: ['y', 'x'] },
        { questionId: 'q3', optionIds: ['1', '2'] },
        { questionId: 'q4', text: ' איפוס ' },
      ],
      80,
    );
    expect(r.score).toBe(100);
    expect(r.passed).toBe(true);
    expect(r.perQuestion.map((p) => p.correct)).toEqual([true, true, true, true]);
    expect(r.perQuestion[0].correctOptionIds).toEqual(['a']);
    expect(r.perQuestion[0].explanation).toBe('e1');
  });

  it('partial credit is per question, not per option; wrong order fails; missing answers count wrong', () => {
    const r = gradeAttempt(
      Q,
      [
        { questionId: 'q1', optionIds: ['a'] },
        { questionId: 'q2', optionIds: ['x'] },
        { questionId: 'q3', optionIds: ['2', '1'] },
      ],
      80,
    );
    expect(r.score).toBe(25);
    expect(r.passed).toBe(false);
  });

  it('an empty quiz never passes', () => {
    expect(gradeAttempt([], [], 80)).toEqual({ score: 0, passed: false, perQuestion: [] });
  });
});
