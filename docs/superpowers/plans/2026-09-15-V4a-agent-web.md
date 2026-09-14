# V4a — Agent Web (My Learning, Briefing Reader, Quiz Player, Article Banners) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give agents the learning surface PRD §13 asks for: a `/learning` page listing their assignments, a briefing reader that ends with "קראתי והבנתי", a quiz player with pass/fail and unlimited retakes, refresh banners on the article, and notification-centre support for the new `learning`/`gap` kinds — all web-only, built against MSW while V1/V2 build the API in parallel.

**Architecture:** One hook module (`api/hooks/learning.ts`) typed from `@wecom/shared` `wave5.ts` and validated at runtime with `checked`. Because the `/learning/*` routes are not in `openapi.json` until V2 lands, the hooks call a 20-line local bridge (`learningRequest`) that uses the same `API_BASE`, credentials and `ApiError` as the generated client; V6 swaps each call to `api.GET/POST/PUT` in place (the swap points are marked `// V6: api.*`). Components live under `components/learning/`; the reader reuses the article's read-only step renderer (`DocBody` + `resolvedSteps`) through a small `entryDoc()` adapter, so briefing entries look exactly like the article. The quiz player handles `1`–`4`/`Enter` with a container `onKeyDown` rather than the global hotkey registry (adding a scope to `lib/keys.ts` is cross-cutting and unnecessary for a focused view). Mounts in the shell, article and notifications bell are V6's; this lane ships components plus route entries and lists the mount points.

**Tech Stack:** React 18, TypeScript strict, React Router 6 (lazy routes), TanStack Query 5, zod (`@wecom/shared`), Vitest + Testing Library + MSW 2, Hebrew RTL UI.

**Spec:** `docs/superpowers/specs/2026-09-15-kb-wave5-learning-design.md` (§1.4 unlimited retakes, §4 Assignments agent routes, §5 reader/player/refresh); contract `docs/api/CONTRACTS-wave5.md` (written by V0 Task 5); schemas `packages/shared/src/schemas/wave5.ts`.

## Global Constraints

- Node `>=22`, pnpm `>=9`, TypeScript `strict: true`. Run from the repo root: `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4`, `pnpm --filter @wecom/web build`, `pnpm lint`.
- Types and runtime validation only from `@wecom/shared` (`MyLearningResponseSchema`, `PlayerItemSchema`, `AttemptResultSchema`, `DocumentLearningSchema`, `AssignmentSchema`, `AttemptAnswersSchema`); never restate a shape locally.
- Append-only touches to shared files: `apps/web/src/routes.tsx` (lazy route entries in the "lazy" section), `apps/web/src/api/keys.ts`, `apps/web/test/msw/handlers.ts` (spread one new handler group + call one reset), `apps/web/src/api/events.ts` (one new `else if` block), `apps/web/src/components/notifications/NotificationList.tsx` (two entries in `TABS`, two in `ICON` — required, because `ICON` is an exhaustive `Record` over `NotificationKindSchema`, which V0 widened).
- Never edit `components/shell/*`, `ArticlePage.tsx`, `StepView.tsx`, `EditorPage.tsx`, `LibraryPage.tsx`, anything under `apps/api/` or `packages/`. Mount points go in the lane report for V6.
- Hebrew strings verbatim from this plan; RTL is the default direction in `app.css`.
- Known pre-existing flakiness: run the web suite with `--minWorkers=1 --maxWorkers=4`; re-run a timed-out file in isolation before calling it red.
- Commit after every task; end each commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File structure

```
apps/web/src/api/keys.ts                                   (modify: `learning` key family)
apps/web/src/api/hooks/learning.ts                         hooks + local bridge (new)
apps/web/src/api/events.ts                                 (modify: learning.* → invalidate ['learning'], keys.doc)
apps/web/src/lib/learning.ts                               entryDoc(), dueTone(), scoreLabel() (new)
apps/web/src/components/learning/AssignmentCard.tsx        (new)
apps/web/src/components/learning/MyLearningPage.tsx        /learning (new)
apps/web/src/components/learning/BriefingReader.tsx        (new)
apps/web/src/components/learning/QuizPlayer.tsx            (new)
apps/web/src/components/learning/AssignmentPage.tsx        /learning/:assignmentId → reader or player (new)
apps/web/src/components/learning/RefreshBanner.tsx         article banner (new; V6 mounts)
apps/web/src/components/learning/LearningBadge.tsx         "כלול ב-N פריטי למידה" chip (new; V6 mounts)
apps/web/src/components/notifications/NotificationList.tsx (modify: TABS + ICON for learning, gap)
apps/web/src/routes.tsx                                    (modify: two lazy routes)
apps/web/test/msw/learning-handlers.ts                     handler group + mutable state + samples (new)
apps/web/test/msw/handlers.ts                              (modify: spread group, reset)
apps/web/test/learning/fixtures.test.ts                    contract parity (new)
apps/web/test/learning/MyLearning.test.tsx                 (new)
apps/web/test/learning/BriefingReader.test.tsx             (new)
apps/web/test/learning/QuizPlayer.test.tsx                 (new)
apps/web/test/learning/ArticleLearning.test.tsx            RefreshBanner + LearningBadge + notifications (new)
```

## Names other lanes consume (produced here)

- Hooks: `useMyLearning()`, `usePlayerItem(assignmentId)`, `useAcknowledge(assignmentId)`, `useStartAttempt(assignmentId)`, `useSubmitAttempt(attemptId)`, `useDocumentLearning(documentId, enabled)`.
- Keys: `keys.learning.my`, `keys.learning.player(assignmentId)`, `keys.learning.doc(documentId)` — every key starts with `'learning'`.
- Components (props in the tasks): `MyLearningPage`, `AssignmentPage`, `AssignmentCard`, `BriefingReader`, `QuizPlayer`, `RefreshBanner({ documentId })`, `LearningBadge({ documentId })`.
- MSW: `learningHandlers`, `learningState`, `resetLearningState()`, `sampleAssignment()`, `sampleBriefingPlayer()`, `sampleQuizPlayer()`.
- Routes: `/learning`, `/learning/:assignmentId`.

---

### Task 1: Keys, hooks with the local bridge, MSW handler group, contract-parity test

**Files:**
- Modify: `apps/web/src/api/keys.ts`, `apps/web/test/msw/handlers.ts`
- Create: `apps/web/src/api/hooks/learning.ts`, `apps/web/test/msw/learning-handlers.ts`, `apps/web/test/learning/fixtures.test.ts`

**Interfaces:**
- Consumes: `API_BASE` from `apps/web/src/api/client.ts`; `ApiError` from `apps/web/src/api/unwrap.ts`; `fx.me`, `fx.docBrowsing` from `apps/web/test/msw/fixtures.ts`; schemas from `@wecom/shared`.
- Produces: the hooks, keys and MSW names listed above.

