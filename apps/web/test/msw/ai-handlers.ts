/**
 * msw handlers for the wave 6 chat, proposed-edit and structured-suggestion routes
 * (`docs/api/CONTRACTS-wave6.md`, X2/X3 rows). Mutable state so tests assert what the UI sent;
 * `scriptStream(events)` replaces the default SSE script for the next send. Reset with
 * `resetAiState()`.
 *
 * Anchors are paragraph refs in `htmlToParagraphs` form (`§h2-1.p-1`), never DOM ids — the
 * sanitizer strips `id` attributes, so there is nothing in the document to look up.
 */
import { http, HttpResponse, type RequestHandler } from 'msw';
import type {
  AiMessage,
  ChatEvent,
  Conversation,
  ProposedEdits,
  StructuredEdit,
  Suggestion,
  SuggestionAnalytics,
} from '@wecom/shared';
import { fx } from './fixtures.js';

const B = '/api/v1';
const T = '2026-09-15T09:00:00.000Z';

export const CONV_1 = 'e0000000-0000-4000-8000-000000000001';
export const MSG_1 = 'e0000000-0000-4000-8000-000000000101';
export const MSG_2 = 'e0000000-0000-4000-8000-000000000102';
export const PE_1 = 'e0000000-0000-4000-8000-000000000201';
export const SUG_AFFECTS = 'e0000000-0000-4000-8000-000000000301';
export const DOC_1 = fx.docBrowsing.id;

/** The source HTML the workspace tests seed, and the anchors the default ops point at. */
export const SOURCE_HTML =
  '<h2>בדיקת מהירות גלישה</h2><p>יש לוודא חיבור לרשת לפני הבדיקה.</p><p>פסקה כפולה.</p>';
export const ANCHOR_P1 = '§h2-1.p-1';
export const ANCHOR_P2 = '§h2-1.p-2';
export const BASE_SOURCE_VERSION = 3;

export const sampleConversation = (over: Partial<Conversation> = {}): Conversation => ({
  id: CONV_1,
  kind: 'workspace',
  documentId: DOC_1,
  documentTitle: fx.docBrowsing.title,
  sourceRevisionId: null,
  userId: fx.me.user.id,
  userName: fx.me.user.displayName,
  title: 'סביבת עבודה · ' + fx.docBrowsing.title,
  model: 'dictalm2.0-instruct:7b-q4_K_M',
  promptVersion: 'v3.1.1',
  messageCount: 2,
  createdAt: T,
  updatedAt: T,
  ...over,
});

const msg = (over: Partial<AiMessage> = {}): AiMessage => ({
  id: MSG_1,
  conversationId: CONV_1,
  seq: 1,
  role: 'user',
  content: 'מה משתנה אם אקצר את סעיף 3?',
  toolCalls: [],
  toolResults: [],
  proposedEditsId: null,
  refinedSuggestionId: null,
  tokensIn: 0,
  tokensOut: 0,
  latencyMs: 0,
  model: null,
  promptVersion: null,
  feedback: null,
  createdAt: T,
  ...over,
});

export const sampleProposedEdits = (over: Partial<ProposedEdits> = {}): ProposedEdits => ({
  id: PE_1,
  messageId: MSG_2,
  documentId: DOC_1,
  baseSourceVersion: BASE_SOURCE_VERSION,
  ops: [
    {
      id: 'op-1',
      anchor: ANCHOR_P1,
      kind: 'replace',
      before: 'יש לוודא חיבור לרשת לפני הבדיקה.',
      after: 'ודא חיבור לרשת לפני הבדיקה.',
    },
    { id: 'op-2', anchor: ANCHOR_P2, kind: 'delete', before: 'פסקה כפולה.', after: '' },
  ],
  status: 'proposed',
  decidedBy: null,
  decidedAt: null,
  resultingSourceVersion: null,
  ...over,
});

/** The default reply: one tool round-trip, two tokens, one proposed-edit set, done. */
export const DEFAULT_SCRIPT: ChatEvent[] = [
  { type: 'tool_call', id: 't1', name: 'read_impact', args: { documentId: DOC_1 } },
  { type: 'tool_result', id: 't1', name: 'read_impact', ok: true, summary: '3 מסמכים, בלוק משותף אחד' },
  { type: 'token', text: 'קיצור סעיף 3 ' },
  { type: 'token', text: 'משפיע על שלושה מסמכים.' },
  {
    type: 'proposed_edits',
    proposedEditsId: PE_1,
    documentId: DOC_1,
    baseSourceVersion: BASE_SOURCE_VERSION,
    ops: sampleProposedEdits().ops,
  },
  { type: 'done', messageId: MSG_2, tokensIn: 812, tokensOut: 96, latencyMs: 4200 },
];

