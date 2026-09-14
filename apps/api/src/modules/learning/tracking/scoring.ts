import type { StoredQuestion } from './itemsPort.js';

export interface AnswerInput {
  questionId: string;
  optionIds?: string[];
  text?: string;
}
export interface GradedQuestion {
  questionId: string;
  correct: boolean;
  correctOptionIds: string[];
  explanation: string;
}
export interface Graded {
  score: number;
  passed: boolean;
  perQuestion: GradedQuestion[];
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('he');
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

const isCorrect = (q: StoredQuestion, a: AnswerInput | undefined): boolean => {
  const correct = q.options.filter((o) => o.correct).map((o) => o.id);
  const chosen = a?.optionIds ?? [];
  switch (q.kind) {
    case 'single':
      return chosen.length === 1 && correct.length === 1 && chosen[0] === correct[0];
    case 'multi':
      return correct.length > 0 && sameSet(chosen, correct);
    case 'order':
      return (
        correct.length > 0 && chosen.length === correct.length && chosen.every((id, i) => id === correct[i])
      );
    case 'free': {
      const t = norm(a?.text ?? '');
      return t.length > 0 && q.options.some((o) => o.correct && norm(o.text) === t);
    }
  }
};

/** Pure grading: one point per question, score in whole percent, pass when score >= passMark. */
export function gradeAttempt(
  questions: StoredQuestion[],
  answers: AnswerInput[],
  passMark: number,
): Graded {
  if (!questions.length) return { score: 0, passed: false, perQuestion: [] };
  const byId = new Map(answers.map((a) => [a.questionId, a]));
  const perQuestion = questions.map((q) => ({
    questionId: q.id,
    correct: isCorrect(q, byId.get(q.id)),
    correctOptionIds: q.options.filter((o) => o.correct).map((o) => o.id),
    explanation: q.explanation,
  }));
  const right = perQuestion.filter((p) => p.correct).length;
  const score = Math.round((100 * right) / questions.length);
  return { score, passed: score >= passMark, perQuestion };
}
