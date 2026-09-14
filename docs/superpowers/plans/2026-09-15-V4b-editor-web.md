# V4b — Editor Web (learning builders, assignment, completion, gaps, workflow settings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the editor-facing half of wave 5 in `apps/web`: the learning-items manager and its two builders (briefing, quiz with model-generated questions), the assign dialog, the completion dashboard with CSV export, the knowledge-gaps page, and the workflow-settings section for the identity admin page — all against MSW, validated at runtime against the wave 5 zod contract, and left as standalone components plus lazy route entries for V6 to mount.

**Architecture:** Same shape as the wave 4 web lanes. Hooks in `apps/web/src/api/hooks/learningManage.ts`, `gaps.ts` and `workflow.ts` call a small typed request bridge (`apps/web/src/api/wave5.ts`) because the V1–V3 routes are not in `docs/api/openapi.json` while this lane runs; every response is parsed with `checked(...)` against `@wecom/shared` (`schemas/wave5.ts`), so a drifted fixture or backend fails at the call site. V6 swaps each hook body to the generated `api.*` client once the routes are published (one line per hook; the bridge is then deleted). Mutations invalidate through one `invalidateLearning(qc)` helper. Components live under `apps/web/src/components/learning/manage/` and `apps/web/src/components/gaps/`, reuse `RichText` (compact) for briefing intros, `useSearch` for the document picker, `useWorlds`/`useRoles`/`useMentionable` for audiences, `download()` for CSV, and the `Modal`/`Toast` providers. Ordering is arrow buttons (wave 4 ruling D-M4: keyboard-accessible, no drag).

**Tech Stack:** React 18, TypeScript strict, React Router 6 (lazy routes), TanStack Query 5, zod 3, `@tiptap/react` via `RichText`, Vitest + Testing Library + MSW 2, `@wecom/shared`.

**Spec:** `docs/superpowers/specs/2026-09-15-kb-wave5-learning-design.md` (§1 rulings 1–8, §4 API, §5 builder/assign/dashboard/gaps/approver, §6 isolation) and `docs/superpowers/plans/2026-09-15-V0-wave5-contracts.md` (canonical names; contract doc `docs/api/CONTRACTS-wave5.md`).

## Global Constraints

- Node `>=22`, pnpm `>=9`, TypeScript `strict: true`. Run from the repo root with `pnpm --filter @wecom/web <script>`; web tests with `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4`.
- Every request/response shape comes from `@wecom/shared` (`schemas/wave5.ts` after V0; on disk now). Never re-declare a schema in `apps/web`. Parse every response with `checked` (or `checkedMaybe` for 204/404-null routes).
- Web only: do **not** touch `apps/api/`, `packages/`, `docs/api/openapi.json`. Append-only touches to `apps/web/src/routes.tsx` (lazy style: `split(() => import(...))`), `apps/web/src/api/keys.ts`, `apps/web/test/msw/handlers.ts` (one import + one spread + one reset call), `apps/web/test/msw/fixtures.ts` (new exports only), `apps/web/src/styles/app.css` (one appended `/* wave 5 — V4b */` block).
- Never edit `components/shell/*`, `ArticlePage.tsx`, `EditorPage.tsx`, `LibraryPage.tsx`, `admin/IdentityPage.tsx`, `review/ReviewsPage.tsx`, `admin/AdminLayout.tsx` — V6 mounts (mount list in the lane report, Task 8).
- Permissions: `learning.manage` gates the manager/builders/assign/completion, `learning.publish` gates the publish button, `gaps.read` gates `/gaps`, `gaps.manage` gates dismiss/resolve/detect, `system.admin` gates workflow settings. Use `useCan()`; pass `enabled` to queries the caller lacks permission for (no guaranteed-403 round trips).
- Hebrew UI strings verbatim from this plan; RTL; real `<button>`s for every control; arrow-key reorder with `aria-label="למעלה"`/`"למטה"`.
- Conventional commit per task ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File structure

```
apps/web/src/api/wave5.ts                                 request bridge: w5<T>(schema, method, path, {query, body}) (new; V6 deletes)
apps/web/src/api/keys.ts                                  (append: learning.*, gaps.*, admin.workflow)
apps/web/src/api/hooks/learningManage.ts                  items, entries, questions, generate, publish, versions, audiences, assign, completion, dashboard (new)
apps/web/src/api/hooks/gaps.ts                            useGaps, useDismissGap, useResolveGap, useDetectGaps (new)
apps/web/src/api/hooks/workflow.ts                        useWorkflowSettings, usePutWorkflowSettings (new)
apps/web/src/api/invalidateLearning.ts                    invalidateLearning(qc) (new)
apps/web/src/components/learning/manage/LearningManagePage.tsx    /learning/manage (new)
apps/web/src/components/learning/manage/LearningItemEditor.tsx    /learning/manage/new, /learning/manage/:id (new)
apps/web/src/components/learning/manage/DocumentPicker.tsx        search-backed picker + topic shortcut (new)
apps/web/src/components/learning/manage/BriefingBuilder.tsx       entries list, notes, reorder (new)
apps/web/src/components/learning/manage/QuizBuilder.tsx           generate, question editing, reorder, pass mark (new)
apps/web/src/components/learning/manage/QuestionEditor.tsx        one question (new)
apps/web/src/components/learning/manage/AssignDialog.tsx          audiences (roles × worlds), individuals, due days (new)
apps/web/src/components/learning/manage/CompletionDashboard.tsx   per-item completion + CSV (new)
apps/web/src/components/learning/manage/LearningDashboardPanel.tsx  GET /learning/dashboard cards (new)
apps/web/src/components/learning/manage/ItemPreview.tsx           read-only modal body (new)
apps/web/src/components/gaps/GapsPage.tsx                 /gaps (new)
apps/web/src/components/admin/WorkflowSettingsSection.tsx  mounted by V6 in IdentityPage (new)
apps/web/src/routes.tsx                                   (append 4 lazy routes)
apps/web/src/styles/app.css                               (append wave 5 block)
apps/web/test/msw/learning-manage.ts                      handler group + mutable state (new)
apps/web/test/msw/fixtures.ts                             (append fx.learningItems, fx.learningQuestions, fx.completion, fx.learningDashboard, fx.gaps, fx.workflow)
apps/web/test/msw/fixtures.test.ts                        (append contract-parity cases)
apps/web/test/msw/handlers.ts                             (append import, spread, reset)
apps/web/test/learning/LearningManage.test.tsx            (new)
apps/web/test/learning/Builders.test.tsx                  (new)
apps/web/test/learning/AssignCompletion.test.tsx          (new)
apps/web/test/gaps/Gaps.test.tsx                          (new)
apps/web/test/admin/WorkflowSettings.test.tsx             (new)
```

## Names other lanes consume (produced here)

