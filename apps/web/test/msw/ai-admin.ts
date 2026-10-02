/**
 * msw handlers for the wave 6 admin/AI routes (`docs/api/CONTRACTS-wave6.md`, the X0/X1/X2/X3 rows
 * the admin page and the two chat mounts call).
 *
 * State is mutable so a test can assert what the UI actually sent — `lastPut`, `lastTest`,
 * `reindexQueued`, `deleted` — and is reset between tests by `resetAiAdminState()`, which
 * `handlers.ts`'s `resetState()` calls.
 *
 * Every fixture here is parsed against the `@wecom/shared` wave 6 schema by
 * `test/ai/fixtures.test.ts`, so a handler cannot drift from the contract silently.
 */
import { http, HttpResponse, type RequestHandler } from 'msw';
import type {
  AiMessage,
  AiSettings,
  AiSettingVersion,
  Conversation,
  EvalRun,
  ModelSlot,
  ModelTestResult,
  SuggestionAnalytics,
} from '@wecom/shared';

const B = '/api/v1';
const T = '2026-09-15T08:00:00.000Z';
export const CONV_1 = 'd0000000-0000-4000-8000-000000000001';
export const MSG_1 = 'e0000000-0000-4000-8000-000000000001';
export const MSG_2 = 'e0000000-0000-4000-8000-000000000002';
export const USER_A = 'f0000000-0000-4000-8000-00000000000a';
export const DOC_1 = '10000000-0000-4000-8000-000000000001';
export const RUN_1 = '20000000-0000-4000-8000-000000000001';

export const sampleSettings = (over: Partial<AiSettings> = {}): AiSettings => ({
  brief: { text: 'wecom היא חברת תקשורת; הנציגים משרתים לקוחות פרטיים.', version: 2 },
  style: { text: 'משפטים קצרים, גוף שני, בלי סלנג.', version: 1 },
  models: {
    tier: 1,
    suggestModel: 'dictalm2.0-instruct:7b-q4_K_M',
    chatModel: 'dictalm2.0-instruct:7b-q4_K_M',
    embedModel: 'bge-m3',
    embedDimension: 1024,
  },
  limits: { chatPerUserPerHour: 60, maxContextChars: 24000 },
  ...over,
});

export const sampleVersions = (): AiSettingVersion[] => [
  {
    key: 'ai.brief',
    version: 2,
    value: { text: 'wecom היא חברת תקשורת; הנציגים משרתים לקוחות פרטיים.' },
    updatedBy: USER_A,
    updatedByName: 'נועה',
    updatedAt: T,
  },
  {
    key: 'ai.brief',
    version: 1,
    value: { text: 'wecom היא חברת תקשורת.' },
    updatedBy: USER_A,
    updatedByName: 'נועה',
    updatedAt: '2026-09-14T08:00:00.000Z',
  },
  {
    key: 'ai.style',
    version: 1,
    value: { text: 'משפטים קצרים, גוף שני, בלי סלנג.' },
    updatedBy: USER_A,
    updatedByName: 'נועה',
    updatedAt: T,
  },
];

export const sampleModelTest = (slot: ModelSlot): ModelTestResult =>
  slot === 'embed'
    ? { slot, tag: 'bge-m3', reachable: true, sizeBytes: 1_200_000_000, dims: 1024 }
    : {
        slot,
        tag: 'dictalm2.0-instruct:7b-q4_K_M',
        reachable: true,
        sizeBytes: 4_400_000_000,
        tokensPerSec: 4.2,
      };

export const sampleEvalRun = (over: Partial<EvalRun> = {}): EvalRun => ({
  id: RUN_1,
  model: 'dictalm2.0-instruct:7b-q4_K_M',
  promptVersion: 'v3.2.1',
  embedModel: 'bge-m3',
  startedAt: T,
  finishedAt: '2026-09-15T08:12:00.000Z',
  cases: 40,
  hitTarget: 0.78,
  hitType: 0.85,
  contentOverlap: 0.61,
  precision: 0.962,
  languageFailures: 3,
  notes: '',
  ...over,
});

export const sampleAnalytics = (over: Partial<SuggestionAnalytics> = {}): SuggestionAnalytics => ({
  total: 120,
  byType: [
    { key: 'update-step', total: 70, accepted: 40, edited: 20, rejected: 10, pending: 0 },
    { key: 'new-card', total: 30, accepted: 12, edited: 6, rejected: 12, pending: 0 },
    { key: 'deprecate-step', total: 20, accepted: 15, edited: 0, rejected: 5, pending: 0 },
  ],
  bySource: [{ key: 'נוהל eSIM.docx', total: 60, accepted: 35, edited: 15, rejected: 10, pending: 0 }],
  byModel: [
    {
      key: 'dictalm2.0-instruct:7b-q4_K_M',
      total: 120,
      accepted: 67,
      edited: 26,
      rejected: 27,
      pending: 0,
    },
  ],
  byPromptVersion: [{ key: 'v3.2.1', total: 120, accepted: 67, edited: 26, rejected: 27, pending: 0 }],
  rates: { accepted: 0.56, edited: 0.22, rejected: 0.22 },
  meanMinutesToDecision: 95,
  ...over,
});