- [ ] **Step 1: Write the failing contract-parity test**

`apps/web/test/learning/fixtures.test.ts`:
```tsx
import { describe, it, expect } from 'vitest';
import {
  AssignmentSchema,
  AttemptResultSchema,
  DocumentLearningSchema,
  MyLearningResponseSchema,
  PlayerItemSchema,
} from '@wecom/shared';
import {
  learningState,
  sampleAssignment,
  sampleBriefingPlayer,
  sampleQuizPlayer,
  sampleResult,
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
  it('results and document learning parse', () => {
    expect(AttemptResultSchema.safeParse(sampleResult(true)).success).toBe(true);
    expect(DocumentLearningSchema.safeParse(learningState.docLearning).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4 test/learning/fixtures.test.ts` → FAIL (module `../msw/learning-handlers.js` not found).

- [ ] **Step 3: Add the keys**

`apps/web/src/api/keys.ts` — append inside `keys` after the `analytics` block:
```ts
  /* wave 5 — learning (V4a); every key starts with 'learning' so one prefix invalidates the lot */
  learning: {
    my: ['learning', 'my'] as const,
    player: (assignmentId: string) => ['learning', 'player', assignmentId] as const,
    doc: (documentId: string) => ['learning', 'doc', documentId] as const,
  },
```

- [ ] **Step 4: Write the hooks**

`apps/web/src/api/hooks/learning.ts`:
```ts
/**
 * Wave 5 (V4a) — the agent's side of learning: my assignments, the reader/player payload,
 * acknowledgements and quiz attempts, and the per-document refresh state.
 *
 * The `/learning/*` routes land with V2, in parallel with this lane, so they are not in
 * `docs/api/openapi.json` yet and `api.GET('/learning/my')` cannot compile. Until V6 swaps the
 * transport (each call site is marked `V6: api.*`), `learningRequest` is the same shape as the
 * generated client — same base, same credentials, same `ApiError` envelope — and every answer is
 * still parsed with `checked` against the shared zod contract.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import {
  AttemptResultSchema,
  DocumentLearningSchema,
  MyLearningResponseSchema,
  PlayerItemSchema,
  type AttemptAnswersSchema,
} from '@wecom/shared';
import { API_BASE } from '../client.js';
import { keys } from '../keys.js';
import { checked } from '../stage45.js';
import { ApiError } from '../unwrap.js';

export type AttemptAnswers = z.input<typeof AttemptAnswersSchema>;

/** Temporary transport (see header). Mirrors `openapi-fetch`'s `{ data, error, response }`. */
async function learningRequest(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<{ data?: unknown; error?: unknown; response: Response }> {
  const response = await globalThis.fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return { data: undefined, response };
  const json = (await response.json().catch(() => undefined)) as unknown;
  if (!response.ok) {
    const env = (json ?? {}) as { code?: string; message?: string; details?: unknown };
    throw new ApiError(response.status, env.code ?? 'HTTP_' + response.status, env.message ?? 'השרת החזיר שגיאה', env.details);
  }
  return { data: json, response };
}

const ALL = { queryKey: ['learning'] as const };

export const useMyLearning = (enabled = true) =>
  useQuery({
    queryKey: keys.learning.my,
    enabled,
    // V6: api.GET('/learning/my')
    queryFn: async () => checked(MyLearningResponseSchema, await learningRequest('GET', '/learning/my')),
  });

export const usePlayerItem = (assignmentId: string | undefined) =>
  useQuery({
    queryKey: keys.learning.player(assignmentId ?? ''),
    enabled: !!assignmentId,
    // V6: api.GET('/learning/my/{assignmentId}')
    queryFn: async () =>
      checked(PlayerItemSchema, await learningRequest('GET', `/learning/my/${assignmentId}`)),
  });

export const useAcknowledge = (assignmentId: string) => {
  const qc = useQueryClient();
  return useMutation({
    // V6: api.POST('/learning/my/{assignmentId}/acknowledge')
    mutationFn: async () => {
      await learningRequest('POST', `/learning/my/${assignmentId}/acknowledge`);
    },
    onSuccess: () => void qc.invalidateQueries(ALL),
  });
};

export const useStartAttempt = (assignmentId: string) =>
  useMutation({
    // V6: api.POST('/learning/my/{assignmentId}/attempts')
    mutationFn: async () => {
      const r = await learningRequest('POST', `/learning/my/${assignmentId}/attempts`);
      const { attemptId } = r.data as { attemptId: string };
      return attemptId;
    },
  });

export const useSubmitAttempt = () => {
  const qc = useQueryClient();
  return useMutation({
    // V6: api.PUT('/learning/attempts/{id}')
    mutationFn: async ({ attemptId, answers }: { attemptId: string; answers: AttemptAnswers }) =>
      checked(AttemptResultSchema, await learningRequest('PUT', `/learning/attempts/${attemptId}`, answers)),
    onSuccess: () => void qc.invalidateQueries(ALL),
  });
};

/** `enabled` lets the article skip the call for users without `learning.read`. */
export const useDocumentLearning = (documentId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: keys.learning.doc(documentId ?? ''),
    enabled: enabled && !!documentId,
    // V6: api.GET('/documents/{id}/learning')
    queryFn: async () =>
      checked(DocumentLearningSchema, await learningRequest('GET', `/documents/${documentId}/learning`)),
  });
```

- [ ] **Step 5: Write the MSW handler group**

`apps/web/test/msw/learning-handlers.ts`:
```ts
/**
 * msw handlers for the wave 5 agent routes (`docs/api/CONTRACTS-wave5.md`, V2 rows the agent
 * calls). Mutable state so tests can assert what the UI sent; reset via `resetLearningState()`.
 */
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { Assignment, AttemptResult, DocumentLearning, MyLearningResponse, PlayerItem } from '@wecom/shared';
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
  sampleAssignment({ id: A_QUIZ, itemId: ITEM_QUIZ, kind: 'quiz', title: 'שאלון: איטיות גלישה', passMark: 80, estimatedMinutes: 4 });

export const sampleBriefingPlayer = (): PlayerItem => ({
  assignment: sampleAssignment(),
  item: { id: ITEM_BRIEF, kind: 'briefing', title: 'תדריך: איטיות גלישה', description: 'מה חדש בטיפול באיטיות גלישה', worldSlug: 'tech', currentVersion: 1, passMark: null, maxAttempts: null, estimatedMinutes: 6 },
  entries: [
    { documentId: fx.docBrowsing.id, stepKey: null, note: 'שימו לב לסף החדש', documentTitle: fx.docBrowsing.title, phases: fx.docBrowsing.phases, changedSinceAssigned: false },
  ],
  questions: [],
});