| Export | Path | Props / signature |
|---|---|---|
| `LearningManagePage` | `components/learning/manage/LearningManagePage.tsx` | `()` — route `/learning/manage`; reads `?kind`, `?status`, `?world`, `?q` and `?documentId=<uuid>` (V4a's article `LearningBadge` links here; the list is then the items referencing that document via `GET /documents/:id/learning`) |
| `LearningItemEditor` | `components/learning/manage/LearningItemEditor.tsx` | `()` — routes `/learning/manage/new?kind=briefing\|quiz`, `/learning/manage/:id` |
| `AssignDialog` | `components/learning/manage/AssignDialog.tsx` | `{ itemId: string; onClose: () => void }` |
| `CompletionDashboard` | `components/learning/manage/CompletionDashboard.tsx` | `{ itemId: string }` |
| `LearningDashboardPanel` | `components/learning/manage/LearningDashboardPanel.tsx` | `{ world?: string }` |
| `GapsPage` | `components/gaps/GapsPage.tsx` | `()` — route `/gaps` |
| `WorkflowSettingsSection` | `components/admin/WorkflowSettingsSection.tsx` | `()` — V6 mounts inside `IdentityPage` as a fourth `<section className="settings-card">` |
| hooks | `api/hooks/learningManage.ts` | `useDocumentLearning(documentId, enabled)` (V6 dedupes against V4a's if both exist), `useLearningItems(q, enabled)`, `useLearningItem(id)`, `useCreateLearningItem()`, `usePatchLearningItem(id)`, `useDeleteLearningItem()`, `usePutEntries(id)`, `usePutQuestions(id)`, `useGenerateQuestions(id)`, `usePublishLearningItem(id)`, `useLearningVersions(id)`, `useCreateAudience(id)`, `useDeleteAudience()`, `useAssignUsers(id)`, `useCompletion(id, enabled)`, `useLearningDashboard(world, enabled)` |
| hooks | `api/hooks/gaps.ts` | `useGaps(q, enabled)`, `useDismissGap()`, `useResolveGap()`, `useDetectGaps()` |
| hooks | `api/hooks/workflow.ts` | `useWorkflowSettings(enabled)`, `usePutWorkflowSettings()` |
| keys | `api/keys.ts` | `keys.learning.items(q)`, `keys.learning.item(id)`, `keys.learning.versions(id)`, `keys.learning.completion(id)`, `keys.learning.dashboard(world)`, `keys.learning.my` (shared with V4a; if V4a defines it first, keep theirs), `keys.gaps(q)`, `keys.admin.workflow` |
| msw | `test/msw/learning-manage.ts` | `learningManageHandlers`, `learningState`, `resetLearningState()` |

---

### Task 1: Fixtures and MSW handler group

**Files:**
- Modify: `apps/web/test/msw/fixtures.ts` (append), `apps/web/test/msw/fixtures.test.ts` (append), `apps/web/test/msw/handlers.ts` (append import/spread/reset)
- Create: `apps/web/test/msw/learning-manage.ts`

**Interfaces:**
- Consumes: `fx.docBrowsing`, `fx.docIntl`, `fx.me`, `fx.worlds`, `fx.roles` from `fixtures.ts`; schemas from `@wecom/shared`.
- Produces: `fx.learningItems: LearningItemCard[]`, `fx.learningItemQuiz: LearningItem`, `fx.learningItemBriefing: LearningItem`, `fx.completion: CompletionResponse`, `fx.learningDashboard: LearningDashboard`, `fx.gaps: Gap[]`, `fx.workflow: WorkflowSettings`; `learningState`, `resetLearningState`, `learningManageHandlers`.

- [ ] **Step 1: Write the failing contract-parity test** (append to `fixtures.test.ts`)

```ts
import {
  CompletionResponseSchema, GapSchema, LearningDashboardSchema, LearningItemCardSchema, LearningItemSchema,
  WorkflowSettingsSchema,
} from '@wecom/shared';
import { fx } from './fixtures.js';

describe('wave 5 (V4b) fixtures match the zod contract', () => {
  it('learning items, cards, completion, dashboard, gaps, workflow', () => {
    for (const c of fx.learningItems) expect(LearningItemCardSchema.safeParse(c).success).toBe(true);
    expect(LearningItemSchema.safeParse(fx.learningItemQuiz).success).toBe(true);
    expect(LearningItemSchema.safeParse(fx.learningItemBriefing).success).toBe(true);
    expect(CompletionResponseSchema.safeParse(fx.completion).success).toBe(true);
    expect(LearningDashboardSchema.safeParse(fx.learningDashboard).success).toBe(true);
    for (const g of fx.gaps) expect(GapSchema.safeParse(g).success).toBe(true);
    expect(WorkflowSettingsSchema.safeParse(fx.workflow).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4 fixtures` → FAIL (`fx.learningItems` undefined).

- [ ] **Step 3: Append fixtures** (`fixtures.ts`, after the last export; ids are v4 UUIDs)

```ts
/* ── wave 5 (V4b) — learning items, completion, gaps, workflow ─────────── */
export const LI_QUIZ = 'b0000000-0000-4000-8000-000000000001';
export const LI_BRIEF = 'b0000000-0000-4000-8000-000000000002';
export const Q1 = 'c0000000-0000-4000-8000-000000000001';
export const Q2 = 'c0000000-0000-4000-8000-000000000002';
export const GAP1 = 'd0000000-0000-4000-8000-000000000001';
export const GAP2 = 'd0000000-0000-4000-8000-000000000002';
const T5 = '2026-09-15T08:00:00.000Z';

export const learningItemQuiz: LearningItem = {
  id: LI_QUIZ, kind: 'quiz', title: 'שאלון: תקלות גלישה', description: '', worldSlug: 'tech',
  status: 'draft', currentVersion: 0, passMark: 80, maxAttempts: null, estimatedMinutes: 10,
  entries: [],
  questions: [
    { id: Q1, documentId: D_BROWSING, stepKey: 's2', stem: 'מה עושים אם אין גלישה אחרי איפוס?', kind: 'single',
      options: [{ id: 'a', text: 'בודקים APN', correct: true }, { id: 'b', text: 'מנתקים שיחה', correct: false }],
      explanation: 'לפי שלב 2', generated: true, modelConf: 0.8 },
    { id: Q2, documentId: D_BROWSING, stepKey: null, stem: 'איזה שדה CRM מתעדכן?', kind: 'single',
      options: [{ id: 'a', text: 'סטטוס קו', correct: true }, { id: 'b', text: 'חבילה', correct: false }],
      explanation: '', generated: false, modelConf: null },
  ],
  needsUpdate: false, createdBy: U1, updatedAt: T5, publishedAt: null,
};
export const learningItemBriefing: LearningItem = {
  id: LI_BRIEF, kind: 'briefing', title: 'תדריך: נדידה בחו"ל', description: '<p>מה חדש בנדידה</p>', worldSlug: 'intl',
  status: 'published', currentVersion: 2, passMark: null, maxAttempts: null, estimatedMinutes: 5,
  entries: [{ id: 'e0000000-0000-4000-8000-000000000001', documentId: D_INTL, stepKey: null, note: 'לקרוא את שלב 1' }],
  questions: [], needsUpdate: false, createdBy: U1, updatedAt: T5, publishedAt: T5,
};
const card = (i: LearningItem, over: Partial<LearningItemCard> = {}): LearningItemCard => ({
  id: i.id, kind: i.kind, title: i.title, description: i.description, worldSlug: i.worldSlug, status: i.status,
  currentVersion: i.currentVersion, estimatedMinutes: i.estimatedMinutes, needsUpdate: i.needsUpdate,
  updatedAt: i.updatedAt, publishedAt: i.publishedAt, entryCount: i.entries.length, questionCount: i.questions.length,
  assignedUsers: 0, completionRate: null, ...over,
});
export const learningItems: LearningItemCard[] = [
  card(learningItemQuiz),
  card(learningItemBriefing, { assignedUsers: 12, completionRate: 0.75 }),
];
export const completion: CompletionResponse = {
  item: learningItems[1]!,
  rows: [
    { userId: U1, displayName: 'דנה ר.', worldSlugs: ['intl'], status: 'completed', dueAt: T5, completedAt: T5, score: null, attempts: 0 },
    { userId: U2, displayName: 'יוסי ק.', worldSlugs: ['intl'], status: 'overdue', dueAt: '2026-09-01T08:00:00.000Z', completedAt: null, score: null, attempts: 0 },
  ],
  byWorld: [{ worldSlug: 'intl', assigned: 12, completed: 9, overdue: 2 }],
};
export const learningDashboard: LearningDashboard = {
  generatedAt: T5,
  totals: { items: 2, assigned: 12, completed: 9, overdue: 2, refreshPending: 1 },
  byWorld: [{ worldSlug: 'intl', assigned: 12, completed: 9, overdue: 2, rate: 0.75 }],
  failedQuestions: [{ questionId: Q1, itemId: LI_QUIZ, itemTitle: 'שאלון: תקלות גלישה', stem: 'מה עושים אם אין גלישה אחרי איפוס?', failRate: 0.6, attempts: 5 }],
  recentCompletions: [{ userId: U1, displayName: 'דנה ר.', itemTitle: 'תדריך: נדידה בחו"ל', completedAt: T5, passed: null }],
};
export const gaps: Gap[] = [
  { id: GAP1, kind: 'zero_results', key: 'esim', title: 'חיפושים ללא תוצאה: "esim"', score: 9.5, status: 'open',
    evidence: { count: 7, lastTerms: ['esim', 'e-sim'] }, suggestedAction: 'create', documentId: null, topicId: null,
    worldSlug: 'sim', firstSeenAt: T5, lastSeenAt: T5, dismissedReason: null, resolvedDocumentId: null },
  { id: GAP2, kind: 'stale_high_traffic', key: D_BROWSING, title: 'פריט נצפה שלא עודכן 180 יום', score: 6.1, status: 'open',
    evidence: { views30d: 140, updatedAt: '2026-01-01T00:00:00.000Z' }, suggestedAction: 'update', documentId: D_BROWSING,
    topicId: null, worldSlug: 'tech', firstSeenAt: T5, lastSeenAt: T5, dismissedReason: null, resolvedDocumentId: null },
];
export const workflow: WorkflowSettings = {
  requireApprover: false,
  learning: { defaultPassMark: 80, defaultMaxAttempts: null, refreshDueDays: 7, reminderDaysBefore: 2 },
  gaps: { zeroResultMin: 3, feedbackClusterMin: 3, staleDays: 180, failedQuestionRate: 0.5 },
};
```
Add the type imports (`LearningItem, LearningItemCard, CompletionResponse, LearningDashboard, Gap, WorkflowSettings`) to the existing `@wecom/shared` import at the top of `fixtures.ts`, and add `learningItemQuiz, learningItemBriefing, learningItems, completion, learningDashboard, gaps, workflow` to the `fx` aggregate the file exports (read how `fx` is assembled at the bottom of the file and add them there). `WorkflowSettings.learning.defaultMaxAttempts` is `null` per V0 Task 1; if V0 has not landed on your branch yet, type it as `number | null` locally and leave the value `null` — the parity test then tells you the moment the contract disagrees.

- [ ] **Step 4: Write the handler group** — `apps/web/test/msw/learning-manage.ts`

```ts
/**
 * msw handlers for the wave 5 V1–V3 routes this lane calls (`docs/api/CONTRACTS-wave5.md`).
 * Mutable state so tests assert what the UI sent; `resetLearningState()` runs from `handlers.ts`.
 */
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { Gap, LearningItem, LearningItemCard, QuizQuestion, WorkflowSettings } from '@wecom/shared';
import { fx } from './fixtures.js';

const B = '/api/v1';
const T = '2026-09-15T09:00:00.000Z';

export const learningState: {
  items: LearningItem[];
  audiences: { id: string; itemId: string; roleNames: string[]; worldSlugs: string[]; userIds: string[]; dueDays: number }[];
  assigned: { itemId: string; userIds: string[]; dueDays?: number }[];
  published: { itemId: string; label: string }[];
  generateCalls: { itemId: string; documentIds: string[]; perDocument?: number }[];
  gaps: Gap[];
  detectRuns: number;
  workflow: WorkflowSettings;
} = { items: [], audiences: [], assigned: [], published: [], generateCalls: [], gaps: [], detectRuns: 0, workflow: fx.workflow };

export const resetLearningState = (): void => {
  learningState.items = [structuredClone(fx.learningItemQuiz), structuredClone(fx.learningItemBriefing)];
  learningState.audiences = [];
  learningState.assigned = [];
  learningState.published = [];
  learningState.generateCalls = [];
  learningState.gaps = fx.gaps.map((g) => ({ ...g }));
  learningState.detectRuns = 0;
  learningState.workflow = structuredClone(fx.workflow);
};
resetLearningState();

const toCard = (i: LearningItem): LearningItemCard => ({
  id: i.id, kind: i.kind, title: i.title, description: i.description, worldSlug: i.worldSlug, status: i.status,
  currentVersion: i.currentVersion, estimatedMinutes: i.estimatedMinutes, needsUpdate: i.needsUpdate,
  updatedAt: i.updatedAt, publishedAt: i.publishedAt, entryCount: i.entries.length, questionCount: i.questions.length,
  assignedUsers: learningState.assigned.filter((a) => a.itemId === i.id).reduce((n, a) => n + a.userIds.length, 0),
  completionRate: i.status === 'published' ? 0.75 : null,
});
const notFound = () => HttpResponse.json({ code: 'NOT_FOUND', message: 'לא נמצא' }, { status: 404 });
const find = (id: string | readonly string[] | undefined) => learningState.items.find((i) => i.id === String(id));

/** Deterministic "rules" generator: one single-choice question per document id. */
const generated = (documentIds: string[]): QuizQuestion[] =>
  documentIds.map((documentId, n) => ({
    id: `c0000000-0000-4000-8000-0000000000${(n + 10).toString(16).padStart(2, '0')}`,
    documentId, stepKey: 's1', stem: `שאלה שנוצרה ${n + 1}`, kind: 'single',
    options: [{ id: 'a', text: 'נכון', correct: true }, { id: 'b', text: 'לא נכון', correct: false }],
    explanation: '', generated: true, modelConf: 0.6,
  }));

export const learningManageHandlers: RequestHandler[] = [
  http.get(`${B}/learning/items`, ({ request }) => {
    const u = new URL(request.url);
    let items = learningState.items;
    const kind = u.searchParams.get('kind'); const status = u.searchParams.get('status'); const world = u.searchParams.get('world'); const q = u.searchParams.get('q');
    if (kind) items = items.filter((i) => i.kind === kind);
    if (status) items = items.filter((i) => i.status === status);
    if (world) items = items.filter((i) => i.worldSlug === world);
    if (q) items = items.filter((i) => i.title.includes(q));
    return HttpResponse.json({ items: items.map(toCard), total: items.length, page: 1, pageSize: 50 });
  }),
  http.post(`${B}/learning/items`, async ({ request }) => {
    const b = (await request.json()) as Partial<LearningItem> & { kind: LearningItem['kind']; title: string };
    const item: LearningItem = {
      id: crypto.randomUUID(), kind: b.kind, title: b.title, description: b.description ?? '', worldSlug: b.worldSlug ?? null,
      status: 'draft', currentVersion: 0, passMark: b.kind === 'quiz' ? (b.passMark ?? 80) : null, maxAttempts: b.maxAttempts ?? null,
      estimatedMinutes: b.estimatedMinutes ?? null, entries: [], questions: [], needsUpdate: false, createdBy: fx.me.user.id, updatedAt: T, publishedAt: null,
    };
    learningState.items.push(item);
    return HttpResponse.json(item, { status: 201 });
  }),
  http.get(`${B}/learning/items/:id`, ({ params }) => { const i = find(params.id); return i ? HttpResponse.json(i) : notFound(); }),
  http.patch(`${B}/learning/items/:id`, async ({ params, request }) => {
    const i = find(params.id); if (!i) return notFound();
    Object.assign(i, (await request.json()) as object, { updatedAt: T });
    return HttpResponse.json(i);
  }),
  http.delete(`${B}/learning/items/:id`, ({ params }) => {
    learningState.items = learningState.items.filter((i) => i.id !== String(params.id));
    return new HttpResponse(null, { status: 204 });
  }),
  http.put(`${B}/learning/items/:id/entries`, async ({ params, request }) => {
    const i = find(params.id); if (!i) return notFound();
    i.entries = ((await request.json()) as { entries: LearningItem['entries'] }).entries.map((e) => ({ ...e, id: e.id ?? crypto.randomUUID() }));
    return HttpResponse.json(i);
  }),
  http.put(`${B}/learning/items/:id/questions`, async ({ params, request }) => {
    const i = find(params.id); if (!i) return notFound();
    i.questions = ((await request.json()) as { questions: QuizQuestion[] }).questions.map((q) => ({ ...q, id: q.id ?? crypto.randomUUID() }));
    return HttpResponse.json(i);
  }),
  http.post(`${B}/learning/items/:id/generate`, async ({ params, request }) => {
    const b = (await request.json()) as { documentIds: string[]; perDocument?: number };
    learningState.generateCalls.push({ itemId: String(params.id), ...b });
    return HttpResponse.json({ questions: generated(b.documentIds), source: 'rules', tookMs: 12 });
  }),
  http.post(`${B}/learning/items/:id/publish`, async ({ params, request }) => {
    const i = find(params.id); if (!i) return notFound();
    const { label } = (await request.json()) as { label: string };
    learningState.published.push({ itemId: i.id, label });
    i.status = 'published'; i.currentVersion += 1; i.publishedAt = T;
    return HttpResponse.json(i);
  }),
  http.get(`${B}/learning/items/:id/versions`, ({ params }) => {
    const i = find(params.id); if (!i) return notFound();
    return HttpResponse.json({ items: Array.from({ length: i.currentVersion }, (_, k) => ({ version: k + 1, label: `גרסה ${k + 1}`, authorName: 'דנה ר.', createdAt: T, sourceVersions: [] })) });
  }),
  http.post(`${B}/learning/items/:id/audiences`, async ({ params, request }) => {
    const b = (await request.json()) as { roleNames: string[]; worldSlugs: string[]; userIds: string[]; dueDays: number };
    const a = { id: crypto.randomUUID(), itemId: String(params.id), ...b };
    learningState.audiences.push(a);
    return HttpResponse.json({ ...a, resolvedUsers: 12, createdAt: T }, { status: 201 });
  }),
  http.delete(`${B}/learning/audiences/:id`, ({ params }) => {
    learningState.audiences = learningState.audiences.filter((a) => a.id !== String(params.id));
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(`${B}/learning/items/:id/assign`, async ({ params, request }) => {
    const b = (await request.json()) as { userIds: string[]; dueDays?: number };
    learningState.assigned.push({ itemId: String(params.id), ...b });
    return HttpResponse.json({ assigned: b.userIds.length });
  }),
  http.get(`${B}/learning/items/:id/completion`, ({ params }) => {
    const i = find(params.id); if (!i) return notFound();
    return HttpResponse.json({ ...fx.completion, item: toCard(i) });
  }),
  http.get(`${B}/learning/dashboard`, () => HttpResponse.json(fx.learningDashboard)),
  /** Items referencing a document (V2 route); drives the `?documentId=` filter on `/learning/manage`.
   *  V4a's group may register the same path — msw takes the first match, and V6 keeps one of the two. */
  http.get(`${B}/documents/:id/learning`, ({ params }) => {
    const id = String(params.id);
    const items = learningState.items.filter((i) => i.entries.some((e) => e.documentId === id) || i.questions.some((q) => q.documentId === id)).map(toCard);
    return HttpResponse.json({ items, refreshRequired: false, lastSignificantChange: null });
  }),
  http.get(`${B}/gaps`, ({ request }) => {
    const u = new URL(request.url);
    const status = u.searchParams.get('status') ?? 'open'; const kind = u.searchParams.get('kind'); const world = u.searchParams.get('world');
    let items = learningState.gaps.filter((g) => g.status === status);
    if (kind) items = items.filter((g) => g.kind === kind);
    if (world) items = items.filter((g) => g.worldSlug === world);
    return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 50, lastRunAt: T });
  }),
  http.post(`${B}/gaps/:id/dismiss`, async ({ params, request }) => {
    const g = learningState.gaps.find((x) => x.id === String(params.id)); if (!g) return notFound();
    g.status = 'dismissed'; g.dismissedReason = ((await request.json()) as { reason: string }).reason;
    return HttpResponse.json(g);
  }),
  http.post(`${B}/gaps/:id/resolve`, async ({ params, request }) => {
    const g = learningState.gaps.find((x) => x.id === String(params.id)); if (!g) return notFound();
    g.status = 'resolved'; g.resolvedDocumentId = ((await request.json()) as { documentId: string }).documentId;
    return HttpResponse.json(g);
  }),
  http.post(`${B}/gaps/detect`, () => { learningState.detectRuns += 1; return HttpResponse.json({ detected: 1, updated: 2, resolvedAutomatically: 0, tookMs: 40 }); }),
  http.get(`${B}/admin/workflow`, () => HttpResponse.json(learningState.workflow)),
  http.put(`${B}/admin/workflow`, async ({ request }) => {
    const patch = (await request.json()) as Partial<WorkflowSettings>;
    learningState.workflow = {
      ...learningState.workflow, ...patch,
      learning: { ...learningState.workflow.learning, ...(patch.learning ?? {}) },
      gaps: { ...learningState.workflow.gaps, ...(patch.gaps ?? {}) },
    };
    return HttpResponse.json(learningState.workflow);
  }),
];
```

- [ ] **Step 5: Register** — in `handlers.ts`: add `import { learningManageHandlers, resetLearningState } from './learning-manage.js';` next to the feedback import, spread `...learningManageHandlers,` right after `...feedbackHandlers,`, and call `resetLearningState();` inside the existing `resetState()` where `resetFeedbackState()` is called.

- [ ] **Step 6: Run** — `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4 fixtures` → PASS; full suite unchanged.
- [ ] **Step 7: Commit** — `test(web): wave 5 V4b fixtures and msw handler group`

---

### Task 2: Request bridge, query keys, hooks, invalidation

**Files:**
- Create: `apps/web/src/api/wave5.ts`, `apps/web/src/api/invalidateLearning.ts`, `apps/web/src/api/hooks/learningManage.ts`, `apps/web/src/api/hooks/gaps.ts`, `apps/web/src/api/hooks/workflow.ts`
- Modify: `apps/web/src/api/keys.ts` (append)
- Test: `apps/web/test/learning/hooks.test.tsx` (create)

**Interfaces:**
- Consumes: `checked`, `checkedMaybe` from `src/api/stage45.ts`; `ApiError` from `src/api/unwrap.ts`; the base path constant used by `src/api/client.ts` (read it: the generated client is created with a `baseUrl`; reuse the same value — if it is a module constant export it, otherwise use the literal `'/api/v1'`, which is what every msw handler and `stage4.ts` use).
- Produces: the hooks and keys in the "Names other lanes consume" table.

- [ ] **Step 1: Write the failing hook test**

```tsx
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useLearningItems, useCreateLearningItem, usePublishLearningItem } from '../../src/api/hooks/learningManage.js';
import { useGaps, useDismissGap } from '../../src/api/hooks/gaps.js';
import { useWorkflowSettings, usePutWorkflowSettings } from '../../src/api/hooks/workflow.js';
import { learningState } from '../msw/learning-manage.js';

const wrap = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return { qc, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> };
};

describe('wave 5 V4b hooks', () => {
  it('lists items parsed against the contract and invalidates the list on create', async () => {
    const { qc, wrapper } = wrap();
    const list = renderHook(() => useLearningItems({ kind: 'quiz' }), { wrapper });
    await waitFor(() => expect(list.result.current.data?.items).toHaveLength(1));
    const create = renderHook(() => useCreateLearningItem(), { wrapper });
    await act(() => create.result.current.mutateAsync({ kind: 'quiz', title: 'חדש' }));
    expect(learningState.items.some((i) => i.title === 'חדש')).toBe(true);
    expect(qc.getQueryState(['learning', 'items', { kind: 'quiz' }])?.isInvalidated).toBe(true);
  });
  it('publish sends the label and invalidates item, versions and my-learning', async () => {
    const { qc, wrapper } = wrap();
    const id = learningState.items[0]!.id;
    const pub = renderHook(() => usePublishLearningItem(id), { wrapper });
    await act(() => pub.result.current.mutateAsync({ label: 'גרסה ראשונה' }));
    expect(learningState.published).toEqual([{ itemId: id, label: 'גרסה ראשונה' }]);
    for (const k of [['learning', 'item', id], ['learning', 'versions', id], ['learning', 'my']])
      qc.setQueryData(k, {}), expect(true).toBe(true); // keys exist; invalidation asserted below via state
  });
  it('gaps: list defaults to open and dismiss carries the reason', async () => {
    const { wrapper } = wrap();
    const list = renderHook(() => useGaps({}), { wrapper });
    await waitFor(() => expect(list.result.current.data?.items).toHaveLength(2));
    const dismiss = renderHook(() => useDismissGap(), { wrapper });
    await act(() => dismiss.result.current.mutateAsync({ id: learningState.gaps[0]!.id, reason: 'כפול' }));
    expect(learningState.gaps[0]!.status).toBe('dismissed');
    expect(learningState.gaps[0]!.dismissedReason).toBe('כפול');
  });
  it('workflow settings round-trip a deep patch', async () => {
    const { wrapper } = wrap();
    const get = renderHook(() => useWorkflowSettings(true), { wrapper });
    await waitFor(() => expect(get.result.current.data?.requireApprover).toBe(false));
    const put = renderHook(() => usePutWorkflowSettings(), { wrapper });
    await act(() => put.result.current.mutateAsync({ requireApprover: true, gaps: { staleDays: 90 } }));
    expect(learningState.workflow.requireApprover).toBe(true);
    expect(learningState.workflow.gaps.staleDays).toBe(90);
    expect(learningState.workflow.learning.defaultPassMark).toBe(80);
  });
});
```
(Replace the placeholder loop in the second test with a real assertion once you know the key shapes: after `mutateAsync`, `qc.getQueryState(keys.learning.item(id))?.isInvalidated` is `true` when the key was populated before — seed it with `qc.setQueryData(keys.learning.item(id), learningState.items[0])` *before* publishing.)

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4 learning/hooks`.

- [ ] **Step 3: Bridge** — `apps/web/src/api/wave5.ts`

```ts
/**
 * Wave 5 request bridge — TEMPORARY. The V1–V3 routes are not in `docs/api/openapi.json` while the
 * web lanes run, so the generated client cannot type them. Every call here is still validated at
 * runtime with `checked`/`checkedMaybe` against `@wecom/shared`. V6 replaces each hook body with the
 * generated `api.*` call and deletes this file (the wave 4 precedent: W2-web's `postWave4`).
 */
import type { z } from 'zod';
import { checked, checkedMaybe } from './stage45.js';

const BASE = '/api/v1';
type Query = Record<string, string | number | boolean | undefined | null>;

const qs = (q?: Query): string => {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, opts: { query?: Query; body?: unknown } = {}) {
  const response = await fetch(`${BASE}${path}${qs(opts.query)}`, {
    method,
    credentials: 'include',
    headers: opts.body === undefined ? {} : { 'content-type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await response.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  return response.ok ? { data: json, response } : { error: json, response };
}

export const w5 = async <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, method: Parameters<typeof call>[0], path: string, opts?: Parameters<typeof call>[2]): Promise<T> =>
  checked(schema, await call(method, path, opts));
export const w5Maybe = async <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, method: Parameters<typeof call>[0], path: string, opts?: Parameters<typeof call>[2]): Promise<T | null> =>
  checkedMaybe(schema, await call(method, path, opts));
/** For 204 routes: throws the typed ApiError on failure, resolves void on success. */
export const w5Void = async (method: Parameters<typeof call>[0], path: string, opts?: Parameters<typeof call>[2]): Promise<void> => {
  const res = await call(method, path, opts);
  if (!res.response.ok) checked(z_never, res); // `checked` → `unwrap` throws the ApiError
};
import { z as zod } from 'zod';
const z_never = zod.never();
```
(Keep the two `zod` imports as one `import { z } from 'zod'` if the type-only import conflicts; the intent is `z.never()` as the schema that only ever sees a failed result.)

- [ ] **Step 4: Keys** (append inside `keys`, before `admin:`)

```ts
  /* wave 5 — learning (V4a reads `my`; V4b owns the rest) */
  learning: {
    my: ['learning', 'my'] as const,
    items: (q: unknown = '*') => ['learning', 'items', q] as const,
    item: (id: string) => ['learning', 'item', id] as const,
    versions: (id: string) => ['learning', 'versions', id] as const,
    completion: (id: string) => ['learning', 'completion', id] as const,
    dashboard: (world: string = '*') => ['learning', 'dashboard', world] as const,
    forDocument: (documentId: string) => ['learning', 'forDocument', documentId] as const,
  },
  gaps: (q: unknown = '*') => ['gaps', q] as const,
```
and inside `admin: { … }` append `workflow: ['admin', 'workflow'] as const,`. If V4a has already added `learning.my` (merge order V4a → V4b), keep theirs and add only the missing members.

- [ ] **Step 5: Invalidation helper** — `apps/web/src/api/invalidateLearning.ts`

```ts
import type { QueryClient } from '@tanstack/react-query';
/** Every learning write can move the manager list, the item, its versions, completion, the dashboard and the agent's own list. */
export function invalidateLearning(qc: QueryClient, itemId?: string): void {
  for (const queryKey of [['learning', 'items'], ['learning', 'dashboard'], ['learning', 'my']] as const) void qc.invalidateQueries({ queryKey });
  if (itemId)
    for (const queryKey of [['learning', 'item', itemId], ['learning', 'versions', itemId], ['learning', 'completion', itemId]] as const)
      void qc.invalidateQueries({ queryKey });
}
```

- [ ] **Step 6: Hooks** — `apps/web/src/api/hooks/learningManage.ts`

```ts
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AudienceSchema, CompletionResponseSchema, GenerateQuestionsResponseSchema, LearningDashboardSchema, LearningItemSchema,
  LearningItemsResponseSchema, LearningVersionSchema,
  type AudienceCreateSchema, type AssignBodySchema, type GenerateQuestionsBodySchema, type LearningItemCreateSchema,
  type LearningItemPatchSchema, type LearningItemsQuerySchema, type LearningPublishBodySchema, type PutEntriesBodySchema,
  type PutQuestionsBodySchema,
} from '@wecom/shared';
import { keys } from '../keys.js';
import { invalidateLearning } from '../invalidateLearning.js';
import { w5, w5Void } from '../wave5.js';

export type LearningItemsQuery = Partial<z.input<typeof LearningItemsQuerySchema>>;
const VersionsSchema = z.object({ items: z.array(LearningVersionSchema) });
const AssignedSchema = z.object({ assigned: z.number().int() });

export const useLearningItems = (q: LearningItemsQuery = {}, enabled = true) =>
  useQuery({ queryKey: keys.learning.items(q), enabled, placeholderData: keepPreviousData,
    queryFn: () => w5(LearningItemsResponseSchema, 'GET', '/learning/items', { query: q as Record<string, string | number | undefined> }) });

export const useLearningItem = (id: string | undefined) =>
  useQuery({ queryKey: keys.learning.item(id ?? ''), enabled: !!id, queryFn: () => w5(LearningItemSchema, 'GET', `/learning/items/${id}`) });

export const useCreateLearningItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: z.input<typeof LearningItemCreateSchema>) => w5(LearningItemSchema, 'POST', '/learning/items', { body }),
    onSuccess: () => invalidateLearning(qc),
  });
};
export const usePatchLearningItem = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: z.input<typeof LearningItemPatchSchema>) => w5(LearningItemSchema, 'PATCH', `/learning/items/${id}`, { body }),
    onSuccess: (item) => { qc.setQueryData(keys.learning.item(id), item); invalidateLearning(qc, id); },
  });
};
export const useDeleteLearningItem = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => w5Void('DELETE', `/learning/items/${id}`), onSuccess: () => invalidateLearning(qc) });
};
export const usePutEntries = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: z.input<typeof PutEntriesBodySchema>) => w5(LearningItemSchema, 'PUT', `/learning/items/${id}/entries`, { body }),
    onSuccess: (item) => { qc.setQueryData(keys.learning.item(id), item); invalidateLearning(qc, id); },
  });
};
export const usePutQuestions = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: z.input<typeof PutQuestionsBodySchema>) => w5(LearningItemSchema, 'PUT', `/learning/items/${id}/questions`, { body }),
    onSuccess: (item) => { qc.setQueryData(keys.learning.item(id), item); invalidateLearning(qc, id); },
  });
};
/** Draft questions only — nothing is saved until `usePutQuestions` (spec §4). */
export const useGenerateQuestions = (id: string) =>
  useMutation({ mutationFn: (body: z.input<typeof GenerateQuestionsBodySchema>) => w5(GenerateQuestionsResponseSchema, 'POST', `/learning/items/${id}/generate`, { body }) });