export const sampleConversation = (over: Partial<Conversation> = {}): Conversation => ({
  id: CONV_1,
  kind: 'workspace',
  documentId: DOC_1,
  documentTitle: 'טיפול באיטיות גלישה',
  sourceRevisionId: null,
  userId: USER_A,
  userName: 'נועה',
  title: 'קיצור סעיף 3',
  model: 'dictalm2.0-instruct:7b-q4_K_M',
  promptVersion: 'v3.2.1',
  messageCount: 2,
  createdAt: T,
  updatedAt: T,
  ...over,
});

export const sampleMessages = (): AiMessage[] => [
  {
    id: MSG_1,
    conversationId: CONV_1,
    seq: 1,
    role: 'user',
    content: 'קצר את סעיף 3',
    toolCalls: [],
    toolResults: [],
    proposedEditsId: null,
    refinedSuggestionId: null,
    tokensIn: 12,
    tokensOut: 0,
    latencyMs: 0,
    model: 'dictalm2.0-instruct:7b-q4_K_M',
    promptVersion: 'v3.2.1',
    feedback: null,
    createdAt: T,
  },
  {
    id: MSG_2,
    conversationId: CONV_1,
    seq: 2,
    role: 'assistant',
    content: 'הצעתי לקצר את שלב 3א ולמזג את 3ב.',
    toolCalls: [{ id: 'tc1', name: 'propose_source_edit', args: { anchor: '§3' } }],
    toolResults: [{ id: 'tc1', name: 'propose_source_edit', ok: true, summary: '2 שינויים' }],
    proposedEditsId: null,
    refinedSuggestionId: null,
    tokensIn: 900,
    tokensOut: 80,
    latencyMs: 14_000,
    model: 'dictalm2.0-instruct:7b-q4_K_M',
    promptVersion: 'v3.2.1',
    feedback: 'up',
    createdAt: T,
  },
];

export const aiAdminState = {
  settings: sampleSettings(),
  versions: sampleVersions(),
  evalRuns: [sampleEvalRun()] as EvalRun[],
  conversations: [sampleConversation()] as Conversation[],
  messages: { [CONV_1]: sampleMessages() } as Record<string, AiMessage[]>,
  deleted: [] as string[],
  reindexQueued: 0,
  evalQueued: 0,
  lastPut: null as unknown,
  lastTest: null as ModelSlot | null,
  exportCalls: 0,
  /** How many times the admin conversation *list* was fetched — the debounce is asserted on it. */
  listCalls: 0,
  /** The query string the list / export last asked with (wave Y: `q` and `page` are asserted). */
  lastListQuery: null as Record<string, string> | null,
  lastExportQuery: null as Record<string, string> | null,
  analytics: sampleAnalytics(),
  /** The query string the analytics tab last asked with, so a filter can be asserted end to end. */
  lastAnalyticsQuery: null as Record<string, string> | null,
};

export const resetAiAdminState = (): void => {
  aiAdminState.settings = sampleSettings();
  aiAdminState.versions = sampleVersions();
  aiAdminState.evalRuns = [sampleEvalRun()];
  aiAdminState.conversations = [sampleConversation()];
  aiAdminState.messages = { [CONV_1]: sampleMessages() };
  aiAdminState.deleted = [];
  aiAdminState.reindexQueued = 0;
  aiAdminState.evalQueued = 0;
  aiAdminState.lastPut = null;
  aiAdminState.lastTest = null;
  aiAdminState.exportCalls = 0;
  aiAdminState.listCalls = 0;
  aiAdminState.lastListQuery = null;
  aiAdminState.lastExportQuery = null;
  aiAdminState.analytics = sampleAnalytics();
  aiAdminState.lastAnalyticsQuery = null;
};

const deepMerge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b))
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object'
        ? deepMerge(a[k] as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  return out;
};

