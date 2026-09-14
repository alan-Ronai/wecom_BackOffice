/**
 * msw handlers for the wave 5 agent routes (`docs/api/CONTRACTS-wave5.md`, V2 rows the agent
 * calls). Mutable state so tests can assert what the UI sent; reset via `resetLearningState()`.
 */
import { http, HttpResponse, type RequestHandler } from 'msw';
import type {
  Assignment,
  AttemptResult,
  DocumentLearning,
  MyLearningResponse,
  PlayerItem,
  StartAttemptResponse,
} from '@wecom/shared';
import { fx } from './fixtures.js';

const B = '/api/v1';
const T = '2026-09-15T08:00:00.000Z';
const DUE = '2026-09-29T08:00:00.000Z';
export const A_BRIEF = 'a0000000-0000-4000-8000-000000000001';
export const A_QUIZ = 'a0000000-0000-4000-8000-000000000002';
export const ITEM_BRIEF = 'b0000000-0000-4000-8000-000000000001';
export const ITEM_QUIZ = 'b0000000-0000-4000-8000-000000000002';
export const Q1 = 'c0000000-0000-4000-8000-000000000001';
export const Q2 = 'c0000000-0000-4000-8000-000000000002';

export const sampleAssignment = (over: Partial<Assignment> = {}): Assignment => ({
  id: A_BRIEF,
  itemId: ITEM_BRIEF,
  itemVersion: 1,
  kind: 'briefing',
  title: 'תדריך: איטיות גלישה',
  worldSlug: 'tech',
  estimatedMinutes: 6,
  reason: 'audience',
  status: 'open',
  assignedAt: T,
  dueAt: DUE,
  completedAt: null,
  attemptsUsed: 0,
  maxAttempts: null,
  lastScore: null,
  passMark: null,
  refreshReason: null,
  ...over,
});

const quizAssignment = (): Assignment =>
  sampleAssignment({
    id: A_QUIZ,
    itemId: ITEM_QUIZ,
    kind: 'quiz',
    title: 'שאלון: איטיות גלישה',
    passMark: 80,
    estimatedMinutes: 4,
  });

export const sampleBriefingPlayer = (): PlayerItem => ({
  assignment: sampleAssignment(),
  item: {
    id: ITEM_BRIEF,
    kind: 'briefing',
    title: 'תדריך: איטיות גלישה',
    description: 'מה חדש בטיפול באיטיות גלישה',
    worldSlug: 'tech',
    currentVersion: 1,
    passMark: null,
    maxAttempts: null,
    estimatedMinutes: 6,
  },
  entries: [
    {
      documentId: fx.docBrowsing.id,
      stepKey: null,
      note: 'שימו לב לסף החדש',
      documentTitle: fx.docBrowsing.title,
      phases: fx.docBrowsing.phases,
      changedSinceAssigned: false,
    },
  ],
  questions: [],
});

export const sampleQuizPlayer = (): PlayerItem => ({
  assignment: quizAssignment(),
  item: {
    id: ITEM_QUIZ,
    kind: 'quiz',
    title: 'שאלון: איטיות גלישה',
    description: '',
    worldSlug: 'tech',
    currentVersion: 1,
    passMark: 80,
    maxAttempts: null,
    estimatedMinutes: 4,
  },
  entries: [],
  questions: [
    {
      id: Q1,
      documentId: fx.docBrowsing.id,
      stepKey: 's2',
      stem: 'הלקוח מדווח על איטיות רק בבית. מה הצעד הראשון?',
      kind: 'single',
      explanation: 'בודקים קודם את מקום התקלה.',
      options: [
        { id: 'a', text: 'איפוס מכשיר' },
        { id: 'b', text: 'בדיקת כיסוי במיקום' },
        { id: 'c', text: 'החלפת SIM' },
      ],
    },
    {
      id: Q2,
      documentId: fx.docBrowsing.id,
      stepKey: 's3',
      stem: 'איזה שדה CRM מתעדים לאחר הבדיקה?',
      kind: 'single',
      explanation: 'תוצאת הבדיקה נרשמת בשדה הייעודי.',
      options: [
        { id: 'a', text: 'תוצאת Speedtest' },
        { id: 'b', text: 'הערות חופשיות' },
      ],
    },
  ],
});

/** 201 of `POST /learning/my/:assignmentId/attempts` — `StartAttemptResponseSchema`. */
export const sampleStart = (attemptNo: number): StartAttemptResponse => ({
  attemptId: `d0000000-0000-4000-8000-00000000000${attemptNo}`,
  attemptNo,
});