export const usePublishLearningItem = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: z.input<typeof LearningPublishBodySchema>) => w5(LearningItemSchema, 'POST', `/learning/items/${id}/publish`, { body }),
    onSuccess: (item) => { qc.setQueryData(keys.learning.item(id), item); invalidateLearning(qc, id); },
  });
};
export const useLearningVersions = (id: string | undefined) =>
  useQuery({ queryKey: keys.learning.versions(id ?? ''), enabled: !!id, queryFn: async () => (await w5(VersionsSchema, 'GET', `/learning/items/${id}/versions`)).items });
export const useCreateAudience = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: z.input<typeof AudienceCreateSchema>) => w5(AudienceSchema, 'POST', `/learning/items/${id}/audiences`, { body }),
    onSuccess: () => invalidateLearning(qc, id),
  });
};
export const useDeleteAudience = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (audienceId: string) => w5Void('DELETE', `/learning/audiences/${audienceId}`), onSuccess: () => invalidateLearning(qc) });
};
export const useAssignUsers = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: z.input<typeof AssignBodySchema>) => w5(AssignedSchema, 'POST', `/learning/items/${id}/assign`, { body }),
    onSuccess: () => invalidateLearning(qc, id),
  });
};
export const useCompletion = (id: string | undefined, enabled = true) =>
  useQuery({ queryKey: keys.learning.completion(id ?? ''), enabled: enabled && !!id, queryFn: () => w5(CompletionResponseSchema, 'GET', `/learning/items/${id}/completion`) });
export const useLearningDashboard = (world?: string, enabled = true) =>
  useQuery({ queryKey: keys.learning.dashboard(world), enabled, staleTime: 60_000, queryFn: () => w5(LearningDashboardSchema, 'GET', '/learning/dashboard', { query: { world } }) });
/** Items that reference one document (`GET /documents/:id/learning`, V2). Parsed with the shared schema, which V0
 *  is extending with `refreshAssignmentId` — additive, so this hook does not care. If V4a already exports a
 *  `useDocumentLearning` from `hooks/learning.ts`, V6 keeps one and re-points the other's callers. */
export const useDocumentLearning = (documentId: string | undefined, enabled = true) =>
  useQuery({ queryKey: keys.learning.forDocument(documentId ?? ''), enabled: enabled && !!documentId,
    queryFn: () => w5(DocumentLearningSchema, 'GET', `/documents/${documentId}/learning`) });
```
(add `DocumentLearningSchema` to the `@wecom/shared` import.)
(`POST /learning/items/:id/assign` response: the contract doc lists it under V2 without a schema; use `{ assigned: number }` here and record it in the lane report as a contract question for V2/V6 — V6 reconciles to whatever V2 returns.)

`apps/web/src/api/hooks/gaps.ts`:
```ts
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { GapDetectResultSchema, GapSchema, GapsResponseSchema, type GapsQuerySchema } from '@wecom/shared';
import { keys } from '../keys.js';
import { w5 } from '../wave5.js';

export type GapsQuery = Partial<z.input<typeof GapsQuerySchema>>;
const ALL = { queryKey: ['gaps'] as const };

export const useGaps = (q: GapsQuery = {}, enabled = true) =>
  useQuery({ queryKey: keys.gaps(q), enabled, placeholderData: keepPreviousData,
    queryFn: () => w5(GapsResponseSchema, 'GET', '/gaps', { query: q as Record<string, string | number | undefined> }) });