export const aiAdminHandlers: RequestHandler[] = [
  http.get(`${B}/admin/ai/settings/versions`, () => HttpResponse.json({ items: aiAdminState.versions })),
  http.get(`${B}/admin/ai/settings`, () => HttpResponse.json(aiAdminState.settings)),
  http.put(`${B}/admin/ai/settings`, async ({ request }) => {
    const patch = (await request.json()) as Record<string, unknown>;
    aiAdminState.lastPut = patch;
    /*
     * The model slots are resolved from the environment at boot — the pull scripts, the embedding
     * column width and the running process all agree on that one source — so the route refuses a
     * `models` block rather than storing a row nothing reads. Mirrored here so the mock cannot
     * model a contract the server does not have.
     */
    if (patch.models)
      return HttpResponse.json(
        { code: 'MODELS_ENV_ONLY', message: 'משבצות המודלים נקבעות בתצורת השרת' },
        { status: 400 },
      );
    const merged = deepMerge(
      aiAdminState.settings as unknown as Record<string, unknown>,
      patch,
    ) as unknown as AiSettings;
    // The server bumps a version only when the text actually changed — mirror that, so the UI's
    // "גרסה N" is honest about what the save did.
    if (patch.brief && (patch.brief as { text?: string }).text !== aiAdminState.settings.brief.text)
      merged.brief.version = aiAdminState.settings.brief.version + 1;
    if (patch.style && (patch.style as { text?: string }).text !== aiAdminState.settings.style.text)
      merged.style.version = aiAdminState.settings.style.version + 1;
    aiAdminState.settings = merged;
    return HttpResponse.json(merged);
  }),
  http.post(`${B}/admin/ai/models/test`, async ({ request }) => {
    const { slot } = (await request.json()) as { slot: ModelSlot };
    aiAdminState.lastTest = slot;
    return HttpResponse.json(sampleModelTest(slot));
  }),
  http.post(`${B}/admin/ai/eval`, () => {
    aiAdminState.evalQueued += 1;
    return HttpResponse.json({ queued: true, jobId: 'job-eval-1' }, { status: 202 });
  }),
  http.get(`${B}/admin/ai/eval/runs`, () => HttpResponse.json({ items: aiAdminState.evalRuns })),
  http.post(`${B}/admin/ai/reindex`, () => {
    aiAdminState.reindexQueued += 1;
    return HttpResponse.json({ queued: true, jobId: 'job-reindex-1' }, { status: 202 });
  }),
  http.get(`${B}/suggestions/analytics`, ({ request }) => {
    aiAdminState.lastAnalyticsQuery = Object.fromEntries(new URL(request.url).searchParams);
    return HttpResponse.json(aiAdminState.analytics);
  }),
  // Before `/admin/ai/conversations`, or the export path would be read as a conversation id.
  http.get(`${B}/admin/ai/conversations/export.jsonl`, ({ request }) => {
    aiAdminState.exportCalls += 1;
    aiAdminState.lastExportQuery = Object.fromEntries(new URL(request.url).searchParams);
    const lines = aiAdminState.conversations
      .filter((c) => !aiAdminState.deleted.includes(c.id))
      .map((c) => JSON.stringify({ conversation: c, messages: aiAdminState.messages[c.id] ?? [] }));
    return new HttpResponse(lines.join('\n') + '\n', {
      headers: { 'content-type': 'application/x-ndjson' },
    });
  }),
  http.get(`${B}/admin/ai/conversations`, ({ request }) => {
    const u = new URL(request.url);
    // `ConversationsQuerySchema`'s fields and no others. There is deliberately no `feedback`
    // here: the real route has no such parameter, and a mock that invents one lets a UI filter
    // pass its test while doing nothing against the server (X6 fix wave — B-I3).
    aiAdminState.listCalls += 1;
    aiAdminState.lastListQuery = Object.fromEntries(u.searchParams);
    const userId = u.searchParams.get('userId');
    const documentId = u.searchParams.get('documentId');
    const q = u.searchParams.get('q')?.toLowerCase();
    const page = Number(u.searchParams.get('page') ?? 1);
    const pageSize = Number(u.searchParams.get('pageSize') ?? 50);
    let items = aiAdminState.conversations.filter((c) => !aiAdminState.deleted.includes(c.id));
    if (userId) items = items.filter((c) => c.userId === userId || c.userName.includes(userId));
    if (documentId) items = items.filter((c) => c.documentId === documentId);
    // Wave Y (B-M12): `q` matches message bodies, as the route does.
    if (q)
      items = items.filter((c) =>
        (aiAdminState.messages[c.id] ?? []).some((m) => m.content.toLowerCase().includes(q)),
      );
    return HttpResponse.json({
      items: items.slice((page - 1) * pageSize, page * pageSize),
      total: items.length,
      page,
      pageSize,
    });
  }),
  http.delete(`${B}/admin/ai/conversations/:id`, ({ params }) => {
    aiAdminState.deleted.push(String(params.id));
    return new HttpResponse(null, { status: 204 });
  }),
  /*
   * X6: X4a's `ai-handlers.ts` group stubs the same path for the chat panes' own conversations.
   * This resolver answers only for the ids this group seeded and returns `undefined` otherwise,
   * which msw 2 treats as "try the next handler" — so both lanes keep their fixtures.
   */
  http.get(`${B}/ai/conversations/:id`, ({ params }) => {
    const c = aiAdminState.conversations.find((x) => x.id === params.id);
    if (!c) return undefined;
    if (aiAdminState.deleted.includes(c.id))
      return HttpResponse.json({ code: 'NOT_FOUND', message: 'לא נמצא' }, { status: 404 });
    return HttpResponse.json({ conversation: c, messages: aiAdminState.messages[c.id] ?? [] });
  }),
];