export const sampleQuizPlayer = (): PlayerItem => ({
  assignment: quizAssignment(),
  item: { id: ITEM_QUIZ, kind: 'quiz', title: 'שאלון: איטיות גלישה', description: '', worldSlug: 'tech', currentVersion: 1, passMark: 80, maxAttempts: null, estimatedMinutes: 4 },
  entries: [],
  questions: [
    { id: Q1, documentId: fx.docBrowsing.id, stepKey: 's2', stem: 'הלקוח מדווח על איטיות רק בבית. מה הצעד הראשון?', kind: 'single', explanation: 'בודקים קודם את מקום התקלה.', options: [{ id: 'a', text: 'איפוס מכשיר' }, { id: 'b', text: 'בדיקת כיסוי במיקום' }, { id: 'c', text: 'החלפת SIM' }] },
    { id: Q2, documentId: fx.docBrowsing.id, stepKey: 's3', stem: 'איזה שדה CRM מתעדים לאחר הבדיקה?', kind: 'single', explanation: 'תוצאת הבדיקה נרשמת בשדה הייעודי.', options: [{ id: 'a', text: 'תוצאת Speedtest' }, { id: 'b', text: 'הערות חופשיות' }] },
  ],
});

export const sampleResult = (passed: boolean): AttemptResult => ({
  attemptId: 'd0000000-0000-4000-8000-000000000001',
  score: passed ? 100 : 50,
  passed,
  attemptsLeft: null,
  perQuestion: [
    { questionId: Q1, correct: true, correctOptionIds: ['b'], explanation: 'בודקים קודם את מקום התקלה.' },
    { questionId: Q2, correct: passed, correctOptionIds: ['a'], explanation: 'תוצאת הבדיקה נרשמת בשדה הייעודי.' },
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
    overdue: [sampleAssignment({ id: 'a0000000-0000-4000-8000-000000000003', title: 'תדריך: eSIM', dueAt: '2026-09-01T08:00:00.000Z', status: 'overdue', reason: 'refresh', refreshReason: 'שינוי מהותי במסמך' })],
    completed: [sampleAssignment({ id: 'a0000000-0000-4000-8000-000000000004', title: 'שאלון: חיובים', kind: 'quiz', status: 'completed', completedAt: T, lastScore: 90, passMark: 80, attemptsUsed: 1 })],
    invalidated: [],
  },
  docLearning: {
    items: [],
    refreshRequired: false,
    lastSignificantChange: null,
  },
  acknowledged: [],
  attempts: [],
  nextResultPassed: true,
});
export const learningState: LearningState = initial();
export const resetLearningState = (): void => Object.assign(learningState, initial());