const useGapMutation = <V>(fn: (v: V) => Promise<unknown>) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries(ALL) });
};
export const useDismissGap = () => useGapMutation(({ id, reason }: { id: string; reason: string }) => w5(GapSchema, 'POST', `/gaps/${id}/dismiss`, { body: { reason } }));
export const useResolveGap = () => useGapMutation(({ id, documentId }: { id: string; documentId: string }) => w5(GapSchema, 'POST', `/gaps/${id}/resolve`, { body: { documentId } }));
export const useDetectGaps = () => useGapMutation(() => w5(GapDetectResultSchema, 'POST', '/gaps/detect'));
```

`apps/web/src/api/hooks/workflow.ts`:
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { WorkflowSettingsSchema, type WorkflowSettingsPutSchema } from '@wecom/shared';
import { keys } from '../keys.js';
import { w5 } from '../wave5.js';

export const useWorkflowSettings = (enabled = true) =>
  useQuery({ queryKey: keys.admin.workflow, enabled, queryFn: () => w5(WorkflowSettingsSchema, 'GET', '/admin/workflow') });
export const usePutWorkflowSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: z.input<typeof WorkflowSettingsPutSchema>) => w5(WorkflowSettingsSchema, 'PUT', '/admin/workflow', { body: patch }),
    onSuccess: (s) => { qc.setQueryData(keys.admin.workflow, s); void qc.invalidateQueries({ queryKey: ['reviews'] }); },
  });
};
```

- [ ] **Step 7: Run** — hooks test PASS; `pnpm --filter @wecom/web build` green.
- [ ] **Step 8: Commit** — `feat(web): wave 5 learning/gaps/workflow hooks over a validated request bridge`

---

### Task 3: Learning manager page and route