export const suggestionWithAffects = (): Suggestion => ({
  ...(fx.suggestions[0] as Suggestion),
  id: SUG_AFFECTS,
  payload: {
    type: 'update-step',
    addActions: ['ודא שהלקוח מנותק מ-Wi-Fi לפני הבדיקה', 'בקש מהלקוח להריץ Speedtest'],
    replaceActions: [{ id: 'a1', text: 'עדכן את הלקוח שהקו תקין' }],
    outcomes: [{ kind: 'ok', text: 'הקו תקין — סיים שיחה' }],
    branch: { q: 'האם המהירות מעל 6 מגה?', options: [{ kind: 'if', label: 'כן', text: 'סיים שיחה' }] },
    patch: { hint: 'לבדוק גם חיבור קווי' },
  },
  editedPayload: null,
  status: 'pending',
  affects: [
    { kind: 'document', id: fx.docIntl.id, title: fx.docIntl.title, why: 'משתמש בבלוק המשותף' },
    { kind: 'block', id: fx.blocks[0]!.id, title: fx.blocks[0]!.title, why: 'הבלוק שהשלב מטמיע' },
    { kind: 'field', id: 'crm-status', title: 'סטטוס לקוח', why: 'שדה CRM שהשלב קורא' },
  ],
  promptVersion: 'v3.1.1',
  model: 'dictalm2.0-instruct:7b-q4_K_M',
  editDiff: null,
  appliedParts: null,
});

const sampleAnalytics = (): SuggestionAnalytics => ({
  total: 4,
  byType: [{ key: 'update-step', total: 4, accepted: 2, edited: 1, rejected: 1, pending: 0 }],
  bySource: [],
  byModel: [],
  byPromptVersion: [],
  rates: { accepted: 0.5, edited: 0.25, rejected: 0.25 },
  meanMinutesToDecision: 12,
});

interface AiState {
  conversations: Conversation[];
  messages: AiMessage[];
  proposedEdits: ProposedEdits[];
  suggestions: Suggestion[];
  sent: { conversationId: string; body: unknown }[];
  decided: { id: string; body: unknown }[];
  edits: { id: string; body: StructuredEdit }[];
  accepted: { id: string; parts?: string[] }[];
  feedback: { messageId: string; rating: string; note?: string }[];
  script: ChatEvent[];
  streamStatus: number;
  /** Set by a test to make the next `decide` answer 409 `SOURCE_MOVED`. */
  decideStatus: number;
}

const initial = (): AiState => ({
  conversations: [sampleConversation()],
  messages: [
    msg({}),
    msg({
      id: MSG_2,
      seq: 2,
      role: 'assistant',
      content: 'קיצור סעיף 3 משפיע על שלושה מסמכים.',
      proposedEditsId: PE_1,
      model: 'dictalm2.0-instruct:7b-q4_K_M',
      promptVersion: 'v3.1.1',
      tokensIn: 812,
      tokensOut: 96,
      latencyMs: 4200,
    }),
  ],
  proposedEdits: [sampleProposedEdits()],
  suggestions: [suggestionWithAffects()],
  sent: [],
  decided: [],
  edits: [],
  accepted: [],
  feedback: [],
  script: DEFAULT_SCRIPT,
  streamStatus: 200,
  decideStatus: 200,
});

export const aiState: AiState = initial();

export function resetAiState(): void {
  Object.assign(aiState, initial());
}

/** Replace the SSE script for the next send (tests drive errors and long streams with it). */
export const scriptStream = (events: ChatEvent[], status = 200): void => {
  aiState.script = events;
  aiState.streamStatus = status;
};

const sse = (events: ChatEvent[]): Response => {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events)
        controller.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
      controller.close();
    },
  });
  return new HttpResponse(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  }) as unknown as Response;
};

const notFound = () => HttpResponse.json({ code: 'NOT_FOUND', message: 'לא נמצא' }, { status: 404 });

/**
 * `GET /suggestions/:id`, `PATCH /suggestions/:id/edit` and `POST /suggestions/:id/accept` are
 * registered before the stage-1 suggestion routes, so these win for the wave 6 ids. A request for
 * a suggestion this group does not own returns `undefined`, which msw treats as "try the next
 * handler" — the stage-1 handlers keep answering for their own fixtures.
 */