export const learningHandlers: RequestHandler[] = [
  http.get(`${B}/learning/my`, () => HttpResponse.json(learningState.my)),
  http.get(`${B}/learning/my/:assignmentId`, ({ params }) => {
    if (params.assignmentId === A_BRIEF) return HttpResponse.json(sampleBriefingPlayer());
    if (params.assignmentId === A_QUIZ) return HttpResponse.json(sampleQuizPlayer());
    return HttpResponse.json({ code: 'NOT_FOUND', message: 'המטלה לא נמצאה' }, { status: 404 });
  }),
  http.post(`${B}/learning/my/:assignmentId/acknowledge`, ({ params }) => {
    learningState.acknowledged.push(String(params.assignmentId));
    const a = learningState.my.open.find((x) => x.id === params.assignmentId);
    if (a) {
      learningState.my.open = learningState.my.open.filter((x) => x.id !== a.id);
      learningState.my.completed.unshift({ ...a, status: 'completed', completedAt: T });
    }
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(`${B}/learning/my/:assignmentId/attempts`, ({ params }) => {
    const attemptId = `d0000000-0000-4000-8000-00000000000${learningState.attempts.length + 1}`;
    learningState.attempts.push({ assignmentId: String(params.assignmentId), attemptId });
    return HttpResponse.json({ attemptId }, { status: 201 });
  }),
  http.put(`${B}/learning/attempts/:id`, async ({ params, request }) => {
    const att = learningState.attempts.find((a) => a.attemptId === params.id);
    if (att) att.answers = await request.json();
    const result = sampleResult(learningState.nextResultPassed);
    if (result.passed && att) {
      const a = learningState.my.open.find((x) => x.id === att.assignmentId);
      if (a) {
        learningState.my.open = learningState.my.open.filter((x) => x.id !== a.id);
        learningState.my.completed.unshift({ ...a, status: 'completed', completedAt: T, lastScore: result.score, attemptsUsed: 1 });
      }
    }
    return HttpResponse.json({ ...result, attemptId: String(params.id) });
  }),
  http.get(`${B}/documents/:id/learning`, () => HttpResponse.json(learningState.docLearning)),
];
```

`apps/web/test/msw/handlers.ts` — add the import next to the feedback one, spread `...learningHandlers` right after `...feedbackHandlers` in `handlers`, and call `resetLearningState()` inside `resetState()` after `resetFeedbackState()`:
```ts
import { learningHandlers, resetLearningState } from './learning-handlers.js';
```

- [ ] **Step 6: Run** — `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4 test/learning/fixtures.test.ts` → PASS (3 tests). Also `pnpm --filter @wecom/web build` → green (if `fx.docBrowsing.phases` is typed loosely, the `PlayerItem` literal still parses at runtime; the build checks the hook types).

- [ ] **Step 7: Commit**
```bash
git add apps/web/src/api/keys.ts apps/web/src/api/hooks/learning.ts apps/web/test/msw/learning-handlers.ts apps/web/test/msw/handlers.ts apps/web/test/learning/fixtures.test.ts
git commit -m "feat(web): wave 5 learning hooks, keys and msw contract fixtures"
```

---

### Task 2: `/learning` — MyLearningPage and AssignmentCard

**Files:**
- Create: `apps/web/src/lib/learning.ts`, `apps/web/src/components/learning/AssignmentCard.tsx`, `apps/web/src/components/learning/MyLearningPage.tsx`
- Modify: `apps/web/src/routes.tsx`
- Test: `apps/web/test/learning/MyLearning.test.tsx`

**Interfaces:**
- Consumes: `useMyLearning`, `useCan` (`api/hooks/me.ts`), `ago`, `fmtDate`, `inDays` (`lib/format.ts`), `Chip`, `Empty`, `LoadError` (`components/ui/index.tsx`), `Hamburger` (`components/shell/MobileDrawer.tsx`).
- Produces: `AssignmentCard({ a: Assignment })`, `MyLearningPage()`, `dueTone(a)`, `scoreLabel(a)`; route `/learning`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/learning/MyLearning.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../render.js';
import { MyLearningPage } from '../../src/components/learning/MyLearningPage.js';

const mount = () =>
  renderWithProviders(
    <Routes>
      <Route path="/learning" element={<MyLearningPage />} />
      <Route path="/learning/:assignmentId" element={<div data-testid="assignment-page" />} />
    </Routes>,
    { route: '/learning' },
  );

describe('<MyLearningPage>', () => {
  it('lists open, overdue and completed assignments with kind, due date and status', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'הלמידה שלי' })).toBeInTheDocument();
    const open = screen.getByRole('region', { name: 'פתוחות' });
    expect(within(open).getAllByRole('article')).toHaveLength(2);
    expect(within(open).getByText('תדריך: איטיות גלישה')).toBeInTheDocument();
    expect(within(open).getByText('תדריך')).toBeInTheDocument();
    expect(within(open).getByText('שאלון')).toBeInTheDocument();
    const overdue = screen.getByRole('region', { name: 'באיחור' });
    expect(within(overdue).getByText('רענון ידע')).toBeInTheDocument();
    expect(within(overdue).getByText(/שינוי מהותי במסמך/)).toBeInTheDocument();
    const done = screen.getByRole('region', { name: 'הושלמו' });
    expect(within(done).getByText('ציון 90')).toBeInTheDocument();
  });
  it('opens an assignment', async () => {
    mount();
    await userEvent.click(await screen.findByRole('link', { name: /תדריך: איטיות גלישה/ }));
    expect(await screen.findByTestId('assignment-page')).toBeInTheDocument();
  });
  it('shows an empty state when nothing is assigned', async () => {
    const { learningState } = await import('../msw/learning-handlers.js');
    learningState.my = { open: [], overdue: [], completed: [], invalidated: [] };
    mount();
    expect(await screen.findByText('אין לך מטלות למידה כרגע')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Write the helpers**

`apps/web/src/lib/learning.ts`:
```ts
import type { Assignment, Document } from '@wecom/shared';

export const KIND_LABEL: Record<Assignment['kind'], string> = { briefing: 'תדריך', quiz: 'שאלון' };
export const STATUS_LABEL: Record<Assignment['status'], string> = {
  open: 'פתוחה',
  overdue: 'באיחור',
  completed: 'הושלמה',
  invalidated: 'בוטלה',
};

/** Chip tone for the due date: red when overdue, amber inside 3 days, gray otherwise. */
export function dueTone(a: Assignment, now = Date.now()): 'chip-red' | 'chip-amber' | 'chip-gray' {
  if (a.status === 'overdue') return 'chip-red';
  const days = (new Date(a.dueAt).getTime() - now) / 864e5;
  return days < 0 ? 'chip-red' : days <= 3 ? 'chip-amber' : 'chip-gray';
}

/** "ציון 90" for a scored quiz, "" for briefings and unscored quizzes. */
export const scoreLabel = (a: Assignment): string =>
  a.kind === 'quiz' && a.lastScore !== null ? `ציון ${a.lastScore}` : '';

/**
 * A briefing entry arrives with its title and phases pinned at the version the learner was
 * assigned; `DocBody` wants a `Document`, so build a neutral one instead of casting.
 */
export function entryDoc(entry: { documentId: string; documentTitle: string; phases: Document['phases'] }): Document {
  const now = new Date(0).toISOString();
  return {
    id: entry.documentId,
    slug: 'learning-entry',
    title: entry.documentTitle,
    description: '',
    category: 'ops',
    wave: 1,
    priority: 'm',
    kind: 'steps',
    status: 'published',
    currentVersion: 0,
    phases: entry.phases,
    related: [],
    tags: [],
    worlds: [],
    topics: [],
    sourceReviewNeeded: false,
    createdAt: now,
    updatedAt: now,
  };
}
```
If `DocumentSchema` requires further fields at compile time (check `packages/shared/src/schemas/content.ts`), add them with neutral values here — never cast.

- [ ] **Step 4: Write the card and the page**

`apps/web/src/components/learning/AssignmentCard.tsx`:
```tsx
import { Link } from 'react-router-dom';
import type { Assignment } from '@wecom/shared';
import { fmtDate, inDays } from '../../lib/format.js';
import { KIND_LABEL, dueTone, scoreLabel } from '../../lib/learning.js';
import { Chip } from '../ui/index.js';

export function AssignmentCard({ a }: { a: Assignment }) {
  const due = a.status === 'completed' ? `הושלם ${fmtDate(a.completedAt ?? a.dueAt)}` : `יעד: ${inDays(a.dueAt)}`;
  return (
    <article className="tcard learning-card">
      <div className="learning-card-head">
        <Chip tone={a.kind === 'quiz' ? 'chip-purple' : 'chip-blue'}>{KIND_LABEL[a.kind]}</Chip>
        {a.reason === 'refresh' ? <Chip tone="chip-amber">רענון ידע</Chip> : null}
        <span className="grow" />
        <Chip tone={a.status === 'completed' ? 'chip-green' : dueTone(a)}>{due}</Chip>
      </div>
      <Link to={`/learning/${a.id}`} className="learning-card-title">
        {a.title}
      </Link>
      <div className="learning-card-meta">
        {a.estimatedMinutes ? <span>{a.estimatedMinutes} דק׳</span> : null}
        {a.refreshReason ? <span>סיבה: {a.refreshReason}</span> : null}
        {scoreLabel(a) ? <span>{scoreLabel(a)}</span> : null}
        {a.kind === 'quiz' && a.passMark ? <span>ציון עובר {a.passMark}</span> : null}
      </div>
    </article>
  );
}
```

`apps/web/src/components/learning/MyLearningPage.tsx`:
```tsx
import type { Assignment } from '@wecom/shared';
import { useMyLearning } from '../../api/hooks/learning.js';
import { useCan } from '../../api/hooks/me.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { Empty, LoadError } from '../ui/index.js';
import { AssignmentCard } from './AssignmentCard.js';

function Section({ title, items }: { title: string; items: Assignment[] }) {
  if (!items.length) return null;
  return (
    <section className="learning-section" aria-label={title}>
      <h2>
        {title} <span className="chip chip-gray">{items.length}</span>
      </h2>
      <div className="grid">
        {items.map((a) => (
          <AssignmentCard key={a.id} a={a} />
        ))}
      </div>
    </section>
  );
}

/** PRD §13 — the agent's assignments: briefings to read, quizzes to pass, refreshes to redo. */
export function MyLearningPage() {
  const can = useCan();
  const mayRead = can('learning.read');
  const my = useMyLearning(mayRead);
  if (!mayRead)
    return (
      <div className="page">
        <Empty title="אין הרשאה ללמידה">פנה למנהל המערכת.</Empty>
      </div>
    );
  const d = my.data;
  const empty = d && !d.open.length && !d.overdue.length && !d.completed.length && !d.invalidated.length;
  return (
    <div className="page learning-page">
      <div className="lib-head">
        <Hamburger />
        <h1>הלמידה שלי</h1>
      </div>
      {my.isError ? <LoadError what="מטלות הלמידה" error={my.error} /> : null}
      {empty ? <Empty title="אין לך מטלות למידה כרגע">כשיוקצה לך תדריך או שאלון, הוא יופיע כאן.</Empty> : null}
      {d ? (
        <>
          <Section title="באיחור" items={d.overdue} />
          <Section title="פתוחות" items={d.open} />
          <Section title="הושלמו" items={d.completed} />
          <Section title="בוטלו" items={d.invalidated} />
        </>
      ) : null}
    </div>
  );
}
```

`apps/web/src/routes.tsx` — in the lazy section add:
```tsx
/** Wave 5 (V4a): the agent's learning screens are reached deliberately, not mid-call. */
const MyLearningPage = () =>
  import('./components/learning/MyLearningPage.js').then((m) => ({ default: m.MyLearningPage }));
const AssignmentPage = () =>
  import('./components/learning/AssignmentPage.js').then((m) => ({ default: m.AssignmentPage }));
```
and in the children array, after the `analytics` entry:
```tsx
      { path: 'learning', element: split(MyLearningPage) },
      { path: 'learning/:assignmentId', element: split(AssignmentPage) },
```
(`split` is the existing Suspense wrapper used by the other lazy routes; `AssignmentPage` is created in Task 3 — add a one-line placeholder component now so the build stays green: `export function AssignmentPage() { return null; }`, replaced in Task 3.)

- [ ] **Step 5: Run** — `test/learning/MyLearning.test.tsx` → PASS (3); `pnpm --filter @wecom/web build` green.
- [ ] **Step 6: Commit** — `feat(web): /learning — my assignments page and cards`

---

### Task 3: Briefing reader and the assignment page

**Files:**
- Create: `apps/web/src/components/learning/BriefingReader.tsx`, `apps/web/src/components/learning/AssignmentPage.tsx` (replace the placeholder)
- Test: `apps/web/test/learning/BriefingReader.test.tsx`

**Interfaces:**
- Consumes: `DocBody`, `StepCtx` from `components/article/StepView.tsx`; `resolvedSteps` from `lib/steps.ts`; `useBlocks`, `useFields` from `api/hooks/content.ts`; `entryDoc` from `lib/learning.ts`; `usePlayerItem`, `useAcknowledge`; `useToast` from `components/ui/Toast.tsx`.
- Produces: `BriefingReader({ item: PlayerItem })`, `AssignmentPage()`.

- [ ] **Step 1: Write the failing test**
```tsx
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../render.js';
import { AssignmentPage } from '../../src/components/learning/AssignmentPage.js';
import { A_BRIEF, learningState } from '../msw/learning-handlers.js';
import { fx } from '../msw/fixtures.js';

const mount = (id = A_BRIEF) =>
  renderWithProviders(
    <Routes>
      <Route path="/learning" element={<div data-testid="my-learning" />} />
      <Route path="/learning/:assignmentId" element={<AssignmentPage />} />
    </Routes>,
    { route: `/learning/${id}` },
  );

describe('<BriefingReader>', () => {
  it('renders the intro, the entries with the article step renderer, and acknowledges', async () => {
    mount();
    expect(await screen.findByRole('heading', { level: 1, name: 'תדריך: איטיות גלישה' })).toBeInTheDocument();
    expect(screen.getByText('מה חדש בטיפול באיטיות גלישה')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: fx.docBrowsing.title })).toBeInTheDocument();
    expect(screen.getByText('שימו לב לסף החדש')).toBeInTheDocument();
    // The first step of the fixture document is rendered by the shared renderer.
    expect(screen.getByText(fx.docBrowsing.phases[0].steps[0].title)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'קראתי והבנתי' }));
    await waitFor(() => expect(learningState.acknowledged).toEqual([A_BRIEF]));
    expect(await screen.findByText('התדריך סומן כנקרא')).toBeInTheDocument();
    expect(await screen.findByTestId('my-learning')).toBeInTheDocument();
  });
  it('shows the changed-since-assigned banner on an entry', async () => {
    const { sampleBriefingPlayer } = await import('../msw/learning-handlers.js');
    const { http, HttpResponse } = await import('msw');
    const { server } = await import('../msw/server.js');
    const p = sampleBriefingPlayer();
    p.entries[0].changedSinceAssigned = true;
    server.use(http.get(`/api/v1/learning/my/${A_BRIEF}`, () => HttpResponse.json(p)));
    mount();
    expect(await screen.findByText('התוכן עודכן – יש לקרוא שוב')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`apps/web/src/components/learning/BriefingReader.tsx`:
```tsx
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PlayerItem } from '@wecom/shared';
import { useBlocks, useFields } from '../../api/hooks/content.js';
import { useAcknowledge } from '../../api/hooks/learning.js';
import { entryDoc } from '../../lib/learning.js';
import { resolvedSteps } from '../../lib/steps.js';
import { DocBody, type StepCtx } from '../article/StepView.js';
import { useToast } from '../ui/Toast.js';
import { Button } from '../ui/index.js';

/** Spec §5: intro, entries rendered exactly like the article, "קראתי והבנתי" at the end. */
export function BriefingReader({ item }: { item: PlayerItem }) {
  const blocks = useBlocks();
  const fields = useFields();
  const ack = useAcknowledge(item.assignment.id);
  const toast = useToast();
  const go = useNavigate();
  const ctx: StepCtx = useMemo(
    () => ({ expandAll: true, fields: fields.data?.items ?? [], docs: [], blocks: blocks.data?.items ?? [], prefix: 'L-' }),
    [fields.data, blocks.data],
  );
  const done = item.assignment.status === 'completed';
  return (
    <div className="briefing">
      {item.item.description ? <p className="briefing-intro">{item.item.description}</p> : null}
      {item.entries.map((e, i) => {
        const doc = entryDoc(e);
        const steps = resolvedSteps(doc, blocks.data?.items);
        return (
          <section key={`${e.documentId}-${i}`} className="briefing-entry" aria-label={e.documentTitle}>
            <h2>{e.documentTitle}</h2>
            {e.changedSinceAssigned ? <div className="banner banner-amber">התוכן עודכן – יש לקרוא שוב</div> : null}
            {e.note ? <p className="briefing-note">{e.note}</p> : null}
            <DocBody doc={doc} ctx={ctx} steps={steps} />
          </section>
        );
      })}
      <div className="briefing-foot">
        {done ? (
          <span className="chip chip-green">סומן כנקרא</span>
        ) : (
          <Button
            onClick={() =>
              ack.mutate(undefined, {
                onSuccess: () => {
                  toast('התדריך סומן כנקרא');
                  go('/learning');
                },
                onError: () => toast('הסימון נכשל, נסה שוב', 'warn'),
              })
            }
            disabled={ack.isPending}
          >
            קראתי והבנתי
          </Button>
        )}
      </div>
    </div>
  );
}
```
(Check `Button`'s props in `components/ui/index.tsx:4` and `useToast`'s signature in `Toast.tsx` — the toast call form `toast(text, tone?)` is what the feedback components use; match it exactly.)

`apps/web/src/components/learning/AssignmentPage.tsx`:
```tsx
import { Link, useParams } from 'react-router-dom';
import { usePlayerItem } from '../../api/hooks/learning.js';
import { KIND_LABEL } from '../../lib/learning.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { Chip, Empty, LoadError } from '../ui/index.js';
import { BriefingReader } from './BriefingReader.js';
import { QuizPlayer } from './QuizPlayer.js';

/** `/learning/:assignmentId` — one route, two bodies: the reader for briefings, the player for quizzes. */
export function AssignmentPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const q = usePlayerItem(assignmentId);
  if (q.isPending) return <div className="page" aria-busy="true" />;
  if (q.isError)
    return (
      <div className="page">
        {(q.error as { status?: number }).status === 404 ? (
          <Empty title="המטלה לא נמצאה">
            <Link to="/learning">חזרה ללמידה שלי</Link>
          </Empty>
        ) : (
          <LoadError what="המטלה" error={q.error} />
        )}
      </div>
    );
  const item = q.data;
  return (
    <div className="page learning-page">
      <div className="lib-head">
        <Hamburger />
        <Link to="/learning" className="linklike">← הלמידה שלי</Link>
        <Chip tone={item.item.kind === 'quiz' ? 'chip-purple' : 'chip-blue'}>{KIND_LABEL[item.item.kind]}</Chip>
        <h1>{item.item.title}</h1>
      </div>
      {item.item.kind === 'briefing' ? <BriefingReader item={item} /> : <QuizPlayer item={item} />}
    </div>
  );
}
```
Until Task 4 exists, create `QuizPlayer.tsx` as `export function QuizPlayer(_: { item: PlayerItem }) { return null; }` (typed import of `PlayerItem`), replaced in Task 4.

- [ ] **Step 4: Run** — reader tests PASS (2); build green.
- [ ] **Step 5: Commit** — `feat(web): briefing reader with acknowledgement and the assignment route`

---

### Task 4: Quiz player

**Files:**
- Create: `apps/web/src/components/learning/QuizPlayer.tsx` (replace placeholder)
- Test: `apps/web/test/learning/QuizPlayer.test.tsx`

**Interfaces:**
- Consumes: `useStartAttempt`, `useSubmitAttempt`, `PlayerItem`, `AttemptResult` types.
- Produces: `QuizPlayer({ item: PlayerItem })`.

- [ ] **Step 1: Write the failing test**
```tsx
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { QuizPlayer } from '../../src/components/learning/QuizPlayer.js';
import { learningState, sampleQuizPlayer, Q1, Q2 } from '../msw/learning-handlers.js';

describe('<QuizPlayer>', () => {
  it('walks one question per screen with number keys, submits, and shows the review on a pass', async () => {
    renderWithProviders(<QuizPlayer item={sampleQuizPlayer()} />);
    await userEvent.click(screen.getByRole('button', { name: 'התחל שאלון' }));
    await waitFor(() => expect(learningState.attempts).toHaveLength(1));
    expect(await screen.findByText('שאלה 1 מתוך 2')).toBeInTheDocument();
    const q1 = screen.getByRole('group', { name: /הצעד הראשון/ });
    await userEvent.keyboard('2'); // option b via the number keys
    expect(within(q1).getByRole('radio', { name: /בדיקת כיסוי במיקום/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'הבא' }));
    expect(await screen.findByText('שאלה 2 מתוך 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /תוצאת Speedtest/ }));
    await userEvent.click(screen.getByRole('button', { name: 'שלח תשובות' }));
    expect(await screen.findByText('עברת! ציון 100')).toBeInTheDocument();
    expect(learningState.attempts[0].answers).toEqual({
      answers: [
        { questionId: Q1, optionIds: ['b'] },
        { questionId: Q2, optionIds: ['a'] },
      ],
    });
    // Review screen: every question with its explanation.
    expect(screen.getAllByText(/הסבר:/)).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'חזרה ללמידה שלי' })).toBeInTheDocument();
  });
  it('offers an unlimited retry after a fail', async () => {
    learningState.nextResultPassed = false;
    renderWithProviders(<QuizPlayer item={sampleQuizPlayer()} />);
    await userEvent.click(screen.getByRole('button', { name: 'התחל שאלון' }));
    await screen.findByText('שאלה 1 מתוך 2');
    await userEvent.keyboard('1');
    await userEvent.click(screen.getByRole('button', { name: 'הבא' }));
    await userEvent.keyboard('2');
    await userEvent.click(screen.getByRole('button', { name: 'שלח תשובות' }));
    expect(await screen.findByText('לא עברת הפעם. ציון 50 (ציון עובר 80)')).toBeInTheDocument();
    expect(screen.getByText('ניתן לנסות שוב ללא הגבלה')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'נסה שוב' }));
    expect(await screen.findByText('שאלה 1 מתוך 2')).toBeInTheDocument();
    expect(learningState.attempts).toHaveLength(2);
  });
  it('shows attempts left when the quiz has a cap', async () => {
    const item = sampleQuizPlayer();
    item.item.maxAttempts = 3;
    item.assignment.maxAttempts = 3;
    item.assignment.attemptsUsed = 2;
    renderWithProviders(<QuizPlayer item={item} />);
    expect(screen.getByText('נותר ניסיון אחד')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`apps/web/src/components/learning/QuizPlayer.tsx`:
```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AttemptResult, PlayerItem } from '@wecom/shared';
import { useStartAttempt, useSubmitAttempt } from '../../api/hooks/learning.js';
import { Button, LoadError } from '../ui/index.js';

type Phase = { name: 'intro' } | { name: 'question'; attemptId: string; i: number } | { name: 'result'; result: AttemptResult };

const attemptsLeftLabel = (left: number | null): string =>
  left === null ? 'ניתן לנסות שוב ללא הגבלה' : left === 1 ? 'נותר ניסיון אחד' : left <= 0 ? 'לא נותרו ניסיונות' : `נותרו ${left} ניסיונות`;

/** Spec §5: one question per screen, keys 1–4, review with explanations, pass/fail, retry. */
export function QuizPlayer({ item }: { item: PlayerItem }) {
  const questions = item.questions;
  const [phase, setPhase] = useState<Phase>({ name: 'intro' });
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const start = useStartAttempt(item.assignment.id);
  const submit = useSubmitAttempt();
  const box = useRef<HTMLDivElement>(null);

  const initialLeft =
    item.assignment.maxAttempts === null ? null : Math.max(0, item.assignment.maxAttempts - item.assignment.attemptsUsed);

  const begin = () =>
    start.mutate(undefined, {
      onSuccess: (attemptId) => {
        setPicked({});
        setPhase({ name: 'question', attemptId, i: 0 });
      },
    });

  const choose = useCallback(
    (qId: string, optId: string, multi: boolean) =>
      setPicked((p) => {
        const cur = p[qId] ?? [];
        if (!multi) return { ...p, [qId]: [optId] };
        return { ...p, [qId]: cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId] };
      }),
    [],
  );

  // Number keys pick an option; Enter advances. A container handler rather than the global
  // registry: the player is a focused, modal-like view and does not need a hotkey scope.
  useEffect(() => {
    if (phase.name === 'question') box.current?.focus();
  }, [phase]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (phase.name !== 'question') return;
    const q = questions[phase.i];
    const n = Number(e.key);
    if (n >= 1 && n <= Math.min(4, q.options.length)) {
      choose(q.id!, q.options[n - 1].id, q.kind === 'multi');
      e.preventDefault();
    } else if (e.key === 'Enter' && (picked[q.id!]?.length ?? 0) > 0) {
      next(phase);
      e.preventDefault();
    }
  };

  const next = (p: Extract<Phase, { name: 'question' }>) => {
    if (p.i + 1 < questions.length) return setPhase({ ...p, i: p.i + 1 });
    submit.mutate(
      { attemptId: p.attemptId, answers: { answers: questions.map((q) => ({ questionId: q.id!, optionIds: picked[q.id!] ?? [] })) } },
      { onSuccess: (result) => setPhase({ name: 'result', result }) },
    );
  };

  if (phase.name === 'intro')
    return (
      <div className="quiz quiz-intro">
        {item.item.description ? <p>{item.item.description}</p> : null}
        <p>
          {questions.length} שאלות · ציון עובר {item.item.passMark ?? item.assignment.passMark ?? 80}
          {item.item.estimatedMinutes ? ` · כ-${item.item.estimatedMinutes} דק׳` : ''}
        </p>
        <p className="muted">{attemptsLeftLabel(initialLeft)}</p>
        {start.isError ? <LoadError what="פתיחת הניסיון" error={start.error} /> : null}
        <Button onClick={begin} disabled={start.isPending || initialLeft === 0}>
          {item.assignment.attemptsUsed ? 'נסה שוב' : 'התחל שאלון'}
        </Button>
      </div>
    );

  if (phase.name === 'question') {
    const q = questions[phase.i];
    const sel = picked[q.id!] ?? [];
    const multi = q.kind === 'multi';
    return (
      <div className="quiz" ref={box} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="quiz-progress">שאלה {phase.i + 1} מתוך {questions.length}</div>
        <fieldset className="quiz-q" role="group" aria-label={q.stem}>
          <legend>{q.stem}</legend>
          {q.options.map((o, i) => (
            <label key={o.id} className={'quiz-opt' + (sel.includes(o.id) ? ' on' : '')}>
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={q.id}
                checked={sel.includes(o.id)}
                onChange={() => choose(q.id!, o.id, multi)}
              />
              <kbd>{i + 1}</kbd> {o.text}
            </label>
          ))}
        </fieldset>
        {submit.isError ? <LoadError what="שליחת התשובות" error={submit.error} /> : null}
        <div className="quiz-nav">
          <Button onClick={() => next(phase)} disabled={!sel.length || submit.isPending}>
            {phase.i + 1 < questions.length ? 'הבא' : 'שלח תשובות'}
          </Button>
        </div>
      </div>
    );
  }

  const r = phase.result;
  const passMark = item.item.passMark ?? item.assignment.passMark ?? 80;
  return (
    <div className="quiz quiz-result">
      <h2>{r.passed ? `עברת! ציון ${r.score}` : `לא עברת הפעם. ציון ${r.score} (ציון עובר ${passMark})`}</h2>
      {!r.passed ? <p className="muted">{attemptsLeftLabel(r.attemptsLeft)}</p> : null}
      <ol className="quiz-review">
        {questions.map((q) => {
          const pq = r.perQuestion.find((x) => x.questionId === q.id);
          return (
            <li key={q.id} className={pq?.correct ? 'ok' : 'bad'}>
              <b>{q.stem}</b>
              <div>
                תשובה נכונה: {q.options.filter((o) => pq?.correctOptionIds.includes(o.id)).map((o) => o.text).join(', ')}
              </div>
              {pq?.explanation ? <div className="muted">הסבר: {pq.explanation}</div> : null}
            </li>
          );
        })}
      </ol>
      <div className="quiz-nav">
        {!r.passed && (r.attemptsLeft === null || r.attemptsLeft > 0) ? <Button onClick={begin}>נסה שוב</Button> : null}
        <Link to="/learning" className="btn">חזרה ללמידה שלי</Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run** — player tests PASS (3); reader tests still PASS; build green.
- [ ] **Step 5: Commit** — `feat(web): quiz player — number keys, review screen, pass/fail, unlimited retry`

---

### Task 5: Article banners, notification kinds, SSE invalidation

**Files:**
- Create: `apps/web/src/components/learning/RefreshBanner.tsx`, `apps/web/src/components/learning/LearningBadge.tsx`
- Modify: `apps/web/src/components/notifications/NotificationList.tsx` (TABS, ICON), `apps/web/src/api/events.ts`
- Test: `apps/web/test/learning/ArticleLearning.test.tsx`

**Interfaces:**
- Consumes: `useDocumentLearning`, `useCan`, `useMyLearning`.
- Produces: `RefreshBanner({ documentId })` — renders "רענון ידע נדרש" with a link to the matching open refresh assignment when `refreshRequired`; `LearningBadge({ documentId })` — chip "כלול ב-N פריטי למידה" for editors; both return `null` when there is nothing to show or the user lacks `learning.read`.

- [ ] **Step 1: Write the failing test**
```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { RefreshBanner } from '../../src/components/learning/RefreshBanner.js';
import { LearningBadge } from '../../src/components/learning/LearningBadge.js';
import { learningState, sampleAssignment } from '../msw/learning-handlers.js';
import { fx } from '../msw/fixtures.js';

describe('article learning banners', () => {
  it('renders nothing when no refresh is required', async () => {
    const r = renderWithProviders(<RefreshBanner documentId={fx.docBrowsing.id} />);
    await new Promise((res) => setTimeout(res, 50));
    expect(r.container).toBeEmptyDOMElement();
  });
  it('shows the refresh banner linking to the open refresh assignment', async () => {
    learningState.docLearning = {
      items: [],
      refreshRequired: true,
      lastSignificantChange: { version: 9, at: '2026-09-15T08:00:00.000Z', reasons: ['שינוי בהסתעפות'] },
    };
    learningState.my.open.push(sampleAssignment({ id: 'a0000000-0000-4000-8000-000000000009', reason: 'refresh', title: 'תדריך: איטיות גלישה (רענון)' }));
    renderWithProviders(<RefreshBanner documentId={fx.docBrowsing.id} />);
    expect(await screen.findByText(/רענון ידע נדרש/)).toBeInTheDocument();
    expect(screen.getByText(/שינוי בהסתעפות/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'למטלת הרענון' })).toHaveAttribute('href', '/learning/a0000000-0000-4000-8000-000000000009');
  });
  it('shows how many learning items include the document', async () => {
    learningState.docLearning.items = [
      { id: 'b0000000-0000-4000-8000-000000000001', kind: 'briefing', title: 't', description: '', worldSlug: 'tech', status: 'published', currentVersion: 1, estimatedMinutes: null, needsUpdate: false, updatedAt: '2026-09-15T08:00:00.000Z', publishedAt: null, entryCount: 1, questionCount: 0, assignedUsers: 3, completionRate: 0.5 },
    ];
    renderWithProviders(<LearningBadge documentId={fx.docBrowsing.id} />);
    expect(await screen.findByText('כלול בפריט למידה אחד')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`RefreshBanner.tsx`:
```tsx
import { Link } from 'react-router-dom';
import { useDocumentLearning, useMyLearning } from '../../api/hooks/learning.js';
import { useCan } from '../../api/hooks/me.js';

/** Spec §5 refresh: shown on the article for the affected user until the refresh assignment is done. */
export function RefreshBanner({ documentId }: { documentId: string }) {
  const can = useCan();
  const mayRead = can('learning.read');
  const dl = useDocumentLearning(documentId, mayRead);
  const my = useMyLearning(mayRead && !!dl.data?.refreshRequired);
  if (!dl.data?.refreshRequired) return null;
  const target = [...(my.data?.overdue ?? []), ...(my.data?.open ?? [])].find((a) => a.reason === 'refresh');
  const reasons = dl.data.lastSignificantChange?.reasons ?? [];
  return (
    <div className="banner banner-amber learning-refresh" role="status">
      <b>רענון ידע נדרש</b>
      {reasons.length ? <span> · {reasons.join(', ')}</span> : null}
      {target ? (
        <Link to={`/learning/${target.id}`} className="btn btn-sm">
          למטלת הרענון
        </Link>
      ) : null}
    </div>
  );
}
```
`LearningBadge.tsx`:
```tsx
import { Link } from 'react-router-dom';
import { useDocumentLearning } from '../../api/hooks/learning.js';
import { useCan } from '../../api/hooks/me.js';

/** Editor-facing chip: how many published briefings/quizzes reference this document. */
export function LearningBadge({ documentId }: { documentId: string }) {
  const can = useCan();
  const dl = useDocumentLearning(documentId, can('learning.manage'));
  const n = dl.data?.items.length ?? 0;
  if (!n) return null;
  const label = n === 1 ? 'כלול בפריט למידה אחד' : `כלול ב-${n} פריטי למידה`;
  return (
    <Link to={`/learning/manage?documentId=${documentId}`} className="chip chip-blue" title="פריטי למידה המפנים למסמך">
      {label}
    </Link>
  );
}
```
`NotificationList.tsx` — append to `TABS`: `['learning', 'למידה'], ['gap', 'פערי ידע']` and to `ICON`: `learning: '🎓', gap: '🧭'`.

`apps/web/src/api/events.ts` — add before the final `}` of `invalidate`:
```ts
  } else if (ev.name.startsWith('learning.')) {
    // Every learning key starts with 'learning' — my assignments, the player, per-document state.
    void qc.invalidateQueries({ queryKey: ['learning'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    const docId = (ev.payload as { documentId?: string }).documentId;
    if (docId) void qc.invalidateQueries({ queryKey: keys.doc(docId) });
  } else if (ev.name === 'gap.detected') {
    void qc.invalidateQueries({ queryKey: ['gaps'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
```
(If `invalidate`'s structure is `if … else if` as shown at `events.ts:72-110`, splice these as further `else if` arms; keep the `taxonomy.changed` arm last if it is the last one today — order is irrelevant, names are disjoint.)

- [ ] **Step 4: Run** — `test/learning/ArticleLearning.test.tsx` PASS (3); `test/api/events.test.tsx` still green; build green (the `ICON` record must now be exhaustive over the widened kinds).
- [ ] **Step 5: Commit** — `feat(web): refresh banner, learning badge, notification kinds and SSE invalidation for wave 5`

---

### Task 6: Lane gate and report

**Files:**
- Create: `.superpowers/sdd/program/V4a-report.md` (git-ignored)

- [ ] **Step 1: Gate** — `pnpm --filter @wecom/web build`; `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4` (only pre-existing flakes, re-run in isolation); `pnpm lint`; `pnpm exec prettier --check apps/web`.
- [ ] **Step 2: Report** — per task status and commits, test counts, deviations, and the **mount points for V6**:
  - `Sidebar.tsx`: `item('הלמידה שלי', '/learning', openLearning || null, true)` gated on `can('learning.read')`, with the open+overdue count from `useMyLearning(mayLearn)`; place before the "משוב" entry.
  - `ArticlePage.tsx`: `<RefreshBanner documentId={doc.id} />` directly under the `SourceReviewBadge` strip (line ~462); `<LearningBadge documentId={doc.id} />` in the `doc-head` chip row next to `StatusChip` (line ~405).
  - `NotificationBell.tsx`: nothing — it renders `NotificationList`, which now knows the two kinds.
  - Transport swap: every `// V6: api.*` marker in `api/hooks/learning.ts` once `openapi.json` carries the V2 routes; then delete `learningRequest`.
- [ ] **Step 3: Final commit** if the report step changed tracked files (it should not).

## Self-review

- Spec coverage: §5 reader (intro, entries via the article renderer, per-entry note, changed banner, acknowledgement) — Task 3; §5 player (one question per screen, keys 1–4, review with explanations, pass/fail, retry; unlimited retakes per §1.4 with the capped variant still rendered) — Task 4; §5 refresh banner on the article and notifications kind `learning` — Task 5; `/learning` listing open/overdue/completed/invalidated — Task 2; `GET /documents/:id/learning` consumer — Task 5.
- Placeholders: none; the two temporary placeholder components are replaced by the tasks that follow them and named as such.
- Type consistency: `usePlayerItem` returns `PlayerItem`; `QuizPlayer`/`BriefingReader` take `{ item: PlayerItem }`; `useSubmitAttempt` takes `{ attemptId, answers: AttemptAnswers }` matching `AttemptAnswersSchema`; keys are `keys.learning.{my,player,doc}` everywhere; MSW state names match between handlers and tests.
- Out of scope, noted for V6/V4b: `LearningBadge` links to `/learning/manage?documentId=` — V4b owns that route and should honour the query param.
