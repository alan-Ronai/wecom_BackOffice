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
  audiences: {
    id: string;
    itemId: string;
    roleNames: string[];
    worldSlugs: string[];
    userIds: string[];
    dueDays: number;
  }[];
  assigned: { itemId: string; userIds: string[]; dueDays?: number }[];
  published: { itemId: string; label: string }[];
  generateCalls: { itemId: string; documentIds: string[]; perDocument?: number }[];
  gaps: Gap[];
  detectRuns: number;
  workflow: WorkflowSettings;
} = {
  items: [],
  audiences: [],
  assigned: [],
  published: [],
  generateCalls: [],
  gaps: [],
  detectRuns: 0,
  workflow: fx.workflow,
};

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
  id: i.id,
  kind: i.kind,
  title: i.title,
  description: i.description,
  worldSlug: i.worldSlug,
  status: i.status,
  currentVersion: i.currentVersion,
  estimatedMinutes: i.estimatedMinutes,
  needsUpdate: i.needsUpdate,
  updatedAt: i.updatedAt,
  publishedAt: i.publishedAt,
  entryCount: i.entries.length,
  questionCount: i.questions.length,
  assignedUsers: learningState.assigned
    .filter((a) => a.itemId === i.id)
    .reduce((n, a) => n + a.userIds.length, 0),
  completionRate: i.status === 'published' ? 0.75 : null,
});

const notFound = () => HttpResponse.json({ code: 'NOT_FOUND', message: 'לא נמצא' }, { status: 404 });
const find = (id: string | readonly string[] | undefined) =>
  learningState.items.find((i) => i.id === String(id));

/** Deterministic "rules" generator: one single-choice question per document id. */
const generated = (documentIds: string[]): QuizQuestion[] =>
  documentIds.map((documentId, n) => ({
    id: `c0000000-0000-4000-8000-0000000000${(n + 16).toString(16).padStart(2, '0')}`,
    documentId,
    stepKey: 's1',
    stem: `שאלה שנוצרה ${n + 1}`,
    kind: 'single',
    options: [
      { id: 'a', text: 'נכון', correct: true },
      { id: 'b', text: 'לא נכון', correct: false },
    ],
    explanation: '',
    generated: true,
    modelConf: 0.6,
  }));