export const sampleResult = (passed: boolean): AttemptResult => ({
  attemptId: 'd0000000-0000-4000-8000-000000000001',
  score: passed ? 100 : 50,
  passed,
  attemptsLeft: null,
  perQuestion: [
    { questionId: Q1, correct: true, correctOptionIds: ['b'], explanation: 'בודקים קודם את מקום התקלה.' },
    {
      questionId: Q2,
      correct: passed,
      correctOptionIds: ['a'],
      explanation: 'תוצאת הבדיקה נרשמת בשדה הייעודי.',
    },
  ],
});

interface LearningState {
  my: MyLearningResponse;
  docLearning: DocumentLearning;
  acknowledged: string[];
  attempts: { assignmentId: string; attemptId: string; answers?: unknown }[];
  nextResultPassed: boolean;
}
const initial = (): LearningState => ({
  my: {
    open: [sampleAssignment(), quizAssignment()],
    overdue: [
      sampleAssignment({
        id: 'a0000000-0000-4000-8000-000000000003',
        title: 'תדריך: eSIM',
        dueAt: '2026-09-01T08:00:00.000Z',
        status: 'overdue',
        reason: 'refresh',
        refreshReason: 'שינוי מהותי במסמך',
      }),
    ],
    completed: [
      sampleAssignment({
        id: 'a0000000-0000-4000-8000-000000000004',
        title: 'שאלון: חיובים',
        kind: 'quiz',
        status: 'completed',
        completedAt: T,
        lastScore: 90,
        passMark: 80,
        attemptsUsed: 1,
      }),
    ],
    invalidated: [],
  },
  docLearning: {
    items: [],
    refreshRequired: false,
    refreshAssignmentId: null,
    lastSignificantChange: null,
  },
  acknowledged: [],
  attempts: [],
  nextResultPassed: true,
});
export const learningState: LearningState = initial();
export const resetLearningState = (): void => {
  Object.assign(learningState, initial());
};

export const learningHandlers: RequestHandler[] = [
  http.get(`${B}/learning/my`, () => HttpResponse.json(learningState.my)),
  http.get(`${B}/learning/my/:assignmentId`, ({ params }) => {
    if (params.assignmentId === A_BRIEF) return HttpResponse.json(sampleBriefingPlayer());
    if (params.assignmentId === A_QUIZ) return HttpResponse.json(sampleQuizPlayer());
    return HttpResponse.json({ code: 'NOT_FOUND', message: 'המטלה לא נמצאה' }, { status: 404 });
  }),
  // The contract answers the completed `AssignmentSchema`, not 204 — see CONTRACTS-wave5.md.
  http.post(`${B}/learning/my/:assignmentId/acknowledge`, ({ params }) => {
    learningState.acknowledged.push(String(params.assignmentId));
    const a = learningState.my.open.find((x) => x.id === params.assignmentId);
    const done: Assignment = { ...(a ?? sampleAssignment()), status: 'completed', completedAt: T };
    if (a) {
      learningState.my.open = learningState.my.open.filter((x) => x.id !== a.id);
      learningState.my.completed.unshift(done);
    }
    return HttpResponse.json(done);
  }),
  http.post(`${B}/learning/my/:assignmentId/attempts`, ({ params }) => {
    const start = sampleStart(learningState.attempts.length + 1);
    learningState.attempts.push({
      assignmentId: String(params.assignmentId),
      attemptId: start.attemptId,
    });
    return HttpResponse.json(start, { status: 201 });
  }),
  http.put(`${B}/learning/attempts/:id`, async ({ params, request }) => {
    const att = learningState.attempts.find((a) => a.attemptId === params.id);
    if (att) att.answers = await request.json();
    const result = sampleResult(learningState.nextResultPassed);
    if (result.passed && att) {
      const a = learningState.my.open.find((x) => x.id === att.assignmentId);
      if (a) {
        learningState.my.open = learningState.my.open.filter((x) => x.id !== a.id);
        learningState.my.completed.unshift({
          ...a,
          status: 'completed',
          completedAt: T,
          lastScore: result.score,
          attemptsUsed: 1,
        });
      }
    }
    return HttpResponse.json({ ...result, attemptId: String(params.id) });
  }),
  http.get(`${B}/documents/:id/learning`, () => HttpResponse.json(learningState.docLearning)),
];