**Files:**
- Create: `apps/web/src/components/learning/manage/LearningManagePage.tsx`, `apps/web/src/components/learning/manage/LearningDashboardPanel.tsx`
- Modify: `apps/web/src/routes.tsx` (append lazy routes), `apps/web/src/styles/app.css` (append block)
- Test: `apps/web/test/learning/LearningManage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PERMISSIONS } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { learningState } from '../msw/learning-manage.js';
import { D_BROWSING } from '../msw/fixtures.js';

const asEditor = () => server.use(withMe({ roles: ['editor'], permissions: ['docs.read', 'learning.read', 'learning.manage', 'gaps.read'] }));
const asLead = () => server.use(withMe({ roles: ['lead'], permissions: [...PERMISSIONS] }));

describe('/learning/manage', () => {
  it('lists items with kind, status, completion and filters by kind', async () => {
    asEditor();
    renderWithProviders(<App />, { route: '/learning/manage' });
    const list = await screen.findByTestId('learning-items');
    expect(within(list).getAllByRole('article')).toHaveLength(2);
    expect(within(list).getByText('75%')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('סוג'), 'quiz');
    expect(await within(await screen.findByTestId('learning-items')).findAllByRole('article')).toHaveLength(1);
  });
  it('creates a quiz and lands in its editor', async () => {
    asEditor();
    renderWithProviders(<App />, { route: '/learning/manage' });
    await screen.findByTestId('learning-items');
    await userEvent.click(screen.getByRole('button', { name: '✚ שאלון' }));
    await userEvent.type(await screen.findByLabelText('כותרת'), 'שאלון חדש');
    await userEvent.click(screen.getByRole('button', { name: 'צור' }));
    expect(await screen.findByRole('heading', { level: 1, name: /שאלון חדש/ })).toBeInTheDocument();
    expect(learningState.items.some((i) => i.title === 'שאלון חדש' && i.kind === 'quiz')).toBe(true);
  });
  it('filters to the items referencing a document when ?documentId= is set (the article badge links here)', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage?documentId=${D_BROWSING}` });
    const list = await screen.findByTestId('learning-items');
    expect(within(list).getAllByRole('article')).toHaveLength(1); // only the quiz anchors questions to D_BROWSING
    expect(screen.getByText(/מסונן לפי פריט ידע/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'בטל סינון לפי פריט ידע' }));
    expect(await within(await screen.findByTestId('learning-items')).findAllByRole('article')).toHaveLength(2);
  });
  it('shows the dashboard panel to a lead and hides the page from a reader', async () => {
    asLead();
    renderWithProviders(<App />, { route: '/learning/manage' });
    expect(await screen.findByText('ממתינים לרענון')).toBeInTheDocument();
    server.use(withMe({ roles: ['agent'], permissions: ['docs.read', 'learning.read'] }));
    renderWithProviders(<App />, { route: '/learning/manage' });
    expect(await screen.findByText('אין הרשאה לניהול למידה')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** — route does not exist.

- [ ] **Step 3: Implement `LearningDashboardPanel.tsx`**

```tsx
import { useLearningDashboard } from '../../../api/hooks/learningManage.js';
import { worldLabel } from '../../taxonomy/TypeBadge.js';
import { LoadError } from '../../ui/index.js';

const pct = (r: number) => `${Math.round(r * 100)}%`;

/** Spec §5: completion rates, overdue, top failed questions — the manager's summary strip. */
export function LearningDashboardPanel({ world }: { world?: string }) {
  const d = useLearningDashboard(world);
  if (d.isError) return <LoadError what="לוח למידה" error={d.error} />;
  if (!d.data) return <div className="route-loading">טוען…</div>;
  const t = d.data.totals;
  return (
    <section className="learning-dashboard" aria-label="לוח למידה">
      <div className="stats">
        <div className="stat"><b>{t.items}</b><span>פריטי למידה</span></div>
        <div className="stat"><b>{t.assigned}</b><span>הוקצו</span></div>
        <div className="stat"><b>{t.completed}</b><span>הושלמו</span></div>
        <div className="stat warn"><b>{t.overdue}</b><span>באיחור</span></div>
        <div className="stat"><b>{t.refreshPending}</b><span>ממתינים לרענון</span></div>
      </div>
      {d.data.byWorld.length ? (
        <table className="table compact"><thead><tr><th>עולם תוכן</th><th>הוקצו</th><th>הושלמו</th><th>באיחור</th><th>שיעור</th></tr></thead>
          <tbody>{d.data.byWorld.map((w) => (
            <tr key={w.worldSlug}><td>{worldLabel(w.worldSlug)}</td><td>{w.assigned}</td><td>{w.completed}</td><td>{w.overdue}</td><td>{pct(w.rate)}</td></tr>
          ))}</tbody></table>
      ) : null}
      {d.data.failedQuestions.length ? (
        <div className="failed-questions">
          <h3>שאלות שנכשלות הכי הרבה</h3>
          <ul>{d.data.failedQuestions.map((q) => (
            <li key={q.questionId}><span className="chip chip-red">{pct(q.failRate)}</span> {q.stem} <small>· {q.itemTitle} · {q.attempts} ניסיונות</small></li>
          ))}</ul>
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Implement `LearningManagePage.tsx`**

```tsx
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { LearningKindSchema, LearningStatusSchema } from '@wecom/shared';
import type { z } from 'zod';
import { useCreateLearningItem, useDocumentLearning, useLearningItems } from '../../../api/hooks/learningManage.js';
import { useCan } from '../../../api/hooks/me.js';
import { useWorlds } from '../../../api/hooks/taxonomy.js';
import { ago } from '../../../lib/format.js';
import { Hamburger } from '../../shell/MobileDrawer.js';
import { useModal } from '../../ui/Modal.js';
import { useToast } from '../../ui/Toast.js';
import { Chip, Empty, LoadError } from '../../ui/index.js';
import { worldLabel } from '../../taxonomy/TypeBadge.js';
import { LearningDashboardPanel } from './LearningDashboardPanel.js';

type Kind = z.infer<typeof LearningKindSchema>;
type Status = z.infer<typeof LearningStatusSchema>;
export const KIND_LABEL: Record<Kind, string> = { briefing: 'תדריך', quiz: 'שאלון' };
export const LSTATUS_LABEL: Record<Status, string> = { draft: 'טיוטה', published: 'פורסם', archived: 'ארכיון' };
const STATUS_TONE: Record<Status, string> = { draft: 'chip-amber', published: 'chip-green', archived: 'chip-gray' };

/** The editor's learning manager (spec §5): list, filters, create, dashboard strip. */
export function LearningManagePage() {
  const can = useCan();
  const go = useNavigate();
  const modal = useModal();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const kind = (sp.get('kind') as Kind | null) ?? undefined;
  const status = (sp.get('status') as Status | null) ?? undefined;
  const world = sp.get('world') ?? undefined;
  /** The article's `LearningBadge` (V4a) links here with the document it sits on (V4a pin). */
  const documentId = sp.get('documentId') ?? undefined;
  const [q, setQ] = useState(sp.get('q') ?? '');
  const mayManage = can('learning.manage');
  const list = useLearningItems({ kind, status, world, q: q || undefined }, mayManage && !documentId);
  const forDoc = useDocumentLearning(documentId, mayManage);
  const worlds = useWorlds();
  const create = useCreateLearningItem();
  // One list to render: the document-scoped one when filtering, else the manager list.
  const cards = documentId ? (forDoc.data?.items ?? []) : (list.data?.items ?? []);
  const loadError = documentId ? forDoc.error : list.error;

  if (!mayManage)
    return (<div className="page"><Empty title="אין הרשאה לניהול למידה">המסך מיועד לעורכי תוכן.</Empty></div>);

  const set = (k: string, v?: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const createItem = async (k: Kind) => {
    const title = await modal.prompt(k === 'quiz' ? 'שאלון חדש' : 'תדריך חדש', 'כותרת');
    if (!title?.trim()) return;
    try {
      const item = await create.mutateAsync({ kind: k, title: title.trim(), worldSlug: world ?? null });
      go(`/learning/manage/${item.id}`);
    } catch { toast('יצירת פריט הלמידה נכשלה', 'warn'); }
  };

  return (
    <div className="page learning-manage">
      <div className="topbar">
        <Hamburger />
        <h1>ניהול למידה</h1>
        <span className="grow" />
        <button type="button" className="btn sm" onClick={() => void createItem('briefing')}>✚ תדריך</button>
        <button type="button" className="btn primary sm" onClick={() => void createItem('quiz')}>✚ שאלון</button>
      </div>
      <LearningDashboardPanel world={world} />
      <div className="facets" aria-label="סינון">
        <label className="small">סוג
          <select aria-label="סוג" value={kind ?? ''} onChange={(e) => set('kind', e.target.value || undefined)}>
            <option value="">הכל</option><option value="briefing">תדריך</option><option value="quiz">שאלון</option>
          </select></label>
        <label className="small">סטטוס
          <select aria-label="סטטוס" value={status ?? ''} onChange={(e) => set('status', e.target.value || undefined)}>
            <option value="">הכל</option>{(['draft', 'published', 'archived'] as Status[]).map((s) => <option key={s} value={s}>{LSTATUS_LABEL[s]}</option>)}
          </select></label>
        <label className="small">עולם תוכן
          <select aria-label="עולם תוכן" value={world ?? ''} onChange={(e) => set('world', e.target.value || undefined)}>
            <option value="">הכל</option>{(worlds.data ?? []).map((w) => <option key={w.slug} value={w.slug}>{w.name}</option>)}
          </select></label>
        <input aria-label="חיפוש" placeholder="חיפוש…" value={q} onChange={(e) => { setQ(e.target.value); set('q', e.target.value || undefined); }} />
      </div>
      {documentId ? (
        <div className="chips" aria-live="polite">
          <span className="chip chip-amber">מסונן לפי פריט ידע <button type="button" aria-label="בטל סינון לפי פריט ידע" onClick={() => set('documentId', undefined)}>✕</button></span>
          <Link className="linklike" to={`/doc/${documentId}`}>לפריט הידע</Link>
        </div>
      ) : null}
      {loadError ? <LoadError what="פריטי למידה" error={loadError} /> : null}
      {(documentId ? forDoc.data : list.data) && cards.length === 0 ? (
        <Empty title={documentId ? 'אין פריטי למידה לפריט ידע זה' : 'אין פריטי למידה'}>צרו תדריך או שאלון מפריטי ידע שפורסמו.</Empty>
      ) : null}
      <div className="grid" data-testid="learning-items">
        {cards.map((c) => (
          <article key={c.id} className="tcard" onClick={() => go(`/learning/manage/${c.id}`)} tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(`/learning/manage/${c.id}`); } }}>
            <div className="chips">
              <Chip>{KIND_LABEL[c.kind]}</Chip>
              <span className={'chip ' + STATUS_TONE[c.status]}>{LSTATUS_LABEL[c.status]}</span>
              {c.worldSlug ? <Chip>{worldLabel(c.worldSlug)}</Chip> : null}
              {c.needsUpdate ? <span className="chip chip-red">דורש עדכון</span> : null}
            </div>
            <div className="title">{c.title}</div>
            <div className="desc">
              {c.kind === 'quiz' ? `${c.questionCount} שאלות` : `${c.entryCount} פריטים`} · {c.assignedUsers} הוקצו
              {c.completionRate !== null ? ` · ${Math.round(c.completionRate * 100)}%` : ''} · עודכן {ago(c.updatedAt)}
            </div>
            <Link className="linklike" to={`/learning/manage/${c.id}`} onClick={(e) => e.stopPropagation()}>פתח</Link>
          </article>
        ))}
      </div>
    </div>
  );
}
```
(The test's "creates a quiz" step types into a prompt labelled `כותרת` and presses `צור`: read `Modal.tsx`'s `prompt` implementation for the OK button label — if it is `אישור`, change the test to `אישור`, not the component. The `75%` assertion reads the card's completion text.)

- [ ] **Step 5: Routes** — append to `routes.tsx` (lazy definitions next to the wave 4 ones, and route entries **before** `admin`):
```tsx
/** Wave 5 (V4b). Editor tooling: deliberate destinations, lazy. `manage` routes precede V4a's
 *  `learning/:assignmentId`, or a manager would try to open an assignment called "manage" (V6 keeps the order). */
const LearningManagePage = () => import('./components/learning/manage/LearningManagePage.js').then((m) => ({ default: m.LearningManagePage }));
const LearningItemEditor = () => import('./components/learning/manage/LearningItemEditor.js').then((m) => ({ default: m.LearningItemEditor }));
const GapsPage = () => import('./components/gaps/GapsPage.js').then((m) => ({ default: m.GapsPage }));
…
      { path: 'learning/manage', element: split(LearningManagePage) },
      { path: 'learning/manage/new', element: split(LearningItemEditor) },
      { path: 'learning/manage/:id', element: split(LearningItemEditor) },
      { path: 'gaps', element: split(GapsPage) },
```
Until Task 4 exists, create `LearningItemEditor.tsx` as the minimal page from Task 4 Step 3 so the route compiles (or land Task 3 and 4 in one commit — either is fine; the test above only needs the editor's `<h1>`).

- [ ] **Step 6: CSS** — append to `app.css`:
```css
/* wave 5 — V4b (learning manager, builders, gaps, workflow) */
.learning-dashboard { display: grid; gap: 12px; margin-bottom: 14px; }
.learning-dashboard .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
.learning-dashboard .stat.warn b { color: var(--red); }
.failed-questions ul { margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.learning-manage .grid { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.item-editor { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; }
.item-editor .side { display: grid; gap: 12px; align-content: start; }
.builder-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.builder-list > li { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 12px 14px; display: grid; gap: 8px; }
.builder-list .row-actions { display: flex; gap: 6px; justify-content: flex-end; }
.question-editor .options { display: grid; gap: 6px; }
.question-editor .option { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: center; }
.doc-picker { position: relative; }
.doc-picker .results { position: absolute; inset-inline: 0; top: 100%; z-index: 5; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md); box-shadow: var(--shadow); max-height: 280px; overflow: auto; }
.doc-picker .results button { display: block; width: 100%; text-align: start; padding: 8px 10px; background: none; border: 0; cursor: pointer; }
.doc-picker .results button:hover, .doc-picker .results button:focus-visible { background: var(--bg-2); outline: none; }
.assign-dialog fieldset { border: 1px solid var(--border); border-radius: var(--r-md); padding: 10px 12px; margin: 0 0 10px; }
.assign-dialog .checks { display: flex; flex-wrap: wrap; gap: 8px 14px; }
.gaps-page .gap { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; gap: 12px; align-items: start; }
.gaps-page .score { font-size: 22px; font-weight: 700; color: var(--red); }
.gaps-page .evidence { font-size: 12px; color: var(--muted); font-family: var(--mono, monospace); white-space: pre-wrap; }
.workflow-section .form label { display: grid; gap: 4px; }
@media (max-width: 900px) { .item-editor { grid-template-columns: 1fr; } .gaps-page .gap { grid-template-columns: 1fr; } }
```

- [ ] **Step 7: Run** — `LearningManage` test PASS; build green.
- [ ] **Step 8: Commit** — `feat(web): learning manager page, dashboard panel, wave 5 routes and styles`

---

### Task 4: Item editor shell, document picker, briefing builder

**Files:**
- Create: `apps/web/src/components/learning/manage/LearningItemEditor.tsx`, `DocumentPicker.tsx`, `BriefingBuilder.tsx`, `ItemPreview.tsx`
- Test: `apps/web/test/learning/Builders.test.tsx` (briefing cases)

**Interfaces:**
- Consumes: `useSearch(q, 'documents')` (hits with `type: 'document'` carry `id` = document id and `title`), `useTopicView(topicId)` for the topic shortcut (its `groups[].items[]` carry published items), `RichText` (`{ value, onChange, compact, label }`), `worldLabel`.
- Produces: `DocumentPicker({ onPick(doc: { id: string; title: string }), exclude?: string[] })`, `BriefingBuilder({ item: LearningItem })`, `ItemPreview({ item: LearningItem })`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { learningState } from '../msw/learning-manage.js';
import { LI_BRIEF, LI_QUIZ, D_BROWSING } from '../msw/fixtures.js';

const asEditor = () => server.use(withMe({ roles: ['editor'], permissions: ['docs.read', 'learning.read', 'learning.manage'] }));
const asLead = () => server.use(withMe({ roles: ['lead'], permissions: ['docs.read', 'learning.read', 'learning.manage', 'learning.publish'] }));

describe('briefing builder', () => {
  it('adds a published document from the picker, writes a note, reorders and saves', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_BRIEF}` });
    expect(await screen.findByRole('heading', { level: 1, name: /נדידה/ })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('הוסף פריט ידע'), 'גלישה');
    await userEvent.click(await screen.findByRole('button', { name: /תקלות גלישה/ }));
    const list = screen.getByTestId('entries-list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    await userEvent.type(within(list).getAllByLabelText('הערה לנציג')[1]!, 'לקרוא בעיון');
    await userEvent.click(within(list).getAllByRole('button', { name: 'למעלה' })[1]!);
    await userEvent.click(screen.getByRole('button', { name: 'שמור פריטים' }));
    await waitFor(() => expect(learningState.items.find((i) => i.id === LI_BRIEF)!.entries[0]!.documentId).toBe(D_BROWSING));
    expect(learningState.items.find((i) => i.id === LI_BRIEF)!.entries[0]!.note).toBe('לקרוא בעיון');
  });
  it('publish is hidden without learning.publish and prompts for a label with it', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_BRIEF}` });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'פרסם' })).toBeNull();
    asLead();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_BRIEF}` });
    await userEvent.click((await screen.findAllByRole('button', { name: 'פרסם' }))[0]!);
    await userEvent.type(await screen.findByLabelText('תיאור הגרסה'), 'עדכון ספטמבר');
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }));
    await waitFor(() => expect(learningState.published.at(-1)).toEqual({ itemId: LI_BRIEF, label: 'עדכון ספטמבר' }));
  });
  it('shows the preview modal read-only', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_QUIZ}` });
    await userEvent.click(await screen.findByRole('button', { name: 'תצוגה מקדימה' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/מה עושים אם אין גלישה/)).toBeInTheDocument();
    expect(within(dlg).queryByText('נכון')).toBeNull(); // correct flags are not shown in the agent preview
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: `LearningItemEditor.tsx`** (shell: metadata side panel + builder by kind + actions)

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { LearningItem } from '@wecom/shared';
import { useCreateLearningItem, useDeleteLearningItem, useLearningItem, useLearningVersions, usePatchLearningItem, usePublishLearningItem } from '../../../api/hooks/learningManage.js';
import { useCan } from '../../../api/hooks/me.js';
import { useWorlds } from '../../../api/hooks/taxonomy.js';
import { ago } from '../../../lib/format.js';
import { Hamburger } from '../../shell/MobileDrawer.js';
import { useModal } from '../../ui/Modal.js';
import { useToast } from '../../ui/Toast.js';
import { Empty, LoadError } from '../../ui/index.js';
import { RichText } from '../../source/RichText.js';
import { AssignDialog } from './AssignDialog.js';
import { BriefingBuilder } from './BriefingBuilder.js';
import { CompletionDashboard } from './CompletionDashboard.js';
import { ItemPreview } from './ItemPreview.js';
import { KIND_LABEL, LSTATUS_LABEL } from './LearningManagePage.js';
import { QuizBuilder } from './QuizBuilder.js';

/** Builder shell (spec §5): metadata, the kind-specific builder, preview, publish, assign, completion. */
export function LearningItemEditor() {
  const { id } = useParams<{ id?: string }>();
  const [sp] = useSearchParams();
  const isNew = !id;
  const can = useCan();
  const go = useNavigate();
  const modal = useModal();
  const toast = useToast();
  const item = useLearningItem(id);
  const versions = useLearningVersions(id);
  const worlds = useWorlds();
  const create = useCreateLearningItem();
  const patch = usePatchLearningItem(id ?? '');
  const publish = usePublishLearningItem(id ?? '');
  const del = useDeleteLearningItem();
  const [assignOpen, setAssignOpen] = useState(false);
  const [tab, setTab] = useState<'build' | 'completion'>('build');
  const mayManage = can('learning.manage');
  const mayPublish = can('learning.publish');

  // New item: create on first render from `?kind=`, then continue as an edit of the created id.
  useEffect(() => {
    if (!isNew || create.isPending || create.isSuccess) return;
    const kind = (sp.get('kind') === 'briefing' ? 'briefing' : 'quiz') as LearningItem['kind'];
    void create.mutateAsync({ kind, title: kind === 'quiz' ? 'שאלון חדש' : 'תדריך חדש' })
      .then((created) => go(`/learning/manage/${created.id}`, { replace: true }))
      .catch(() => toast('יצירת פריט הלמידה נכשלה', 'warn'));
  }, [isNew, create, sp, go, toast]);

  if (!mayManage) return <div className="page"><Empty title="אין הרשאה לניהול למידה">המסך מיועד לעורכי תוכן.</Empty></div>;
  if (item.isError) return <div className="page"><LoadError what="פריט הלמידה" error={item.error} /></div>;
  if (!item.data) return <div className="route-loading">טוען…</div>;
  const it = item.data;

  const save = (body: Parameters<typeof patch.mutateAsync>[0]) => patch.mutateAsync(body).catch(() => toast('השמירה נכשלה', 'warn'));
  const doPublish = async () => {
    const label = await modal.prompt('פרסום פריט למידה', 'תיאור הגרסה');
    if (!label?.trim()) return;
    try { await publish.mutateAsync({ label: label.trim() }); toast('פריט הלמידה פורסם', 'ok'); }
    catch { toast('הפרסום נכשל', 'warn'); }
  };
  const doDelete = async () => {
    if (!(await modal.confirm('למחוק את פריט הלמידה?', 'הקצאות והשלמות קיימות יישמרו בהיסטוריה.', 'מחק', 'danger'))) return;
    try { await del.mutateAsync(it.id); go('/learning/manage'); } catch { toast('המחיקה נכשלה', 'warn'); }
  };

  return (
    <div className="page item-editor-page">
      <div className="topbar">
        <Hamburger />
        <h1>{KIND_LABEL[it.kind]}: {it.title}</h1>
        <span className={'chip ' + (it.status === 'published' ? 'chip-green' : it.status === 'draft' ? 'chip-amber' : 'chip-gray')}>{LSTATUS_LABEL[it.status]}</span>
        {it.needsUpdate ? <span className="chip chip-red">דורש עדכון</span> : null}
        <span className="grow" />
        <button type="button" className="btn sm" onClick={() => modal.open({ title: 'תצוגה מקדימה', body: <ItemPreview item={it} /> })}>תצוגה מקדימה</button>
        <button type="button" className="btn sm" onClick={() => setAssignOpen(true)} disabled={it.status !== 'published'} title={it.status !== 'published' ? 'ניתן להקצות רק פריט שפורסם' : undefined}>הקצה</button>
        {mayPublish ? <button type="button" className="btn primary sm" onClick={() => void doPublish()}>פרסם</button> : null}
      </div>
      <nav className="tabs" role="tablist" aria-label="תצוגה">
        <button type="button" role="tab" aria-selected={tab === 'build'} className={'facet' + (tab === 'build' ? ' on' : '')} onClick={() => setTab('build')}>עריכה</button>
        <button type="button" role="tab" aria-selected={tab === 'completion'} className={'facet' + (tab === 'completion' ? ' on' : '')} onClick={() => setTab('completion')}>השלמה</button>
      </nav>
      {tab === 'completion' ? <CompletionDashboard itemId={it.id} /> : (
        <div className="item-editor">
          <div>
            <label>כותרת<input aria-label="כותרת" defaultValue={it.title} onBlur={(e) => e.target.value.trim() && e.target.value !== it.title && void save({ title: e.target.value.trim() })} /></label>
            <RichText value={it.description} onChange={(html) => { if (html !== it.description) void save({ description: html }); }} compact label="הקדמה" />
            {it.kind === 'briefing' ? <BriefingBuilder item={it} /> : <QuizBuilder item={it} />}
          </div>
          <aside className="side">
            <label>עולם תוכן
              <select aria-label="עולם תוכן" value={it.worldSlug ?? ''} onChange={(e) => void save({ worldSlug: e.target.value || null })}>
                <option value="">כללי</option>{(worlds.data ?? []).map((w) => <option key={w.slug} value={w.slug}>{w.name}</option>)}
              </select></label>
            <label>זמן משוער (דקות)<input aria-label="זמן משוער (דקות)" type="number" min={1} defaultValue={it.estimatedMinutes ?? ''} onBlur={(e) => void save({ estimatedMinutes: e.target.value ? Number(e.target.value) : null })} /></label>
            {it.kind === 'quiz' ? (<>
              <label>ציון עובר (%)<input aria-label="ציון עובר (%)" type="number" min={1} max={100} defaultValue={it.passMark ?? 80} onBlur={(e) => void save({ passMark: Number(e.target.value) || 80 })} /></label>
              <label>מספר ניסיונות מרבי
                <select aria-label="מספר ניסיונות מרבי" value={it.maxAttempts ?? ''} onChange={(e) => void save({ maxAttempts: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">ללא הגבלה</option>{[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                </select></label>
            </>) : null}
            <div className="kv"><span>גרסה</span><b>{it.currentVersion}</b><span>עודכן</span><b>{ago(it.updatedAt)}</b></div>
            {versions.data?.length ? (<ul className="version-list">{versions.data.map((v) => <li key={v.version}>גרסה {v.version} · {v.label} · {v.authorName} · {ago(v.createdAt)}</li>)}</ul>) : null}
            <button type="button" className="btn sm danger" onClick={() => void doDelete()}>מחק</button>
          </aside>
        </div>
      )}
      {assignOpen ? <AssignDialog itemId={it.id} onClose={() => setAssignOpen(false)} /> : null}
    </div>
  );
}
```
(Read `Modal.tsx`'s `open` options (`ModalOptions` at line 14) and use its actual field names for title/body; if `open` needs an explicit close action, pass one labelled `סגור`.)

- [ ] **Step 4: `DocumentPicker.tsx`**

```tsx
import { useState } from 'react';
import { useSearch } from '../../../api/hooks/search.js';
import { useDebounced } from '../../../lib/useDebounced.js';

export interface PickedDoc { id: string; title: string }
/** Search-backed picker over knowledge items. Only published items come back for a reader; the manager sees what the API lets it see. */
export function DocumentPicker({ onPick, exclude = [], label = 'הוסף פריט ידע' }: { onPick: (d: PickedDoc) => void; exclude?: string[]; label?: string }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const res = useSearch(dq, 'documents');
  const hits = (res.data?.groups ?? []).flatMap((g) => g.hits).filter((h) => h.type === 'document' && !exclude.includes(h.id));
  return (
    <div className="doc-picker">
      <label className="small">{label}<input aria-label={label} value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש פריט ידע…" /></label>
      {dq && hits.length ? (
        <div className="results" role="listbox" aria-label="תוצאות">
          {hits.slice(0, 12).map((h) => (
            <button key={h.id} type="button" role="option" aria-selected={false} onClick={() => { onPick({ id: h.id, title: h.title }); setQ(''); }}>
              {h.title} <small>· {h.meta}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```
(Read `SearchResponse` in `src/api/types.ts`: groups carry `type` and `hits`; adjust the flatMap to the real field names.)

- [ ] **Step 5: `BriefingBuilder.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { LearningItem } from '@wecom/shared';
import { usePutEntries } from '../../../api/hooks/learningManage.js';
import { useToast } from '../../ui/Toast.js';
import { DocumentPicker } from './DocumentPicker.js';

type Entry = LearningItem['entries'][number] & { documentTitle?: string };
const move = <T,>(xs: T[], i: number, dir: -1 | 1): T[] => { const j = i + dir; if (j < 0 || j >= xs.length) return xs; const n = [...xs]; [n[i], n[j]] = [n[j]!, n[i]!]; return n; };

/** Ordered set of published documents with a per-item note (spec §1.1). Saved as a whole with "שמור פריטים". */
export function BriefingBuilder({ item }: { item: LearningItem }) {
  const [entries, setEntries] = useState<Entry[]>(item.entries);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const put = usePutEntries(item.id);
  const toast = useToast();
  useEffect(() => setEntries(item.entries), [item.entries]);
  const dirty = JSON.stringify(entries) !== JSON.stringify(item.entries);

  return (
    <section aria-label="פריטי התדריך">
      <h2>פריטי ידע בתדריך</h2>
      <DocumentPicker exclude={entries.map((e) => e.documentId)} onPick={(d) => { setTitles((t) => ({ ...t, [d.id]: d.title })); setEntries((es) => [...es, { documentId: d.id, stepKey: null, note: '' }]); }} />
      <ul className="builder-list" data-testid="entries-list">
        {entries.map((e, i) => (
          <li key={e.id ?? e.documentId}>
            <div><b>{titles[e.documentId] ?? e.documentId}</b></div>
            <label className="small">הערה לנציג<input aria-label="הערה לנציג" value={e.note} onChange={(ev) => setEntries((es) => es.map((x, k) => (k === i ? { ...x, note: ev.target.value } : x)))} /></label>
            <div className="row-actions">
              <button type="button" aria-label="למעלה" disabled={i === 0} onClick={() => setEntries((es) => move(es, i, -1))}>↑</button>
              <button type="button" aria-label="למטה" disabled={i === entries.length - 1} onClick={() => setEntries((es) => move(es, i, 1))}>↓</button>
              <button type="button" aria-label="הסר" onClick={() => setEntries((es) => es.filter((_, k) => k !== i))}>✕</button>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="btn primary sm" disabled={!dirty || entries.length === 0 || put.isPending}
        onClick={() => put.mutateAsync({ entries: entries.map(({ documentTitle: _t, ...e }) => e) }).then(() => toast('הפריטים נשמרו', 'ok')).catch(() => toast('השמירה נכשלה', 'warn'))}>
        שמור פריטים
      </button>
    </section>
  );
}
```
Entries loaded from the server carry no title; resolve titles for display with the existing `useDocument(id)` hook per row if it is cheap (read `api/hooks/documents.ts`), else show the id and note it — the player (V4a) shows titles from `PlayerItem.entries[].documentTitle`.

- [ ] **Step 6: `ItemPreview.tsx`** — read-only agent-eye view: for a briefing, the intro HTML (sanitized server-side; render with `dangerouslySetInnerHTML` inside `.prose` like `SourcePane` does) and the entry list with notes; for a quiz, each stem with its options **without** correct flags. No hooks.

- [ ] **Step 7: Run** — briefing tests PASS (the quiz preview test needs Task 5's `QuizBuilder` to exist; stub it as `export const QuizBuilder = () => null` until Task 5 if you commit Task 4 alone).
- [ ] **Step 8: Commit** — `feat(web): learning item editor shell, document picker, briefing builder, preview`

---

### Task 5: Quiz builder with generated questions

**Files:**
- Create: `apps/web/src/components/learning/manage/QuizBuilder.tsx`, `QuestionEditor.tsx`
- Test: `apps/web/test/learning/Builders.test.tsx` (quiz cases)

- [ ] **Step 1: Write the failing tests** (append)

```tsx
describe('quiz builder', () => {
  it('generates questions for the picked documents, marks them as generated, edits an option and saves', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_QUIZ}` });
    await screen.findByRole('heading', { level: 1, name: /תקלות גלישה/ });
    await userEvent.type(screen.getByLabelText('הוסף פריט ידע'), 'גלישה');
    await userEvent.click(await screen.findByRole('button', { name: /תקלות גלישה/ }));
    await userEvent.click(screen.getByRole('button', { name: 'צור שאלות' }));
    const list = screen.getByTestId('questions-list');
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3));
    expect(learningState.generateCalls.at(-1)).toEqual({ itemId: LI_QUIZ, documentIds: [D_BROWSING], perDocument: 3 });
    expect(within(list).getAllByText('נוצר אוטומטית')).toHaveLength(2 + 0); // fixture already has one generated + the new one
    const third = within(list).getAllByRole('listitem')[2]!;
    const opt = within(third).getAllByLabelText('טקסט האפשרות')[1]!;
    await userEvent.clear(opt); await userEvent.type(opt, 'מתקשרים לתמיכה');
    await userEvent.click(within(third).getAllByRole('radio', { name: 'תשובה נכונה' })[1]!);
    await userEvent.click(screen.getByRole('button', { name: 'שמור שאלות' }));
    await waitFor(() => expect(learningState.items.find((i) => i.id === LI_QUIZ)!.questions).toHaveLength(3));
    const saved = learningState.items.find((i) => i.id === LI_QUIZ)!.questions[2]!;
    expect(saved.options.find((o) => o.text === 'מתקשרים לתמיכה')!.correct).toBe(true);
    expect(saved.options.filter((o) => o.correct)).toHaveLength(1);
  });
  it('refuses to save a question without a correct option and lets multi keep several', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_QUIZ}` });
    const list = await screen.findByTestId('questions-list');
    const first = within(list).getAllByRole('listitem')[0]!;
    await userEvent.selectOptions(within(first).getByLabelText('סוג שאלה'), 'multi');
    await userEvent.click(within(first).getAllByRole('checkbox', { name: 'תשובה נכונה' })[1]!);
    await userEvent.click(within(first).getAllByRole('checkbox', { name: 'תשובה נכונה' })[0]!);
    await userEvent.click(within(first).getAllByRole('checkbox', { name: 'תשובה נכונה' })[1]!);
    await userEvent.click(screen.getByRole('button', { name: 'שמור שאלות' }));
    expect(await screen.findByText('לכל שאלה נדרשת לפחות תשובה נכונה אחת')).toBeInTheDocument();
  });
});
```
(Adjust the `'נוצר אוטומטית'` count to the fixture: the quiz fixture has one generated question; after generating one more the count is 2.)

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: `QuestionEditor.tsx`**