export const learningManageHandlers: RequestHandler[] = [
  http.get(`${B}/learning/items`, ({ request }) => {
    const u = new URL(request.url);
    let items = learningState.items;
    const kind = u.searchParams.get('kind');
    const status = u.searchParams.get('status');
    const world = u.searchParams.get('world');
    const q = u.searchParams.get('q');
    if (kind) items = items.filter((i) => i.kind === kind);
    if (status) items = items.filter((i) => i.status === status);
    if (world) items = items.filter((i) => i.worldSlug === world);
    if (q) items = items.filter((i) => i.title.includes(q));
    return HttpResponse.json({ items: items.map(toCard), total: items.length, page: 1, pageSize: 50 });
  }),
  http.post(`${B}/learning/items`, async ({ request }) => {
    const b = (await request.json()) as Partial<LearningItem> & {
      kind: LearningItem['kind'];
      title: string;
    };
    const item: LearningItem = {
      id: crypto.randomUUID(),
      kind: b.kind,
      title: b.title,
      description: b.description ?? '',
      worldSlug: b.worldSlug ?? null,
      status: 'draft',
      currentVersion: 0,
      passMark: b.kind === 'quiz' ? (b.passMark ?? 80) : null,
      maxAttempts: b.maxAttempts ?? null,
      estimatedMinutes: b.estimatedMinutes ?? null,
      entries: [],
      questions: [],
      sourceVersions: [],
      needsUpdate: false,
      createdBy: fx.me.user.id,
      updatedAt: T,
      publishedAt: null,
    };
    learningState.items.push(item);
    return HttpResponse.json(item, { status: 201 });
  }),
  http.get(`${B}/learning/items/:id`, ({ params }) => {
    const i = find(params.id);
    return i ? HttpResponse.json(i) : notFound();
  }),
  http.patch(`${B}/learning/items/:id`, async ({ params, request }) => {
    const i = find(params.id);
    if (!i) return notFound();
    Object.assign(i, (await request.json()) as object, { updatedAt: T });
    return HttpResponse.json(i);
  }),
  http.delete(`${B}/learning/items/:id`, ({ params }) => {
    learningState.items = learningState.items.filter((i) => i.id !== String(params.id));
    return new HttpResponse(null, { status: 204 });
  }),
  http.put(`${B}/learning/items/:id/entries`, async ({ params, request }) => {
    const i = find(params.id);
    if (!i) return notFound();
    i.entries = ((await request.json()) as { entries: LearningItem['entries'] }).entries.map((e) => ({
      ...e,
      id: e.id ?? crypto.randomUUID(),
    }));
    return HttpResponse.json(i);
  }),
  http.put(`${B}/learning/items/:id/questions`, async ({ params, request }) => {
    const i = find(params.id);
    if (!i) return notFound();
    i.questions = ((await request.json()) as { questions: QuizQuestion[] }).questions.map((q) => ({
      ...q,
      id: q.id ?? crypto.randomUUID(),
    }));
    return HttpResponse.json(i);
  }),
  http.post(`${B}/learning/items/:id/generate`, async ({ params, request }) => {
    const b = (await request.json()) as { documentIds: string[]; perDocument?: number };
    learningState.generateCalls.push({ itemId: String(params.id), ...b });
    return HttpResponse.json({ questions: generated(b.documentIds), source: 'rules', tookMs: 12 });
  }),
  http.post(`${B}/learning/items/:id/publish`, async ({ params, request }) => {
    const i = find(params.id);
    if (!i) return notFound();
    const { label } = (await request.json()) as { label: string };
    learningState.published.push({ itemId: i.id, label });
    i.status = 'published';
    i.currentVersion += 1;
    i.publishedAt = T;
    // V1 ruling: the route answers `{ item, version }`, not a bare version row.
    return HttpResponse.json({ item: i, version: i.currentVersion });
  }),
  http.get(`${B}/learning/items/:id/versions`, ({ params }) => {
    const i = find(params.id);
    if (!i) return notFound();
    return HttpResponse.json({
      items: Array.from({ length: i.currentVersion }, (_, k) => ({
        version: k + 1,
        label: `גרסה ${k + 1}`,
        authorName: 'דנה ר.',
        createdAt: T,
        sourceVersions: [],
      })),
    });
  }),
  http.post(`${B}/learning/items/:id/audiences`, async ({ params, request }) => {
    const b = (await request.json()) as {
      roleNames: string[];
      worldSlugs: string[];
      userIds: string[];
      dueDays: number;
    };
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
    // V0 shipped `AssignResultSchema { assigned, skipped }` — the call is idempotent for the caller.
    return HttpResponse.json({ assigned: b.userIds.length, skipped: 0 });
  }),
  http.get(`${B}/learning/items/:id/completion`, ({ params }) => {
    const i = find(params.id);
    if (!i) return notFound();
    return HttpResponse.json({ ...fx.completion, item: toCard(i) });
  }),
  http.get(`${B}/learning/dashboard`, () => HttpResponse.json(fx.learningDashboard)),
  /**
   * Items referencing a document (V2 route); drives the `?documentId=` filter on `/learning/manage`.
   * V4a's group may register the same path — msw takes the first match, and V6 keeps one of the two.
   */
  http.get(`${B}/documents/:id/learning`, ({ params }) => {
    const id = String(params.id);
    const items = learningState.items
      .filter(
        (i) => i.entries.some((e) => e.documentId === id) || i.questions.some((q) => q.documentId === id),
      )
      .map(toCard);
    return HttpResponse.json({
      items,
      refreshRequired: false,
      refreshAssignmentId: null,
      lastSignificantChange: null,
    });
  }),
  http.get(`${B}/gaps`, ({ request }) => {
    const u = new URL(request.url);
    const status = u.searchParams.get('status') ?? 'open';
    const kind = u.searchParams.get('kind');
    const world = u.searchParams.get('world');
    let items = learningState.gaps.filter((g) => g.status === status);
    if (kind) items = items.filter((g) => g.kind === kind);
    if (world) items = items.filter((g) => g.worldSlug === world);
    return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 50, lastRunAt: T });
  }),
  http.post(`${B}/gaps/:id/dismiss`, async ({ params, request }) => {
    const g = learningState.gaps.find((x) => x.id === String(params.id));
    if (!g) return notFound();
    g.status = 'dismissed';
    g.dismissedReason = ((await request.json()) as { reason: string }).reason;
    return HttpResponse.json(g);
  }),
  http.post(`${B}/gaps/:id/resolve`, async ({ params, request }) => {
    const g = learningState.gaps.find((x) => x.id === String(params.id));
    if (!g) return notFound();
    g.status = 'resolved';
    g.resolvedDocumentId = ((await request.json()) as { documentId: string }).documentId;
    return HttpResponse.json(g);
  }),
  http.post(`${B}/gaps/detect`, () => {
    learningState.detectRuns += 1;
    return HttpResponse.json({ detected: 1, updated: 2, resolvedAutomatically: 0, tookMs: 40 });
  }),
  http.get(`${B}/admin/workflow`, () => HttpResponse.json(learningState.workflow)),
  http.put(`${B}/admin/workflow`, async ({ request }) => {
    const patch = (await request.json()) as Partial<WorkflowSettings>;
    learningState.workflow = {
      ...learningState.workflow,
      ...patch,
      learning: { ...learningState.workflow.learning, ...(patch.learning ?? {}) },
      gaps: { ...learningState.workflow.gaps, ...(patch.gaps ?? {}) },
    };
    return HttpResponse.json(learningState.workflow);
  }),
];