export const aiHandlers: RequestHandler[] = [
  http.post(`${B}/ai/conversations`, async ({ request }) => {
    const body = (await request.json()) as {
      kind: Conversation['kind'];
      documentId?: string | null;
      title?: string;
    };
    const c = sampleConversation({
      id: crypto.randomUUID(),
      kind: body.kind,
      documentId: body.documentId ?? null,
      title: body.title ?? 'שיחה חדשה',
      messageCount: 0,
    });
    aiState.conversations.push(c);
    return HttpResponse.json(c, { status: 201 });
  }),
  http.get(`${B}/ai/conversations`, ({ request }) => {
    const u = new URL(request.url);
    const documentId = u.searchParams.get('documentId');
    const kind = u.searchParams.get('kind');
    const items = aiState.conversations.filter(
      (c) => (!documentId || c.documentId === documentId) && (!kind || c.kind === kind),
    );
    return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 50 });
  }),
  http.get(`${B}/ai/conversations/:id`, ({ params }) => {
    const c = aiState.conversations.find((x) => x.id === params.id);
    if (!c) return notFound();
    return HttpResponse.json({
      conversation: c,
      messages: aiState.messages.filter((m) => m.conversationId === c.id),
    });
  }),
  http.post(`${B}/ai/conversations/:id/messages`, async ({ params, request }) => {
    const body: unknown = await request.json();
    aiState.sent.push({ conversationId: String(params.id), body });
    if (aiState.streamStatus !== 200)
      return HttpResponse.json(
        { code: 'AI_RATE_LIMITED', message: 'יותר מדי בקשות · נסה שוב בעוד דקה' },
        { status: aiState.streamStatus },
      );
    return sse(aiState.script);
  }),
  http.post(`${B}/ai/messages/:id/feedback`, async ({ params, request }) => {
    const b = (await request.json()) as { rating: string; note?: string };
    aiState.feedback.push({ messageId: String(params.id), ...b });
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(`${B}/ai/proposed-edits/:id/decide`, async ({ params, request }) => {
    const body = (await request.json()) as { accept: string[] | 'all'; reject: string[] | 'all' };
    aiState.decided.push({ id: String(params.id), body });
    if (aiState.decideStatus !== 200)
      return HttpResponse.json(
        { code: 'SOURCE_MOVED', message: 'מסמך המקור השתנה' },
        { status: aiState.decideStatus },
      );
    const pe = aiState.proposedEdits.find((p) => p.id === params.id);
    if (!pe) return notFound();
    const acceptedIds = body.accept === 'all' ? pe.ops.map((o) => o.id) : body.accept;
    const none = acceptedIds.length === 0;
    const all = acceptedIds.length === pe.ops.length;
    pe.status = none ? 'rejected' : all ? 'accepted' : 'partially_accepted';
    pe.resultingSourceVersion = none ? null : pe.baseSourceVersion + 1;
    return HttpResponse.json({ status: pe.status, resultingSourceVersion: pe.resultingSourceVersion });
  }),
  // Before `/suggestions/:id`, or the analytics path would load as a suggestion id.
  http.get(`${B}/suggestions/analytics`, () => HttpResponse.json(sampleAnalytics())),
  http.get(`${B}/suggestions/:id`, ({ params }) => {
    const s = aiState.suggestions.find((x) => x.id === params.id);
    if (s) return HttpResponse.json(s);
    const base = (fx.suggestions as Suggestion[]).find((x) => x.id === params.id);
    return base ? HttpResponse.json(base) : notFound();
  }),
  http.patch(`${B}/suggestions/:id/edit`, async ({ params, request }) => {
    const body = (await request.json()) as StructuredEdit;
    aiState.edits.push({ id: String(params.id), body });
    const s = aiState.suggestions.find((x) => x.id === params.id);
    if (!s) return notFound();
    s.editDiff = { rows: body.rows.map((r) => ({ rowId: r.rowId, op: r.op, after: String(r.value ?? '') })) };
    return HttpResponse.json(s);
  }),
  http.post(`${B}/suggestions/:id/accept`, async ({ params, request }) => {
    const s = aiState.suggestions.find((x) => x.id === params.id);
    // Not one of this group's suggestions — let the stage-1 handler answer.
    if (!s) return undefined;
    const text = await request.text();
    const body = text ? (JSON.parse(text) as { parts?: string[] }) : {};
    aiState.accepted.push({ id: String(params.id), parts: body.parts });
    s.status = 'accepted';
    s.appliedParts = body.parts ?? null;
    return HttpResponse.json(s);
  }),
];