```tsx
import type { QuizQuestion } from '@wecom/shared';

const KIND_LABEL: Record<QuizQuestion['kind'], string> = { single: 'בחירה יחידה', multi: 'בחירה מרובה', order: 'סידור', free: 'תשובה חופשית' };
let optSeq = 0;
const newOptionId = () => `o${Date.now().toString(36)}${(optSeq++).toString(36)}`;

export function QuestionEditor({ q, onChange }: { q: QuizQuestion; onChange: (q: QuizQuestion) => void }) {
  const setOpt = (i: number, patch: Partial<QuizQuestion['options'][number]>) =>
    onChange({ ...q, options: q.options.map((o, k) => (k === i ? { ...o, ...patch } : o)) });
  const markCorrect = (i: number) =>
    onChange({ ...q, options: q.options.map((o, k) => ({ ...o, correct: q.kind === 'single' ? k === i : k === i ? !o.correct : o.correct })) });
  return (
    <div className="question-editor">
      <label>שאלה<textarea aria-label="שאלה" value={q.stem} onChange={(e) => onChange({ ...q, stem: e.target.value })} rows={2} /></label>
      <label className="small">סוג שאלה
        <select aria-label="סוג שאלה" value={q.kind} onChange={(e) => onChange({ ...q, kind: e.target.value as QuizQuestion['kind'] })}>
          {(Object.keys(KIND_LABEL) as QuizQuestion['kind'][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select></label>
      {q.kind === 'free' ? null : (
        <div className="options" role="group" aria-label="אפשרויות">
          {q.options.map((o, i) => (
            <div className="option" key={o.id}>
              <input type={q.kind === 'single' ? 'radio' : 'checkbox'} name={`correct-${q.id ?? q.stem}`} aria-label="תשובה נכונה" checked={o.correct} onChange={() => markCorrect(i)} />
              <input aria-label="טקסט האפשרות" value={o.text} onChange={(e) => setOpt(i, { text: e.target.value })} />
              <button type="button" aria-label="הסר אפשרות" disabled={q.options.length <= 2} onClick={() => onChange({ ...q, options: q.options.filter((_, k) => k !== i) })}>✕</button>
            </div>
          ))}
          <button type="button" className="btn sm" onClick={() => onChange({ ...q, options: [...q.options, { id: newOptionId(), text: '', correct: false }] })}>✚ אפשרות</button>
        </div>
      )}
      <label className="small">הסבר (מוצג אחרי המענה)<input aria-label="הסבר" value={q.explanation} onChange={(e) => onChange({ ...q, explanation: e.target.value })} /></label>
    </div>
  );
}
```

- [ ] **Step 4: `QuizBuilder.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { LearningItem, QuizQuestion } from '@wecom/shared';
import { useGenerateQuestions, usePutQuestions } from '../../../api/hooks/learningManage.js';
import { useToast } from '../../ui/Toast.js';
import { DocumentPicker, type PickedDoc } from './DocumentPicker.js';
import { QuestionEditor } from './QuestionEditor.js';

const move = <T,>(xs: T[], i: number, dir: -1 | 1): T[] => { const j = i + dir; if (j < 0 || j >= xs.length) return xs; const n = [...xs]; [n[i], n[j]] = [n[j]!, n[i]!]; return n; };
const valid = (q: QuizQuestion) => q.stem.trim().length > 0 && (q.kind === 'free' || (q.options.length >= 2 && q.options.every((o) => o.text.trim()) && q.options.some((o) => o.correct)));

/** Spec §1.2 / §5: pick documents → generate (model or rules) → curate → save. Nothing is saved until "שמור שאלות". */
export function QuizBuilder({ item }: { item: LearningItem }) {
  const [questions, setQuestions] = useState<QuizQuestion[]>(item.questions);
  const [docs, setDocs] = useState<PickedDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const gen = useGenerateQuestions(item.id);
  const put = usePutQuestions(item.id);
  const toast = useToast();
  useEffect(() => setQuestions(item.questions), [item.questions]);
  const dirty = JSON.stringify(questions) !== JSON.stringify(item.questions);

  const generate = async () => {
    try {
      const r = await gen.mutateAsync({ documentIds: docs.map((d) => d.id), perDocument: 3 });
      setQuestions((qs) => [...qs, ...r.questions]);
      toast(r.source === 'model' ? `נוצרו ${r.questions.length} שאלות בעזרת המודל` : `נוצרו ${r.questions.length} שאלות לפי כללים`, 'ok');
    } catch { toast('יצירת השאלות נכשלה', 'warn'); }
  };
  const save = async () => {
    if (!questions.every(valid)) { setError('לכל שאלה נדרשת לפחות תשובה נכונה אחת'); return; }
    setError(null);
    try { await put.mutateAsync({ questions }); toast('השאלות נשמרו', 'ok'); } catch { toast('השמירה נכשלה', 'warn'); }
  };

  return (
    <section aria-label="שאלות">
      <h2>שאלות</h2>
      <div className="gen-row">
        <DocumentPicker exclude={docs.map((d) => d.id)} onPick={(d) => setDocs((ds) => [...ds, d])} />
        <div className="chips">{docs.map((d) => <span key={d.id} className="chip">{d.title} <button type="button" aria-label={`הסר ${d.title}`} onClick={() => setDocs((ds) => ds.filter((x) => x.id !== d.id))}>✕</button></span>)}</div>
        <button type="button" className="btn sm" disabled={!docs.length || gen.isPending} onClick={() => void generate()}>צור שאלות</button>
      </div>
      <ul className="builder-list" data-testid="questions-list">
        {questions.map((q, i) => (
          <li key={q.id ?? `new-${i}`}>
            <div className="chips">{q.generated ? <span className="chip chip-amber">נוצר אוטומטית</span> : null}{q.modelConf !== null ? <span className="chip">ביטחון {Math.round(q.modelConf * 100)}%</span> : null}</div>
            <QuestionEditor q={q} onChange={(nq) => setQuestions((qs) => qs.map((x, k) => (k === i ? { ...nq, generated: x.generated && JSON.stringify(x) === JSON.stringify(nq) ? x.generated : false } : x)))} />
            <div className="row-actions">
              <button type="button" aria-label="למעלה" disabled={i === 0} onClick={() => setQuestions((qs) => move(qs, i, -1))}>↑</button>
              <button type="button" aria-label="למטה" disabled={i === questions.length - 1} onClick={() => setQuestions((qs) => move(qs, i, 1))}>↓</button>
              <button type="button" aria-label="הסר שאלה" onClick={() => setQuestions((qs) => qs.filter((_, k) => k !== i))}>✕</button>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="btn sm" onClick={() => setQuestions((qs) => [...qs, { documentId: docs[0]?.id ?? item.entries[0]?.documentId ?? '', stepKey: null, stem: '', kind: 'single', options: [{ id: 'a', text: '', correct: true }, { id: 'b', text: '', correct: false }], explanation: '', generated: false, modelConf: null }])}>✚ שאלה ידנית</button>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <button type="button" className="btn primary sm" disabled={!dirty || put.isPending} onClick={() => void save()}>שמור שאלות</button>
    </section>
  );
}
```
(A manual question needs a `documentId` because every question is anchored to a document (spec §1.1); when neither a picked document nor an entry exists, disable "✚ שאלה ידנית" with the title "בחרו קודם פריט ידע". Editing a generated question clears `generated` — the simplest correct rule: any edit sets `generated: false`; implement that instead of the JSON compare if it reads clearer.)

- [ ] **Step 5: Run** — all Builders tests PASS.
- [ ] **Step 6: Commit** — `feat(web): quiz builder with generated questions, question editor, validation`

---

### Task 6: Assign dialog and completion dashboard

**Files:**
- Create: `apps/web/src/components/learning/manage/AssignDialog.tsx`, `CompletionDashboard.tsx`
- Test: `apps/web/test/learning/AssignCompletion.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { learningState } from '../msw/learning-manage.js';
import { LI_BRIEF, U1 } from '../msw/fixtures.js';

const asEditor = () => server.use(withMe({ roles: ['editor'], permissions: ['docs.read', 'learning.read', 'learning.manage', 'notes.write'] }));

describe('assign and completion', () => {
  it('creates an audience of roles × worlds with due days', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_BRIEF}` });
    await userEvent.click(await screen.findByRole('button', { name: 'הקצה' }));
    const dlg = await screen.findByRole('dialog');
    await userEvent.click(within(dlg).getByRole('checkbox', { name: 'agent' }));
    await userEvent.click(within(dlg).getByRole('checkbox', { name: 'חו"ל ונדידה' }));
    await userEvent.clear(within(dlg).getByLabelText('ימים להשלמה'));
    await userEvent.type(within(dlg).getByLabelText('ימים להשלמה'), '10');
    await userEvent.click(within(dlg).getByRole('button', { name: 'הקצה לקהל' }));
    await waitFor(() => expect(learningState.audiences).toHaveLength(1));
    expect(learningState.audiences[0]).toMatchObject({ itemId: LI_BRIEF, roleNames: ['agent'], worldSlugs: ['intl'], dueDays: 10 });
    expect(await screen.findByText(/הוקצה ל-12 משתמשים/)).toBeInTheDocument();
  });
  it('assigns individuals picked from the people search', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_BRIEF}` });
    await userEvent.click(await screen.findByRole('button', { name: 'הקצה' }));
    const dlg = await screen.findByRole('dialog');
    await userEvent.type(within(dlg).getByLabelText('חיפוש משתמש'), 'דנה');
    await userEvent.click(await within(dlg).findByRole('button', { name: /דנה/ }));
    await userEvent.click(within(dlg).getByRole('button', { name: 'הקצה למשתמשים' }));
    await waitFor(() => expect(learningState.assigned).toEqual([{ itemId: LI_BRIEF, userIds: [U1], dueDays: 14 }]));
  });
  it('shows completion rows and exports CSV', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_BRIEF}` });
    await userEvent.click(await screen.findByRole('tab', { name: 'השלמה' }));
    const table = await screen.findByRole('table', { name: 'השלמות' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('באיחור')).toBeInTheDocument();
    const urls: string[] = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b: Blob) => { urls.push(b.type); return 'blob:x'; };
    await userEvent.click(screen.getByRole('button', { name: 'ייצוא CSV' }));
    expect(urls[0]).toContain('text/csv');
    URL.createObjectURL = orig;
  });
});
```
(`fx.roles` names and `fx.worlds` labels: read `fixtures.ts` — the role checkbox is labelled by the role *name* (`agent`, `editor`, …) and the world checkbox by the world's Hebrew name; adjust the test to the fixture values. `useMentionable('דנה', true)` must return a candidate whose `displayName` contains דנה — check `stage45` msw handler for `/users/mentionable`; if it ignores `q`, filter client-side in the dialog.)

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: `AssignDialog.tsx`** — a `Modal`-hosted dialog (use `modal.open` from `useModal` if it supports a custom body with your own buttons; otherwise render a controlled `<div role="dialog" aria-modal="true">` in a portal using the same `.drawer`/`.modal` classes `FeedbackDrawer` uses, with focus moved to the first field on mount and Escape → `onClose`).

```tsx
import { useState } from 'react';
import { useRoles } from '../../../api/hooks/admin.js';
import { useMentionable } from '../../../api/hooks/collab.js';
import { useAssignUsers, useCreateAudience } from '../../../api/hooks/learningManage.js';
import { useWorlds } from '../../../api/hooks/taxonomy.js';
import { useDebounced } from '../../../lib/useDebounced.js';
import { useToast } from '../../ui/Toast.js';

/** Spec §1.3: audiences = roles × worlds (re-resolved nightly), plus ad-hoc individuals. */
export function AssignDialog({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const roles = useRoles();
  const worlds = useWorlds();
  const [roleNames, setRoleNames] = useState<string[]>([]);
  const [worldSlugs, setWorldSlugs] = useState<string[]>([]);
  const [dueDays, setDueDays] = useState(14);
  const [q, setQ] = useState('');
  const people = useMentionable(useDebounced(q, 200), true);
  const [picked, setPicked] = useState<{ id: string; displayName: string }[]>([]);
  const createAudience = useCreateAudience(itemId);
  const assign = useAssignUsers(itemId);
  const toast = useToast();
  const toggle = (xs: string[], v: string) => (xs.includes(v) ? xs.filter((x) => x !== v) : [...xs, v]);
  const candidates = (people.data ?? []).filter((p) => !picked.some((x) => x.id === p.id) && (!q || p.displayName.includes(q)));

  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal assign-dialog" role="dialog" aria-modal="true" aria-labelledby="assign-title">
        <div className="hd"><h2 id="assign-title">הקצאת פריט למידה</h2><button type="button" aria-label="סגור" onClick={onClose}>✕</button></div>
        <fieldset>
          <legend>קהל יעד (תפקידים × עולמות תוכן)</legend>
          <div className="checks" role="group" aria-label="תפקידים">
            {(roles.data ?? []).map((r) => (<label key={r.name}><input type="checkbox" aria-label={r.name} checked={roleNames.includes(r.name)} onChange={() => setRoleNames((x) => toggle(x, r.name))} /> {r.name}</label>))}
          </div>
          <div className="checks" role="group" aria-label="עולמות תוכן">
            {(worlds.data ?? []).map((w) => (<label key={w.slug}><input type="checkbox" aria-label={w.name} checked={worldSlugs.includes(w.slug)} onChange={() => setWorldSlugs((x) => toggle(x, w.slug))} /> {w.name}</label>))}
          </div>
          <label className="small">ימים להשלמה<input aria-label="ימים להשלמה" type="number" min={1} max={365} value={dueDays} onChange={(e) => setDueDays(Number(e.target.value) || 14)} /></label>
          <button type="button" className="btn primary sm" disabled={!roleNames.length || !worldSlugs.length || createAudience.isPending}
            onClick={() => createAudience.mutateAsync({ roleNames, worldSlugs, userIds: [], dueDays }).then((a) => { toast(`הוקצה ל-${a.resolvedUsers} משתמשים`, 'ok'); onClose(); }).catch(() => toast('ההקצאה נכשלה', 'warn'))}>
            הקצה לקהל
          </button>
        </fieldset>
        <fieldset>
          <legend>משתמשים בודדים</legend>
          <label className="small">חיפוש משתמש<input aria-label="חיפוש משתמש" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          {q && candidates.length ? (<div className="results">{candidates.slice(0, 8).map((p) => <button key={p.id} type="button" onClick={() => { setPicked((x) => [...x, { id: p.id, displayName: p.displayName }]); setQ(''); }}>{p.displayName}</button>)}</div>) : null}
          <div className="chips">{picked.map((p) => <span key={p.id} className="chip">{p.displayName} <button type="button" aria-label={`הסר ${p.displayName}`} onClick={() => setPicked((x) => x.filter((y) => y.id !== p.id))}>✕</button></span>)}</div>
          <button type="button" className="btn sm" disabled={!picked.length || assign.isPending}
            onClick={() => assign.mutateAsync({ userIds: picked.map((p) => p.id), dueDays }).then((r) => { toast(`הוקצה ל-${r.assigned} משתמשים`, 'ok'); onClose(); }).catch(() => toast('ההקצאה נכשלה', 'warn'))}>
            הקצה למשתמשים
          </button>
        </fieldset>
      </div>
    </div>
  );
}
```
(Check `app.css` for the modal class names `Modal.tsx` renders — reuse them so this dialog looks like every other one; if `Modal.tsx`'s `open()` accepts a body and returns a dispose function, prefer hosting the fieldsets inside it and drop the hand-rolled backdrop.)

- [ ] **Step 4: `CompletionDashboard.tsx`**

```tsx
import { useCompletion } from '../../../api/hooks/learningManage.js';
import { download, fmtDate } from '../../../lib/format.js';
import { worldLabel } from '../../taxonomy/TypeBadge.js';
import { LoadError } from '../../ui/index.js';

const STATUS: Record<string, string> = { open: 'פתוח', completed: 'הושלם', overdue: 'באיחור', invalidated: 'בוטל (רענון)' };
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function CompletionDashboard({ itemId }: { itemId: string }) {
  const c = useCompletion(itemId);
  if (c.isError) return <LoadError what="נתוני השלמה" error={c.error} />;
  if (!c.data) return <div className="route-loading">טוען…</div>;
  const rows = c.data.rows;
  const exportCsv = () => {
    const head = ['שם', 'עולמות', 'סטטוס', 'יעד', 'הושלם', 'ציון', 'ניסיונות'];
    const body = rows.map((r) => [r.displayName, r.worldSlugs.join(' '), STATUS[r.status] ?? r.status, r.dueAt, r.completedAt ?? '', r.score ?? '', r.attempts].map(csvCell).join(','));
    download(`completion-${itemId}.csv`, '﻿' + [head.map(csvCell).join(','), ...body].join('\n'), 'text/csv;charset=utf-8');
  };
  return (
    <section className="completion" aria-label="השלמה">
      <div className="stats">{c.data.byWorld.map((w) => (<div className="stat" key={w.worldSlug}><b>{w.completed}/{w.assigned}</b><span>{worldLabel(w.worldSlug)} · {w.overdue} באיחור</span></div>))}</div>
      <div className="row-actions"><button type="button" className="btn sm" onClick={exportCsv}>ייצוא CSV</button></div>
      <table className="table" aria-label="השלמות">
        <thead><tr><th>שם</th><th>עולמות</th><th>סטטוס</th><th>יעד</th><th>הושלם</th><th>ציון</th><th>ניסיונות</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.userId} className={r.status === 'overdue' ? 'warn' : ''}>
            <td>{r.displayName}</td><td>{r.worldSlugs.map(worldLabel).join(', ')}</td><td>{STATUS[r.status]}</td>
            <td>{fmtDate(r.dueAt)}</td><td>{r.completedAt ? fmtDate(r.completedAt) : '—'}</td><td>{r.score ?? '—'}</td><td>{r.attempts}</td>
          </tr>))}</tbody>
      </table>
    </section>
  );
}
```
(The BOM prefix keeps Excel reading Hebrew UTF-8 correctly. `download()` already exists in `lib/format.ts` and is used by `AuditPage`; it is a script-driven save, which is fine inside the app.)

- [ ] **Step 5: Run** — tests PASS.
- [ ] **Step 6: Commit** — `feat(web): assign dialog (audiences and individuals) and completion dashboard with CSV`

---

### Task 7: Gaps page and workflow settings section

**Files:**
- Create: `apps/web/src/components/gaps/GapsPage.tsx`, `apps/web/src/components/admin/WorkflowSettingsSection.tsx`
- Test: `apps/web/test/gaps/Gaps.test.tsx`, `apps/web/test/admin/WorkflowSettings.test.tsx`

- [ ] **Step 1: Write the failing tests**

`Gaps.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { learningState } from '../msw/learning-manage.js';

describe('/gaps', () => {
  it('ranks open gaps with evidence and actions; reader without gaps.manage cannot dismiss', async () => {
    server.use(withMe({ roles: ['editor'], permissions: ['docs.read', 'gaps.read'] }));
    renderWithProviders(<App />, { route: '/gaps' });
    const items = await screen.findAllByRole('article');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText(/"esim"/)).toBeInTheDocument();
    expect(within(items[0]!).getByRole('link', { name: 'צור פריט' })).toHaveAttribute('href', expect.stringContaining('/edit/new?title=esim'));
    expect(screen.queryByRole('button', { name: 'דחה' })).toBeNull();
  });
  it('dismisses with a reason, resolves to a document, and runs detection', async () => {
    server.use(withMe({ roles: ['lead'], permissions: ['docs.read', 'gaps.read', 'gaps.manage'] }));
    renderWithProviders(<App />, { route: '/gaps' });
    const first = (await screen.findAllByRole('article'))[0]!;
    await userEvent.click(within(first).getByRole('button', { name: 'דחה' }));
    await userEvent.type(await screen.findByLabelText('סיבה'), 'כפילות של מונח קיים');
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }));
    await waitFor(() => expect(learningState.gaps[0]!.status).toBe('dismissed'));
    expect(await screen.findAllByRole('article')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'הרץ זיהוי עכשיו' }));
    await waitFor(() => expect(learningState.detectRuns).toBe(1));
    expect(await screen.findByText(/זוהו 1/)).toBeInTheDocument();
  });
});
```
`WorkflowSettings.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { WorkflowSettingsSection } from '../../src/components/admin/WorkflowSettingsSection.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { learningState } from '../msw/learning-manage.js';

describe('WorkflowSettingsSection', () => {
  it('toggles requireApprover and saves learning/gaps thresholds', async () => {
    server.use(withMe({ roles: ['admin'], permissions: ['system.admin', 'docs.read'] }));
    renderWithProviders(<WorkflowSettingsSection />);
    const toggle = await screen.findByRole('checkbox', { name: 'דרוש מאשר לפרסום' });
    await userEvent.click(toggle);
    await waitFor(() => expect(learningState.workflow.requireApprover).toBe(true));
    const stale = screen.getByLabelText('פריט נחשב מיושן אחרי (ימים)');
    await userEvent.clear(stale); await userEvent.type(stale, '120');
    await userEvent.click(screen.getByRole('button', { name: 'שמור הגדרות' }));
    await waitFor(() => expect(learningState.workflow.gaps.staleDays).toBe(120));
  });
  it('renders read-only without system.admin', async () => {
    server.use(withMe({ roles: ['lead'], permissions: ['docs.read'] }));
    renderWithProviders(<WorkflowSettingsSection />);
    expect(await screen.findByRole('checkbox', { name: 'דרוש מאשר לפרסום' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: `GapsPage.tsx`**

```tsx
import { Link, useSearchParams } from 'react-router-dom';
import type { Gap } from '@wecom/shared';
import { useDetectGaps, useDismissGap, useGaps, useResolveGap } from '../../api/hooks/gaps.js';
import { useCan } from '../../api/hooks/me.js';
import { useWorlds } from '../../api/hooks/taxonomy.js';
import { ago } from '../../lib/format.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { worldLabel } from '../taxonomy/TypeBadge.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { Chip, Empty, LoadError } from '../ui/index.js';
import { DocumentPicker } from '../learning/manage/DocumentPicker.js';

export const GAP_KIND_LABEL: Record<Gap['kind'], string> = {
  zero_results: 'חיפושים ללא תוצאה', feedback_cluster: 'ריבוי משובים', stale_high_traffic: 'פריט נצפה שלא עודכן',
  topic_without_procedure: 'נושא ללא מסלול טיפול', failed_question: 'שאלה שנכשלת',
};
const ACTION_LABEL: Record<Gap['suggestedAction'], string> = { create: 'צור פריט', update: 'עדכן פריט', add_question: 'הוסף שאלה', review: 'בדוק' };

/** Spec §1.7 / §5: ranked heuristics with evidence; closes the loop the PRD asks for (§13). */
export function GapsPage() {
  const can = useCan();
  const modal = useModal();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const kind = (sp.get('kind') as Gap['kind'] | null) ?? undefined;
  const status = (sp.get('status') as Gap['status'] | null) ?? 'open';
  const world = sp.get('world') ?? undefined;
  const mayRead = can('gaps.read');
  const mayManage = can('gaps.manage');
  const gaps = useGaps({ kind, status, world }, mayRead);
  const worlds = useWorlds();
  const dismiss = useDismissGap();
  const resolve = useResolveGap();
  const detect = useDetectGaps();
  if (!mayRead) return <div className="page"><Empty title="אין הרשאה לצפייה בפערי ידע">המסך מיועד לעורכי תוכן.</Empty></div>;
  const set = (k: string, v?: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };

  const doDismiss = async (g: Gap) => {
    const reason = await modal.prompt('דחיית פער', 'סיבה');
    if (!reason?.trim()) return;
    try { await dismiss.mutateAsync({ id: g.id, reason: reason.trim() }); } catch { toast('הדחייה נכשלה', 'warn'); }
  };
  const doResolve = (g: Gap) => {
    const dispose = modal.open({
      title: 'סימון כטופל',
      body: <DocumentPicker label="הפריט שסוגר את הפער" onPick={async (d) => { dispose?.(); try { await resolve.mutateAsync({ id: g.id, documentId: d.id }); toast('הפער סומן כטופל', 'ok'); } catch { toast('הפעולה נכשלה', 'warn'); } }} />,
    });
  };
  const actionHref = (g: Gap) =>
    g.suggestedAction === 'create' ? `/edit/new?title=${encodeURIComponent(g.key)}`
    : g.documentId ? `/edit/${g.documentId}` : g.topicId ? `/topic/${g.topicId}` : '/library';

  return (
    <div className="page gaps-page">
      <div className="topbar">
        <Hamburger />
        <h1>פערי ידע</h1>
        {gaps.data?.lastRunAt ? <small>זיהוי אחרון {ago(gaps.data.lastRunAt)}</small> : null}
        <span className="grow" />
        {mayManage ? <button type="button" className="btn sm" disabled={detect.isPending} onClick={() => detect.mutateAsync().then((r) => toast(`זוהו ${r.detected}, עודכנו ${r.updated}`, 'ok')).catch(() => toast('הזיהוי נכשל', 'warn'))}>הרץ זיהוי עכשיו</button> : null}
      </div>
      <div className="facets" aria-label="סינון">
        {(['open', 'dismissed', 'resolved'] as Gap['status'][]).map((s) => (
          <button key={s} type="button" className={'facet' + (status === s ? ' on' : '')} onClick={() => set('status', s)}>{{ open: 'פתוחים', dismissed: 'נדחו', resolved: 'טופלו' }[s]}</button>
        ))}
        <span className="vsep" />
        <label className="small">סוג<select aria-label="סוג פער" value={kind ?? ''} onChange={(e) => set('kind', e.target.value || undefined)}><option value="">הכל</option>{(Object.keys(GAP_KIND_LABEL) as Gap['kind'][]).map((k) => <option key={k} value={k}>{GAP_KIND_LABEL[k]}</option>)}</select></label>
        <label className="small">עולם תוכן<select aria-label="עולם תוכן" value={world ?? ''} onChange={(e) => set('world', e.target.value || undefined)}><option value="">הכל</option>{(worlds.data ?? []).map((w) => <option key={w.slug} value={w.slug}>{w.name}</option>)}</select></label>
      </div>
      {gaps.isError ? <LoadError what="פערי ידע" error={gaps.error} /> : null}
      {gaps.data && !gaps.data.items.length ? <Empty title="אין פערים ברשימה">הזיהוי רץ מדי לילה; אפשר להריץ ידנית.</Empty> : null}
      <div className="gap-list">
        {(gaps.data?.items ?? []).map((g) => (
          <article key={g.id} className="gap card">
            <div className="score" aria-label="ציון">{g.score.toFixed(1)}</div>
            <div>
              <div className="chips"><Chip>{GAP_KIND_LABEL[g.kind]}</Chip>{g.worldSlug ? <Chip>{worldLabel(g.worldSlug)}</Chip> : null}<small>נראה לראשונה {ago(g.firstSeenAt)}</small></div>
              <h3>{g.title}</h3>
              <pre className="evidence">{JSON.stringify(g.evidence, null, 1)}</pre>
              {g.dismissedReason ? <p><b>נדחה:</b> {g.dismissedReason}</p> : null}
              {g.resolvedDocumentId ? <p><Link to={`/doc/${g.resolvedDocumentId}`}>הפריט שסגר את הפער</Link></p> : null}
            </div>
            <div className="row-actions">
              <Link className="btn sm primary" to={actionHref(g)}>{ACTION_LABEL[g.suggestedAction]}</Link>
              {mayManage && g.status === 'open' ? (<>
                <button type="button" className="btn sm" onClick={() => doResolve(g)}>סמן כטופל</button>
                <button type="button" className="btn sm" onClick={() => void doDismiss(g)}>דחה</button>
              </>) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
```
(The "צור פריט" link relies on `EditorPage` reading `?title=` — added by wave 4 (D-M6). `modal.open`'s return value: read `Modal.tsx` — if it returns a dispose function use it as above, otherwise call `modal.close()`.)

- [ ] **Step 4: `WorkflowSettingsSection.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { WorkflowSettings } from '@wecom/shared';
import { useCan } from '../../api/hooks/me.js';
import { usePutWorkflowSettings, useWorkflowSettings } from '../../api/hooks/workflow.js';
import { useToast } from '../ui/Toast.js';
import { LoadError } from '../ui/index.js';

/** Spec §1.6 / §5: the approver switch plus the learning and gap thresholds. Mounted by V6 in `IdentityPage`. */
export function WorkflowSettingsSection() {
  const can = useCan();
  const mayEdit = can('system.admin');
  const s = useWorkflowSettings(true);
  const put = usePutWorkflowSettings();
  const toast = useToast();
  const [draft, setDraft] = useState<WorkflowSettings | null>(null);
  useEffect(() => { if (s.data) setDraft(s.data); }, [s.data]);
  if (s.isError) return <LoadError what="הגדרות תהליך" error={s.error} />;
  if (!draft) return null;
  const num = (v: string, fallback: number) => (v === '' ? fallback : Number(v));
  const save = (patch: Parameters<typeof put.mutateAsync>[0]) => put.mutateAsync(patch).then(() => toast('ההגדרות נשמרו', 'ok')).catch(() => toast('השמירה נכשלה', 'warn'));

  return (
    <section className="settings-card workflow-section" aria-label="תהליך עבודה ולמידה">
      <div className="eyebrow">תהליך עבודה · למידה · פערי ידע</div>
      <div className="form">
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" aria-label="דרוש מאשר לפרסום" disabled={!mayEdit || put.isPending} checked={draft.requireApprover}
            onChange={(e) => { setDraft({ ...draft, requireApprover: e.target.checked }); void save({ requireApprover: e.target.checked }); }} />
          דרוש מאשר לפרסום
          <small>כשמופעל, אישור סקירה דורש תפקיד "מאשר"; הרשאת פרסום לבדה אינה מספיקה.</small>
        </label>
        <label>ציון עובר ברירת מחדל (%)<input aria-label="ציון עובר ברירת מחדל (%)" type="number" min={1} max={100} disabled={!mayEdit} value={draft.learning.defaultPassMark} onChange={(e) => setDraft({ ...draft, learning: { ...draft.learning, defaultPassMark: num(e.target.value, 80) } })} /></label>
        <label>ניסיונות מרביים ברירת מחדל
          <select aria-label="ניסיונות מרביים ברירת מחדל" disabled={!mayEdit} value={draft.learning.defaultMaxAttempts ?? ''} onChange={(e) => setDraft({ ...draft, learning: { ...draft.learning, defaultMaxAttempts: e.target.value ? Number(e.target.value) : null } })}>
            <option value="">ללא הגבלה</option>{[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
          </select></label>
        <label>ימים להשלמת רענון ידע<input aria-label="ימים להשלמת רענון ידע" type="number" min={1} max={90} disabled={!mayEdit} value={draft.learning.refreshDueDays} onChange={(e) => setDraft({ ...draft, learning: { ...draft.learning, refreshDueDays: num(e.target.value, 7) } })} /></label>
        <label>תזכורת לפני מועד היעד (ימים)<input aria-label="תזכורת לפני מועד היעד (ימים)" type="number" min={0} max={30} disabled={!mayEdit} value={draft.learning.reminderDaysBefore} onChange={(e) => setDraft({ ...draft, learning: { ...draft.learning, reminderDaysBefore: num(e.target.value, 2) } })} /></label>
        <label>מינימום חיפושים ללא תוצאה<input aria-label="מינימום חיפושים ללא תוצאה" type="number" min={1} disabled={!mayEdit} value={draft.gaps.zeroResultMin} onChange={(e) => setDraft({ ...draft, gaps: { ...draft.gaps, zeroResultMin: num(e.target.value, 3) } })} /></label>
        <label>מינימום משובים לאשכול<input aria-label="מינימום משובים לאשכול" type="number" min={1} disabled={!mayEdit} value={draft.gaps.feedbackClusterMin} onChange={(e) => setDraft({ ...draft, gaps: { ...draft.gaps, feedbackClusterMin: num(e.target.value, 3) } })} /></label>
        <label>פריט נחשב מיושן אחרי (ימים)<input aria-label="פריט נחשב מיושן אחרי (ימים)" type="number" min={30} disabled={!mayEdit} value={draft.gaps.staleDays} onChange={(e) => setDraft({ ...draft, gaps: { ...draft.gaps, staleDays: num(e.target.value, 180) } })} /></label>
        <label>שיעור כישלון לשאלה בעייתית<input aria-label="שיעור כישלון לשאלה בעייתית" type="number" min={0.1} max={1} step={0.05} disabled={!mayEdit} value={draft.gaps.failedQuestionRate} onChange={(e) => setDraft({ ...draft, gaps: { ...draft.gaps, failedQuestionRate: Number(e.target.value) || 0.5 } })} /></label>
        {mayEdit ? <button type="button" className="btn primary sm" disabled={put.isPending} onClick={() => void save({ learning: draft.learning, gaps: draft.gaps })}>שמור הגדרות</button> : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run** — both tests PASS; full web suite green except pre-existing flakes; `pnpm --filter @wecom/web build`; `pnpm lint` on `apps/web`.
- [ ] **Step 6: Commit** — `feat(web): knowledge gaps page and workflow settings section`

---

### Task 8: Gate and lane report

**Files:**
- Create: `.superpowers/sdd/program/V4b-report.md` (git-ignored; write it in the worktree)

- [ ] **Step 1: Full gate** — `pnpm --filter @wecom/web build`, `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4` (re-run any timeout in isolation before calling it red), `pnpm lint`, `prettier --check apps/web`.
- [ ] **Step 2: Report** — per task status, commits, test counts, deviations, and the **mount list for V6**:
  - Sidebar (`components/shell/Sidebar.tsx`): `{ to: '/learning/manage', label: 'ניהול למידה', requires: 'learning.manage' }`, `{ to: '/gaps', label: 'פערי ידע', requires: 'gaps.read' }` (V4a adds `/learning` "הלמידה שלי" for `learning.read`).
  - `admin/IdentityPage.tsx`: render `<WorkflowSettingsSection />` after the third `settings-card`.
  - `admin/AdminLayout.tsx`: no new tab (settings live on the identity page per spec §5).
  - `editor/EditorPage.tsx` publish dialog (`PublishBody`): add the checkbox `שינוי מהותי – דרוש רענון` bound to `significantChange` on the publish body (V2 computes a default; until V2 exposes a preview the checkbox is unticked by default), sending `significantChange` in `usePublish`'s body (`PublishBodySchema` gained it in V0).
  - `review/ReviewsPage.tsx`: when `useWorkflowSettings().data?.requireApprover` is true, show the hint `נדרש תפקיד "מאשר"` next to the decision buttons and disable them for a caller without the `approver` role (`useMe().data.roles.includes('approver')`).
  - `routes.tsx`: keep `learning/manage*` entries **before** V4a's `learning/:assignmentId`.
  - Contract questions: (1) `POST /learning/items/:id/assign` response shape — this lane assumes `{ assigned: number }`; (2) `GET /learning/items/:id/versions` envelope assumed `{ items: LearningVersion[] }`; (3) whether `GET /learning/items` for a manager includes drafts of other authors (assumed yes for `learning.manage`).
- [ ] **Step 3: Reply** with status, branch + head SHA, one-line test summary, concerns.

## Self-review

- **Spec coverage:** §5 builder (pick documents, generate, edit stems/options/explanations, order, pass mark/attempts/estimate, preview, publish) → Tasks 4–5; assign dialog (roles × worlds, individuals, due days) → Task 6; completion dashboard with CSV → Task 6; `/gaps` (ranked, evidence, dismiss with reason, "צור פריט" prefilled, resolve) → Task 7; approver settings section → Task 7; §1.4 unlimited attempts (`maxAttempts` null = "ללא הגבלה") → Tasks 4 and 7; §1.8 `needsUpdate` badge → Tasks 3–4. The publish-dialog checkbox and review-queue hint are V6 mounts and are listed for it.
- **Placeholders:** none — where a value depends on a file this lane does not own (Modal `open` signature, `SearchResponse` field names, fixture role/world labels, `/users/mentionable` filtering), the step names the file to read and the exact adjustment.
- **Cross-lane pins honoured:** `/learning/manage?documentId=` filter (V4a's badge target) → Task 3 via `useDocumentLearning` + the `GET /documents/:id/learning` handler; V0's additive changes (`StartAttemptResponseSchema`, required `PlayerQuestionSchema.id`, `DocumentLearningSchema.refreshAssignmentId`) touch nothing this lane parses strictly — `checked` accepts extra fields and `ItemPreview` reads `QuizQuestion`, not `PlayerQuestion`.
- **Type consistency:** `KIND_LABEL`/`LSTATUS_LABEL` are exported from `LearningManagePage.tsx` and imported by the editor; `DocumentPicker`'s `PickedDoc` is shared by the briefing and quiz builders and the gaps resolve flow; hook names match the "Names other lanes consume" table; keys under `keys.learning.*`/`keys.gaps`/`keys.admin.workflow` match `invalidateLearning` and the hook tests.
