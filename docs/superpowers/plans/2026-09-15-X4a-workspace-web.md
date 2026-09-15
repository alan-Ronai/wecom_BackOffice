# X4a — Workspace Web (source editor + suggestions + chat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the combined AI workspace in `apps/web`: `/workspace/:id` with three resizable panes — the existing source editor with an inline proposed-edits diff overlay, a suggestions panel upgraded with `affects` chips, a structured (row-level) edit drawer and partial apply, and a streaming chat pane — plus the shared `ChatPane` component X4b mounts in the step editor and on the article page. All against MSW, validated at runtime against the wave 6 zod contract, left as standalone components plus lazy route entries for X6 to mount.

**Architecture:** Same shape as the wave 4/5 web lanes. Non-streaming calls go through a small typed request bridge (`apps/web/src/api/wave6.ts`) because the X2/X3 routes are not in `docs/api/openapi.json` while this lane runs; every response is parsed with `checked(...)` against `@wecom/shared` (`schemas/wave6.ts` + the additive `SuggestionSchema` fields), so a drifted fixture or backend fails at the call site. X6 swaps each non-streaming hook body to the generated `api.*` client (one line per hook; the bridge is then deleted). The chat stream is the one thing the generated client cannot model: `apps/web/src/api/aiStream.ts` reads `text/event-stream` with `fetch` + `ReadableStream`, parses each `data:` line with `ChatEventSchema`, and feeds a reducer that the `ChatPane` renders token by token. Proposed edits are applied client-side only as a *preview overlay*; the server applies them on `POST /ai/proposed-edits/:id/decide` (spec §1.3 — the chat never writes on its own). Structured suggestion edits use the row-id scheme pinned below so X3's server-side apply and this UI agree.

**Tech Stack:** React 18, TypeScript strict, React Router 6 (lazy routes), TanStack Query 5, zod 3, `@tiptap/react` via the existing `SourceEditor`, Vitest + Testing Library + MSW 2 (SSE via `ReadableStream` bodies), `@wecom/shared`.

**Spec:** `docs/superpowers/specs/2026-09-15-kb-wave6-ai-copilot-design.md` (§1.3, §1.4, §1.8, §4.2, §4.3, §5 Workspace + Suggestions, §7 isolation) and `docs/superpowers/plans/2026-09-15-X0-wave6-contracts.md` (canonical names; contract doc `docs/api/CONTRACTS-wave6.md`).

## Global Constraints

- Node `>=22`, pnpm `>=9`, TypeScript `strict: true`. Run from the repo root with `pnpm --filter @wecom/web <script>`; web tests with `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4`.
- Every request/response shape comes from `@wecom/shared` (`schemas/wave6.ts`, `schemas/pipeline.ts` after X0). Never re-declare a schema in `apps/web`. Parse every response with `checked` (or `checkedMaybe` for 204/404-null routes); parse every SSE event with `ChatEventSchema`.
- Web only: do **not** touch `apps/api/`, `packages/`, `docs/api/openapi.json`. Append-only touches to `apps/web/src/routes.tsx` (lazy `split(...)` style, one entry), `apps/web/src/api/keys.ts` (one `ai` block + two suggestion keys), `apps/web/test/msw/handlers.ts` (one import, one spread, one reset call), `apps/web/test/msw/fixtures.ts` (new exports only), `apps/web/src/styles/app.css` (one appended `/* wave 6 — X4a */` block).
- Never edit `components/shell/*`, `ArticlePage.tsx`, `EditorPage.tsx`, `SourcesPage.tsx`, `LibraryPage.tsx`, `SourceEditor.tsx`, `SuggestionCard.tsx` (reuse them as-is; X6 mounts, and the report lists every mount point).
- Permissions via `useCan()`: `ai.chat` gates the workspace route and the chat composer; `docs.edit` gates source saves and accepting proposed edits; `suggestions.review` gates structured edits and partial apply; `suggestions.apply` gates the reset/undo. Queries a caller may not run get `enabled: false` (no guaranteed-403 round trips).
- No inline `<script>` and no third-party hosts (CSP; compose e2e asserts both). Pane widths are a per-viewer convenience: `localStorage` under `kb.workspace.panes`, wrapped in try/catch, never load-bearing.
- Hebrew UI strings verbatim from this plan; RTL; real `<button>`s for every control; Enter sends, Shift+Enter inserts a newline; Escape cancels a streaming reply. Counts through `counted()`/`plural()` from `src/lib/count.ts`.
- Conventional commit per task ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Row-id scheme for structured edits (pinned; X3 must derive the same ids server-side)

`rowsOf(payload)` in `src/lib/suggestionRows.ts` returns `{ rowId, label, value }[]`:

| type | rows |
|---|---|
| `update-step` | `add-<i>` for each `addActions[i]`; `replace-<i>` for each `replaceActions[i].text`; `branch-<i>` for each `branch.options[i]` (`label — text`); `outcome-<i>` for each `outcomes[i].text`; `patch-<key>` for each `patch` key (value stringified) |
| `new-card` | `step-<p>-<s>` for each `phases[p].steps[s]` (`num title`); `title` |
| `new-step` | `action-<i>` for each `actions[i]`; `title` |
| `update-block` | `action-<i>` for each `actions[i].text`; `script` when present |
| `deprecate-step` | `reason` |
| `field-alert` | `alert` (`fieldName · issue`) |

An edit is `{ type, rows: [{ rowId, op: 'keep' | 'edit' | 'remove', value? }] }` (`StructuredEditSchema`); rows omitted are `keep`. Partial apply sends `parts: rowId[]`.

## File structure

```
apps/web/src/api/wave6.ts                                 request bridge: w6<T>(schema, method, path, {query, body}) + w6Maybe (new; X6 deletes)
apps/web/src/api/aiStream.ts                              streamChat(): fetch + ReadableStream → ChatEvent callbacks (new; stays)
apps/web/src/api/keys.ts                                  (append: ai.*, suggestion(id), suggestionAnalytics(q))
apps/web/src/api/hooks/ai.ts                              conversations, messages, send (streaming), feedback, proposed edits (new)
apps/web/src/api/hooks/suggestionsEdit.ts                 useSuggestion, useStructuredEdit, useAcceptSuggestionParts, useSuggestionAnalytics (new)
apps/web/src/lib/suggestionRows.ts                        rowsOf(payload), applyRows(payload, edit) (new)
apps/web/src/lib/chatReducer.ts                           pure reducer over ChatEvent → ChatViewState (new)
apps/web/src/lib/proposedEdits.ts                         applyOps(html, ops, accepted) → preview html; hunkAnchors (new)
apps/web/src/components/ai/ChatPane.tsx                   shared chat (new)
apps/web/src/components/ai/MessageList.tsx                messages + streaming bubble (new)
apps/web/src/components/ai/Composer.tsx                   textarea, Enter/Shift+Enter, stop button, context chip (new)
apps/web/src/components/ai/ToolCallChip.tsx               tool_call / tool_result chips (new)
apps/web/src/components/ai/ProposedEditsCard.tsx          per-op list with accept/reject/accept-all (new)
apps/web/src/components/ai/RefinedSuggestionCard.tsx      before/after summary + "החל על ההצעה" (new)
apps/web/src/components/ai/FeedbackButtons.tsx            👍/👎 + optional note (new)
apps/web/src/components/workspace/WorkspacePage.tsx       /workspace/:id — three panes, resizers, header (new)
apps/web/src/components/workspace/PaneResizer.tsx         keyboard-accessible splitter (new)
apps/web/src/components/workspace/ProposedEditsOverlay.tsx  hunk overlay above the source editor (new)
apps/web/src/components/workspace/SuggestionsPanel.tsx    list of SuggestionCard + AffectsChips + drawer + partial apply (new)
apps/web/src/components/workspace/AffectsChips.tsx        "משפיע על 3 מסמכים…" (new)
apps/web/src/components/workspace/StructuredEditDrawer.tsx  rows keep/edit/remove, per type (new)
apps/web/src/routes.tsx                                   (append 1 lazy route)
apps/web/src/styles/app.css                               (append wave 6 — X4a block)
apps/web/test/msw/ai-handlers.ts                          handler group + mutable state + scripted SSE (new)
apps/web/test/msw/fixtures.ts                             (append fx.conversation, fx.aiMessages, fx.proposedEdits, fx.suggestionsWithAffects)
apps/web/test/msw/fixtures.test.ts                        (append contract-parity cases)
apps/web/test/msw/handlers.ts                             (append import, spread, reset)
apps/web/test/ai/aiStream.test.ts                         (new)
apps/web/test/ai/chatReducer.test.ts                      (new)
apps/web/test/ai/ChatPane.test.tsx                        (new)
apps/web/test/workspace/suggestionRows.test.ts            (new)
apps/web/test/workspace/proposedEdits.test.ts             (new)
apps/web/test/workspace/ProposedEditsOverlay.test.tsx     (new)
apps/web/test/workspace/SuggestionsPanel.test.tsx         (new)
apps/web/test/workspace/WorkspacePage.test.tsx            (new)
```

## Names other lanes consume (produced here)

| Export | Path | Props / signature |
|---|---|---|
| `ChatPane` | `components/ai/ChatPane.tsx` | `{ kind: 'workspace' \| 'editor' \| 'article'; documentId: string; sourceRevisionId?: string; context?: ChatContext; readOnly?: boolean; compact?: boolean; onProposedEdits?: (pe: ProposedEdits) => void; onRefinedSuggestion?: (suggestionId: string, payload: SuggestionPayload) => void; onToolResult?: (name: AiToolName, payload: unknown, messageId: string) => void; stepIndex?: Record<string /* step num */, string /* step key */>; className?: string }` where `ChatContext = { stepKey?: string; suggestionId?: string; selection?: string }`. `onToolResult` fires once per tool result that carried a `payload`, when the reply seals (the editor dock receives `draft_step` this way — no bespoke prop). `stepIndex` feeds `renderWithStepLinks(content, documentId, stepIndex)` from `components/ai/citations.tsx` (**X4b owns that file**; X4a imports it behind a `try`-free static import only once X4b lands — until then `MessageList` renders through a local `renderAnswer` stub that X6 points at the shared helper; see Task 3). |
| `useConversationFor` | `api/hooks/ai.ts` | `(kind, documentId, opts?: { enabled?: boolean }) => { conversation: Conversation \| null; create: () => Promise<Conversation>; isPending }` — finds the caller's latest conversation of that kind for the document or creates one on first send |
| `useSendMessage` | `api/hooks/ai.ts` | `(conversationId: string \| null) => { send(body: SendMessageBody): void; stop(): void; view: ChatViewState; isStreaming: boolean; error: string \| null }` |
| `streamChat` | `api/aiStream.ts` | `(input: { conversationId: string; body: SendMessageBody; signal: AbortSignal; onEvent: (e: ChatEvent) => void }) => Promise<void>` |
| `chatReducer`, `initialChatView` | `lib/chatReducer.ts` | `(state: ChatViewState, e: ChatEvent) => ChatViewState` |
| `rowsOf`, `applyRows` | `lib/suggestionRows.ts` | `rowsOf(p: SuggestionPayload): SuggestionRow[]`; `applyRows(p, edit: StructuredEdit): SuggestionPayload` |
| `applyOps` | `lib/proposedEdits.ts` | `(html: string, ops: ProposedEditOp[], accepted: Set<string>) => string` |
| `AffectsChips` | `components/workspace/AffectsChips.tsx` | `{ affects: AffectsItem[]; compact?: boolean }` |
| `StructuredEditDrawer` | `components/workspace/StructuredEditDrawer.tsx` | `{ suggestion: Suggestion; open: boolean; onClose(): void; onSave(edit: StructuredEdit): void }` |
| `SuggestionsPanel` | `components/workspace/SuggestionsPanel.tsx` | `{ documentId: string; sourceId?: string; onAskAbout?: (suggestionId: string) => void }` |
| `ProposedEditsOverlay` | `components/workspace/ProposedEditsOverlay.tsx` | `{ documentId: string; proposed: ProposedEdits \| null; onDecided(result): void; onDismiss(): void }` |
| `WorkspacePage` | `components/workspace/WorkspacePage.tsx` | route component, `/workspace/:id` |
| Keys | `api/keys.ts` | `keys.ai.conversations(q)`, `keys.ai.conversation(id)`, `keys.ai.proposedEdits(id)`, `keys.suggestion(id)`, `keys.suggestionAnalytics(q)` |
| MSW | `test/msw/ai-handlers.ts` | `aiHandlers`, `aiState`, `resetAiState`, `scriptStream(events)`, ids `CONV_1`, `MSG_1`, `PE_1`, `SUG_AFFECTS` |

Mount points for X6 (this lane ships the pieces only): a "פתח בסביבת העבודה" button in `ArticlePage`'s header actions (editors, `can('ai.chat')`), in `EditorPage`'s toolbar next to "ערוך מקור", and on each linked document in `SourcesPage`'s side list; `keys.ai.*` invalidation on the `ai.message` SSE event in `api/events.ts` (`['ai']` prefix); X4b mounts `ChatPane` with `kind="editor"` / `kind="article"`.

---

### Task 1: Fixtures and MSW handler group with a scripted SSE stream

**Files:**
- Create: `apps/web/test/msw/ai-handlers.ts`
- Modify: `apps/web/test/msw/fixtures.ts` (append), `apps/web/test/msw/fixtures.test.ts` (append), `apps/web/test/msw/handlers.ts` (append import + spread + reset)

**Interfaces:**
- Consumes: `ConversationSchema`, `AiMessageSchema`, `ConversationDetailSchema`, `ProposedEditsSchema`, `SuggestionSchema` (with `affects`), `ChatEventSchema` from `@wecom/shared`; `fx`, `REV_1` from `./fixtures.js`; the existing suggestions fixture shape.
- Produces: `aiHandlers`, `aiState`, `resetAiState`, `scriptStream`, ids `CONV_1`, `MSG_1`, `PE_1`, `SUG_AFFECTS`.

- [ ] **Step 1: Write the failing contract-parity test** (append to `fixtures.test.ts`)

```ts
import { ConversationSchema, AiMessageSchema, ProposedEditsSchema, SuggestionSchema, ChatEventSchema } from '@wecom/shared';
import { aiState, resetAiState, DEFAULT_SCRIPT } from './ai-handlers.js';

describe('wave 6 X4a fixtures match the contract', () => {
  it('conversation, messages, proposed edits and affects parse', () => {
    resetAiState();
    expect(ConversationSchema.parse(aiState.conversations[0])).toBeTruthy();
    for (const m of aiState.messages) expect(AiMessageSchema.parse(m)).toBeTruthy();
    expect(ProposedEditsSchema.parse(aiState.proposedEdits[0])).toBeTruthy();
    const s = SuggestionSchema.parse(aiState.suggestions[0]);
    expect(s.affects.length).toBeGreaterThan(0);
  });
  it('the default stream script is a valid ChatEvent sequence ending in done', () => {
    for (const e of DEFAULT_SCRIPT) expect(ChatEventSchema.parse(e)).toBeTruthy();
    expect(DEFAULT_SCRIPT.at(-1)?.type).toBe('done');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4 msw/fixtures`. Expected: FAIL (`./ai-handlers.js` missing).

- [ ] **Step 3: Write `apps/web/test/msw/ai-handlers.ts`**

```ts
/**
 * msw handlers for the wave 6 chat, proposed-edit and structured-suggestion routes
 * (`docs/api/CONTRACTS-wave6.md`, X2/X3 rows). Mutable state so tests assert what the UI sent;
 * `scriptStream(events)` replaces the default SSE script for the next send. Reset with
 * `resetAiState()`.
 */
import { http, HttpResponse, type RequestHandler } from 'msw';
import type {
  AiMessage,
  ChatEvent,
  Conversation,
  ProposedEdits,
  Suggestion,
  StructuredEdit,
} from '@wecom/shared';
import { fx } from './fixtures.js';

const B = '/api/v1';
const T = '2026-09-15T09:00:00.000Z';
export const CONV_1 = 'e0000000-0000-4000-8000-000000000001';
export const MSG_1 = 'e0000000-0000-4000-8000-000000000101';
export const MSG_2 = 'e0000000-0000-4000-8000-000000000102';
export const PE_1 = 'e0000000-0000-4000-8000-000000000201';
export const SUG_AFFECTS = 'e0000000-0000-4000-8000-000000000301';
export const DOC_1 = fx.documents[0]!.id;

export const sampleConversation = (over: Partial<Conversation> = {}): Conversation => ({
  id: CONV_1,
  kind: 'workspace',
  documentId: DOC_1,
  sourceRevisionId: null,
  userId: fx.me.user.id,
  title: 'סביבת עבודה · ' + fx.documents[0]!.title,
  model: 'dictalm2.0-instruct:7b-q4_K_M',
  promptVersion: 'v3.1.1',
  createdAt: T,
  updatedAt: T,
  ...over,
});

const msg = (over: Partial<AiMessage>): AiMessage => ({
  id: MSG_1,
  conversationId: CONV_1,
  seq: 1,
  role: 'user',
  content: 'מה משתנה אם אקצר את סעיף 3?',
  toolCalls: null,
  toolResults: null,
  proposedEdits: null,
  refinedSuggestionId: null,
  tokensIn: 0,
  tokensOut: 0,
  latencyMs: 0,
  model: null,
  promptVersion: null,
  createdAt: T,
  ...over,
});

export const sampleProposedEdits = (over: Partial<ProposedEdits> = {}): ProposedEdits => ({
  id: PE_1,
  messageId: MSG_2,
  documentId: DOC_1,
  baseSourceVersion: 3,
  ops: [
    { id: 'op-1', anchor: 'h2-3', kind: 'replace', before: '<p>יש לוודא חיבור לרשת לפני הבדיקה.</p>', after: '<p>ודא חיבור לרשת לפני הבדיקה.</p>' },
    { id: 'op-2', anchor: 'h2-3', kind: 'delete', before: '<p>פסקה כפולה.</p>', after: '' },
  ],
  status: 'proposed',
  decidedBy: null,
  decidedAt: null,
  resultingSourceVersion: null,
  ...over,
});

/** The default reply: two tokens, one tool round-trip, one proposed-edit set, done. */
export const DEFAULT_SCRIPT: ChatEvent[] = [
  { type: 'tool_call', id: 't1', name: 'read_impact', args: { documentId: DOC_1 } },
  { type: 'tool_result', id: 't1', ok: true, summary: '3 מסמכים, בלוק משותף אחד' },
  { type: 'token', text: 'קיצור סעיף 3 ' },
  { type: 'token', text: 'משפיע על שלושה מסמכים.' },
  { type: 'proposed_edits', proposedEditsId: PE_1, ops: sampleProposedEdits().ops },
  { type: 'done', messageId: MSG_2, tokensIn: 812, tokensOut: 96, latencyMs: 4200 },
];

const suggestionWithAffects = (): Suggestion => ({
  ...(fx.suggestions[0] as Suggestion),
  id: SUG_AFFECTS,
  affects: [
    { kind: 'document', id: fx.documents[1]!.id, title: fx.documents[1]!.title, why: 'משתמש בבלוק המשותף' },
    { kind: 'block', id: fx.blocks[0]!.id, title: fx.blocks[0]!.title, why: 'הבלוק שהשלב מטמיע' },
    { kind: 'field', id: 'crm-status', title: 'סטטוס לקוח', why: 'שדה CRM שהשלב קורא' },
  ],
  promptVersion: 'v3.1.1',
  model: 'dictalm2.0-instruct:7b-q4_K_M',
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
}
const initial = (): AiState => ({
  conversations: [sampleConversation()],
  messages: [msg({}), msg({ id: MSG_2, seq: 2, role: 'assistant', content: 'קיצור סעיף 3 משפיע על שלושה מסמכים.', proposedEdits: sampleProposedEdits(), model: 'dictalm2.0-instruct:7b-q4_K_M', promptVersion: 'v3.1.1', tokensIn: 812, tokensOut: 96, latencyMs: 4200 })],
  proposedEdits: [sampleProposedEdits()],
  suggestions: [suggestionWithAffects()],
  sent: [],
  decided: [],
  edits: [],
  accepted: [],
  feedback: [],
  script: DEFAULT_SCRIPT,
  streamStatus: 200,
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
      for (const e of events) controller.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
      controller.close();
    },
  });
  return new HttpResponse(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

export const aiHandlers: RequestHandler[] = [
  http.post(`${B}/ai/conversations`, async ({ request }) => {
    const body = (await request.json()) as Partial<Conversation>;
    const c = sampleConversation({ id: crypto.randomUUID(), kind: body.kind, documentId: body.documentId ?? null, title: body.title ?? 'שיחה חדשה' });
    aiState.conversations.push(c);
    return HttpResponse.json(c, { status: 201 });
  }),
  http.get(`${B}/ai/conversations`, ({ request }) => {
    const u = new URL(request.url);
    const documentId = u.searchParams.get('documentId');
    const kind = u.searchParams.get('kind');
    const items = aiState.conversations.filter((c) => (!documentId || c.documentId === documentId) && (!kind || c.kind === kind));
    return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 50 });
  }),
  http.get(`${B}/ai/conversations/:id`, ({ params }) => {
    const c = aiState.conversations.find((x) => x.id === params.id);
    if (!c) return HttpResponse.json({ code: 'NOT_FOUND', message: 'לא נמצא' }, { status: 404 });
    return HttpResponse.json({ conversation: c, messages: aiState.messages.filter((m) => m.conversationId === c.id) });
  }),
  http.post(`${B}/ai/conversations/:id/messages`, async ({ params, request }) => {
    const body = await request.json();
    aiState.sent.push({ conversationId: String(params.id), body });
    if (aiState.streamStatus !== 200)
      return HttpResponse.json({ code: 'AI_RATE_LIMITED', message: 'יותר מדי בקשות · נסה שוב בעוד דקה' }, { status: aiState.streamStatus });
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
    const pe = aiState.proposedEdits.find((p) => p.id === params.id);
    if (!pe) return HttpResponse.json({ code: 'NOT_FOUND', message: 'לא נמצא' }, { status: 404 });
    const all = body.accept === 'all' || (Array.isArray(body.accept) && body.accept.length === pe.ops.length);
    const none = body.accept === 'all' ? false : body.accept.length === 0;
    pe.status = none ? 'rejected' : all ? 'accepted' : 'partially_accepted';
    pe.resultingSourceVersion = none ? null : pe.baseSourceVersion + 1;
    return HttpResponse.json({ status: pe.status, resultingSourceVersion: pe.resultingSourceVersion });
  }),
  http.get(`${B}/suggestions/:id`, ({ params }) => {
    const s = aiState.suggestions.find((x) => x.id === params.id) ?? (fx.suggestions as Suggestion[]).find((x) => x.id === params.id);
    return s ? HttpResponse.json(s) : HttpResponse.json({ code: 'NOT_FOUND', message: 'לא נמצא' }, { status: 404 });
  }),
  http.patch(`${B}/suggestions/:id/edit`, async ({ params, request }) => {
    const body = (await request.json()) as StructuredEdit;
    aiState.edits.push({ id: String(params.id), body });
    const s = aiState.suggestions.find((x) => x.id === params.id);
    if (!s) return HttpResponse.json({ code: 'NOT_FOUND', message: 'לא נמצא' }, { status: 404 });
    s.editDiff = { rows: body.rows.map((r) => ({ rowId: r.rowId, op: r.op, after: r.value })) };
    return HttpResponse.json(s);
  }),
  http.post(`${B}/suggestions/:id/accept`, async ({ params, request }) => {
    const text = await request.text();
    const body = text ? (JSON.parse(text) as { parts?: string[] }) : {};
    aiState.accepted.push({ id: String(params.id), parts: body.parts });
    const s = aiState.suggestions.find((x) => x.id === params.id);
    if (s) {
      s.status = 'accepted';
      s.appliedParts = body.parts;
    }
    return HttpResponse.json(s ?? {});
  }),
];
```

Append to `fixtures.ts` (exports only): `export const aiConversation = () => import('./ai-handlers.js').then((m) => m.sampleConversation());` is **not** allowed (fixtures must stay synchronous) — instead re-export the three sample builders from `ai-handlers.ts` and reference them from tests directly; `fixtures.ts` gains only `fx.suggestionsWithAffects = () => aiState.suggestions` if other suites need it (optional).

Register in `handlers.ts`: add `import { aiHandlers, resetAiState } from './ai-handlers.js';`, spread `...aiHandlers,` **before** the generic suggestion handlers (so `GET /suggestions/:id` and `PATCH /suggestions/:id/edit` win), and call `resetAiState()` inside `resetState()`.

- [ ] **Step 4: Run** — `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4 msw/fixtures` → PASS.

- [ ] **Step 5: Commit** — `test(web): wave 6 X4a msw handlers — chat SSE script, proposed edits, structured suggestion edits`

---

### Task 2: Request bridge, SSE stream reader, chat reducer, keys, hooks

**Files:**
- Create: `apps/web/src/api/wave6.ts`, `apps/web/src/api/aiStream.ts`, `apps/web/src/lib/chatReducer.ts`, `apps/web/src/api/hooks/ai.ts`, `apps/web/src/api/hooks/suggestionsEdit.ts`
- Modify: `apps/web/src/api/keys.ts` (append)
- Test: `apps/web/test/ai/aiStream.test.ts`, `apps/web/test/ai/chatReducer.test.ts`, `apps/web/test/ai/hooks.test.tsx` (create)

**Interfaces:**
- Consumes: `checked`, `checkedMaybe` from `src/api/stage45.ts`; `ApiError`, `unwrap` from `src/api/unwrap.ts`; `API_BASE` from `src/api/client.ts`; `ChatEventSchema`, `ConversationSchema`, `ConversationDetailSchema`, `ConversationsResponseSchema`, `ProposedEditsSchema`, `DecideProposedEditsResultSchema`, `SuggestionSchema`, `SuggestionAnalyticsSchema`, `StructuredEditSchema` from `@wecom/shared`.
- Produces: the hooks, `streamChat`, `chatReducer`, `initialChatView`, `ChatViewState`, and keys from the names table.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/ai/aiStream.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamChat } from '../../src/api/aiStream.js';
import type { ChatEvent } from '@wecom/shared';

const sse = (chunks: string[], status = 200, ct = 'text/event-stream') =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { status, headers: { 'content-type': ct } },
  );

afterEach(() => vi.restoreAllMocks());

describe('streamChat', () => {
  it('parses events split across chunks and validates each against ChatEventSchema', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sse(['event: token\ndata: {"type":"token","te', 'xt":"שלום"}\n\nevent: done\ndata: {"type":"done","messageId":"11111111-1111-4111-8111-111111111111","tokensIn":1,"tokensOut":1,"latencyMs":5}\n\n']),
    );
    const seen: ChatEvent[] = [];
    await streamChat({ conversationId: 'c', body: { content: 'hi' }, signal: new AbortController().signal, onEvent: (e) => seen.push(e) });
    expect(seen.map((e) => e.type)).toEqual(['token', 'done']);
    expect(seen[0]).toMatchObject({ text: 'שלום' });
  });
  it('turns a non-200 JSON error into an ApiError with the server code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'AI_RATE_LIMITED', message: 'יותר מדי' }), { status: 429, headers: { 'content-type': 'application/json' } }),
    );
    await expect(streamChat({ conversationId: 'c', body: { content: 'hi' }, signal: new AbortController().signal, onEvent: () => {} })).rejects.toMatchObject({ status: 429, code: 'AI_RATE_LIMITED' });
  });
  it('emits an error event for a malformed frame and keeps going', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse(['data: {nope}\n\n', 'data: {"type":"done","messageId":"11111111-1111-4111-8111-111111111111","tokensIn":0,"tokensOut":0,"latencyMs":0}\n\n']));
    const seen: ChatEvent[] = [];
    await streamChat({ conversationId: 'c', body: { content: 'x' }, signal: new AbortController().signal, onEvent: (e) => seen.push(e) });
    expect(seen.map((e) => e.type)).toEqual(['error', 'done']);
  });
  it('stops reading when the signal aborts', async () => {
    const ctl = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      ctl.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });
    await expect(streamChat({ conversationId: 'c', body: { content: 'x' }, signal: ctl.signal, onEvent: () => {} })).resolves.toBeUndefined();
  });
});
```

`apps/web/test/ai/chatReducer.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { chatReducer, initialChatView } from '../../src/lib/chatReducer.js';

const done = { type: 'done', messageId: '11111111-1111-4111-8111-111111111111', tokensIn: 3, tokensOut: 4, latencyMs: 9 } as const;

describe('chatReducer', () => {
  it('accumulates tokens into the streaming reply and seals it on done', () => {
    let s = initialChatView();
    s = chatReducer(s, { type: 'token', text: 'א' });
    s = chatReducer(s, { type: 'token', text: 'ב' });
    expect(s.streaming?.content).toBe('אב');
    s = chatReducer(s, done);
    expect(s.streaming).toBeNull();
    expect(s.sealed.at(-1)).toMatchObject({ messageId: done.messageId, content: 'אב', tokensOut: 4 });
  });
  it('keeps tool chips in call order and marks results', () => {
    let s = initialChatView();
    s = chatReducer(s, { type: 'tool_call', id: 't1', name: 'read_impact', args: {} });
    s = chatReducer(s, { type: 'tool_result', id: 't1', ok: true, summary: 'ok' });
    expect(s.streaming?.tools).toEqual([{ id: 't1', name: 'read_impact', args: {}, ok: true, summary: 'ok' }]);
  });
  it('attaches proposed edits and refined suggestions to the reply', () => {
    let s = initialChatView();
    s = chatReducer(s, { type: 'proposed_edits', proposedEditsId: 'p', ops: [] });
    s = chatReducer(s, { type: 'refined_suggestion', suggestionId: 's', editedPayload: { type: 'deprecate-step', reason: 'x' } });
    expect(s.streaming?.proposedEditsId).toBe('p');
    expect(s.streaming?.refined?.suggestionId).toBe('s');
  });
  it('records an error and stops streaming', () => {
    const s = chatReducer(initialChatView(), { type: 'error', code: 'AI_RATE_LIMITED', message: 'יותר מדי' });
    expect(s.error).toBe('יותר מדי');
    expect(s.streaming).toBeNull();
  });
});
```

`apps/web/test/ai/hooks.test.tsx` (hooks against msw):
```tsx
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useConversationFor, useSendMessage, useDecideProposedEdits, useMessageFeedback } from '../../src/api/hooks/ai.js';
import { useStructuredEdit, useAcceptSuggestionParts, useSuggestion } from '../../src/api/hooks/suggestionsEdit.js';
import { aiState, resetAiState, CONV_1, PE_1, SUG_AFFECTS, DOC_1, MSG_2 } from '../msw/ai-handlers.js';

const wrap = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return { qc, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> };
};

describe('wave 6 X4a hooks', () => {
  it('finds the existing workspace conversation for the document', async () => {
    resetAiState();
    const { wrapper } = wrap();
    const h = renderHook(() => useConversationFor('workspace', DOC_1), { wrapper });
    await waitFor(() => expect(h.result.current.conversation?.id).toBe(CONV_1));
  });
  it('creates a conversation on first use for a kind that has none', async () => {
    resetAiState();
    const { wrapper } = wrap();
    const h = renderHook(() => useConversationFor('article', DOC_1), { wrapper });
    await waitFor(() => expect(h.result.current.isPending).toBe(false));
    let created: { id: string } | undefined;
    await act(async () => { created = await h.result.current.create(); });
    expect(created?.id).toBeTruthy();
    expect(aiState.conversations.some((c) => c.kind === 'article' && c.documentId === DOC_1)).toBe(true);
  });
  it('send streams the scripted reply, records the body and invalidates the conversation', async () => {
    resetAiState();
    const { qc, wrapper } = wrap();
    qc.setQueryData(['ai', 'conversation', CONV_1], { conversation: aiState.conversations[0], messages: [] });
    const h = renderHook(() => useSendMessage(CONV_1), { wrapper });
    act(() => h.result.current.send({ content: 'קצר את סעיף 3', context: { selection: 'סעיף 3' } }));
    await waitFor(() => expect(h.result.current.isStreaming).toBe(false));
    expect(aiState.sent[0]?.body).toMatchObject({ content: 'קצר את סעיף 3', context: { selection: 'סעיף 3' } });
    expect(h.result.current.view.sealed.at(-1)?.content).toBe('קיצור סעיף 3 משפיע על שלושה מסמכים.');
    expect(h.result.current.view.sealed.at(-1)?.proposedEditsId).toBe(PE_1);
    expect(qc.getQueryState(['ai', 'conversation', CONV_1])?.isInvalidated).toBe(true);
  });
  it('decide sends accepted op ids and invalidates the source document', async () => {
    resetAiState();
    const { qc, wrapper } = wrap();
    qc.setQueryData(['source', DOC_1], { html: '<p>x</p>' });
    const h = renderHook(() => useDecideProposedEdits(DOC_1), { wrapper });
    await act(() => h.result.current.mutateAsync({ id: PE_1, accept: ['op-1'], reject: ['op-2'] }));
    expect(aiState.decided[0]?.body).toEqual({ accept: ['op-1'], reject: ['op-2'] });
    expect(qc.getQueryState(['source', DOC_1])?.isInvalidated).toBe(true);
  });
  it('feedback posts the rating', async () => {
    resetAiState();
    const { wrapper } = wrap();
    const h = renderHook(() => useMessageFeedback(), { wrapper });
    await act(() => h.result.current.mutateAsync({ messageId: MSG_2, rating: 'up' }));
    expect(aiState.feedback).toEqual([{ messageId: MSG_2, rating: 'up' }]);
  });
  it('structured edit and partial accept carry rows and parts', async () => {
    resetAiState();
    const { wrapper } = wrap();
    const s = renderHook(() => useSuggestion(SUG_AFFECTS), { wrapper });
    await waitFor(() => expect(s.result.current.data?.affects).toHaveLength(3));
    const e = renderHook(() => useStructuredEdit(), { wrapper });
    await act(() => e.result.current.mutateAsync({ id: SUG_AFFECTS, edit: { type: 'update-step', rows: [{ rowId: 'add-0', op: 'edit', value: 'ודא ניתוק מ-Wi-Fi' }] } }));
    expect(aiState.edits[0]?.body.rows[0]).toMatchObject({ rowId: 'add-0', op: 'edit' });
    const a = renderHook(() => useAcceptSuggestionParts(), { wrapper });
    await act(() => a.result.current.mutateAsync({ id: SUG_AFFECTS, parts: ['add-0'] }));
    expect(aiState.accepted[0]).toEqual({ id: SUG_AFFECTS, parts: ['add-0'] });
  });
});
```
(The `update-step` structured edit literal must match X0's `StructuredEditSchema` variant shape — read `packages/shared/src/schemas/pipeline.ts` after X0 lands and adjust the literal, not the assertion.)

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4 ai/`. Expected: FAIL (modules missing).

- [ ] **Step 3: Bridge** — `apps/web/src/api/wave6.ts`

```ts
/**
 * Wave 6 request bridge — TEMPORARY, for the non-streaming X2/X3 routes that are not in
 * `docs/api/openapi.json` while the web lanes run. Every call is validated at runtime with
 * `checked`/`checkedMaybe` against `@wecom/shared`. X6 replaces each hook body with the generated
 * `api.*` call and deletes this file (precedent: V4b's `wave5.ts`). The SSE chat stream is NOT
 * here — see `aiStream.ts`, which stays.
 */
import type { z } from 'zod';
import { API_BASE } from './client.js';
import { checked, checkedMaybe } from './stage45.js';

type Query = Record<string, string | number | boolean | undefined | null>;
const qs = (q?: Query): string => {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, opts: { query?: Query; body?: unknown } = {}) {
  const response = await globalThis.fetch(`${API_BASE}${path}${qs(opts.query)}`, {
    method,
    credentials: 'include',
    headers: opts.body === undefined ? {} : { 'content-type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await response.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  return response.ok ? { data: json, response } : { error: json, response };
}
export const w6 = async <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, method: Parameters<typeof call>[0], path: string, opts?: Parameters<typeof call>[2]): Promise<T> =>
  checked(schema, await call(method, path, opts)); // X6: api.*
export const w6Maybe = async <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, method: Parameters<typeof call>[0], path: string, opts?: Parameters<typeof call>[2]): Promise<T | null> =>
  checkedMaybe(schema, await call(method, path, opts)); // X6: api.*
export const w6Void = async (method: Parameters<typeof call>[0], path: string, opts?: Parameters<typeof call>[2]): Promise<void> => {
  const r = await call(method, path, opts);
  if (!r.response.ok) checked(({ safeParse: () => ({ success: true, data: undefined }) }) as never, r); // throws the typed ApiError
};
```
(If `w6Void`'s trick reads badly, implement it plainly: `if (!r.response.ok) unwrap(r);` — `unwrap` from `./unwrap.js` throws the typed `ApiError`; prefer that.)

- [ ] **Step 4: Stream reader** — `apps/web/src/api/aiStream.ts`

```ts
/**
 * Reads the chat SSE stream (`POST /ai/conversations/:id/messages`). The generated client cannot
 * consume a streaming body, so this is the one hand-written transport that stays after X6.
 *
 * Frames are `event: <type>\ndata: <json>\n\n`; only `data:` is used. Every frame is parsed with
 * `ChatEventSchema` so a server that changes shape surfaces as an `error` event, not a blank
 * bubble. A non-2xx response carries the usual JSON envelope and is thrown as `ApiError`.
 */
import { ChatEventSchema, type ChatEvent, type SendMessageBody } from '@wecom/shared';
import { API_BASE } from './client.js';
import { ApiError } from './unwrap.js';

export interface StreamChatInput {
  conversationId: string;
  body: SendMessageBody;
  signal: AbortSignal;
  onEvent: (e: ChatEvent) => void;
}

export async function streamChat({ conversationId, body, signal, onEvent }: StreamChatInput): Promise<void> {
  let res: Response;
  try {
    res = await globalThis.fetch(`${API_BASE}/ai/conversations/${conversationId}/messages`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') return;
    throw err;
  }
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { code?: string; message?: string; details?: unknown };
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? 'שגיאה', e.details);
  }
  if (!res.body) throw new ApiError(res.status, 'NO_BODY', 'השרת לא החזיר זרם');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        emit(frame, onEvent);
      }
    }
    if (buf.trim()) emit(buf, onEvent);
  } catch (err) {
    if ((err as { name?: string }).name !== 'AbortError') throw err;
  } finally {
    reader.releaseLock();
  }
}

function emit(frame: string, onEvent: (e: ChatEvent) => void): void {
  const data = frame
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .join('\n');
  if (!data) return;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    onEvent({ type: 'error', code: 'BAD_FRAME', message: 'השרת שלח תשובה לא תקינה' });
    return;
  }
  const parsed = ChatEventSchema.safeParse(json);
  onEvent(parsed.success ? parsed.data : { type: 'error', code: 'CONTRACT', message: 'תשובת השרת אינה תואמת את החוזה' });
}
```

- [ ] **Step 5: Reducer** — `apps/web/src/lib/chatReducer.ts`

```ts
import type { ChatEvent, ProposedEditOp, SuggestionPayload } from '@wecom/shared';

/** `payload` is whatever the server attaches to `tool_result` (X0's event carries an optional `payload`; when absent the chip has only a summary). */
export interface ToolChip { id: string; name: string; args: Record<string, unknown>; ok?: boolean; summary?: string; payload?: unknown }
export interface StreamingReply {
  content: string;
  tools: ToolChip[];
  proposedEditsId: string | null;
  proposedOps: ProposedEditOp[] | null;
  refined: { suggestionId: string; editedPayload: SuggestionPayload } | null;
}
export interface SealedReply extends StreamingReply { messageId: string; tokensIn: number; tokensOut: number; latencyMs: number }
export interface ChatViewState { streaming: StreamingReply | null; sealed: SealedReply[]; error: string | null }

export const initialChatView = (): ChatViewState => ({ streaming: null, sealed: [], error: null });
const fresh = (): StreamingReply => ({ content: '', tools: [], proposedEditsId: null, proposedOps: null, refined: null });

/** Pure: one event in, one view out. `sealed` grows by one on `done`; `error` ends the stream. */
export function chatReducer(s: ChatViewState, e: ChatEvent): ChatViewState {
  const cur = s.streaming ?? fresh();
  switch (e.type) {
    case 'token':
      return { ...s, streaming: { ...cur, content: cur.content + e.text }, error: null };
    case 'tool_call':
      return { ...s, streaming: { ...cur, tools: [...cur.tools, { id: e.id, name: e.name, args: e.args }] } };
    case 'tool_result':
      return { ...s, streaming: { ...cur, tools: cur.tools.map((t) => (t.id === e.id ? { ...t, ok: e.ok, summary: e.summary, payload: (e as { payload?: unknown }).payload } : t)) } };
    case 'proposed_edits':
      return { ...s, streaming: { ...cur, proposedEditsId: e.proposedEditsId, proposedOps: e.ops } };
    case 'refined_suggestion':
      return { ...s, streaming: { ...cur, refined: { suggestionId: e.suggestionId, editedPayload: e.editedPayload } } };
    case 'done':
      return { streaming: null, error: null, sealed: [...s.sealed, { ...cur, messageId: e.messageId, tokensIn: e.tokensIn, tokensOut: e.tokensOut, latencyMs: e.latencyMs }] };
    case 'error':
      return { ...s, streaming: null, error: e.message };
  }
}
```

- [ ] **Step 6: Keys** — append to `keys` in `apps/web/src/api/keys.ts`:

```ts
  /* wave 6 — AI copilot (X4a/X4b). Every key starts with 'ai' so the `ai.message` SSE event
     can drop the whole surface with one prefix invalidation. */
  ai: {
    conversations: (q: unknown = '*') => ['ai', 'conversations', q] as const,
    conversation: (id: string) => ['ai', 'conversation', id] as const,
    proposedEdits: (id: string) => ['ai', 'proposedEdits', id] as const,
  },
  /* wave 6 — structured suggestion editing (X3) */
  suggestion: (id: string) => ['suggestions', 'item', id] as const,
  suggestionAnalytics: (q: unknown = '*') => ['suggestions', 'analytics', q] as const,
```

- [ ] **Step 7: Hooks** — `apps/web/src/api/hooks/ai.ts`

```ts
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ConversationDetailSchema,
  ConversationSchema,
  ConversationsResponseSchema,
  DecideProposedEditsResultSchema,
  type Conversation,
  type ConversationKind,
  type SendMessageBody,
} from '@wecom/shared';
import { keys } from '../keys.js';
import { w6, w6Void } from '../wave6.js';
import { streamChat } from '../aiStream.js';
import { chatReducer, initialChatView, type ChatViewState } from '../../lib/chatReducer.js';
import { ApiError } from '../unwrap.js';

export const useConversations = (q: { documentId?: string; kind?: ConversationKind; mine?: boolean }, enabled = true) =>
  useQuery({
    queryKey: keys.ai.conversations(q),
    enabled,
    queryFn: async () => w6(ConversationsResponseSchema, 'GET', '/ai/conversations', { query: { ...q, pageSize: 50 } }), // X6: api.GET('/ai/conversations')
  });

export const useConversation = (id: string | null) =>
  useQuery({
    queryKey: keys.ai.conversation(id ?? ''),
    enabled: !!id,
    queryFn: async () => w6(ConversationDetailSchema, 'GET', `/ai/conversations/${id}`), // X6: api.GET('/ai/conversations/{id}')
  });

export const useCreateConversation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { kind: ConversationKind; documentId?: string; sourceRevisionId?: string; title?: string }): Promise<Conversation> =>
      w6(ConversationSchema, 'POST', '/ai/conversations', { body }), // X6: api.POST('/ai/conversations')
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ai', 'conversations'] }),
  });
};

/** The caller's latest conversation of `kind` for this document, or a `create()` to start one. */
export function useConversationFor(kind: ConversationKind, documentId: string, opts: { enabled?: boolean } = {}) {
  const list = useConversations({ documentId, kind, mine: true }, opts.enabled ?? true);
  const create = useCreateConversation();
  const conversation = useMemo(() => {
    const items = list.data?.items ?? [];
    return items.length ? [...items].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0]! : null;
  }, [list.data]);
  return {
    conversation,
    isPending: list.isPending,
    create: () => create.mutateAsync({ kind, documentId }),
  };
}

export function useSendMessage(conversationId: string | null) {
  const qc = useQueryClient();
  const [view, dispatch] = useReducer(chatReducer, undefined, initialChatView);
  const [isStreaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    ctl.current?.abort();
    ctl.current = null;
    setStreaming(false);
  }, []);
  useEffect(() => () => ctl.current?.abort(), []);

  const send = useCallback(
    (body: SendMessageBody) => {
      if (!conversationId || isStreaming) return;
      setError(null);
      setStreaming(true);
      const c = new AbortController();
      ctl.current = c;
      void streamChat({ conversationId, body, signal: c.signal, onEvent: dispatch })
        .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'השיחה נכשלה'))
        .finally(() => {
          setStreaming(false);
          if (ctl.current === c) ctl.current = null;
          void qc.invalidateQueries({ queryKey: keys.ai.conversation(conversationId) });
          void qc.invalidateQueries({ queryKey: ['ai', 'conversations'] });
        });
    },
    [conversationId, isStreaming, qc],
  );

  return { send, stop, view: view as ChatViewState, isStreaming, error: error ?? view.error };
}

export const useMessageFeedback = () =>
  useMutation({
    mutationFn: async (v: { messageId: string; rating: 'up' | 'down'; note?: string }): Promise<void> =>
      w6Void('POST', `/ai/messages/${v.messageId}/feedback`, { body: { rating: v.rating, ...(v.note ? { note: v.note } : {}) } }), // X6: api.POST
  });

export const useDecideProposedEdits = (documentId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; accept: string[] | 'all'; reject: string[] | 'all' }) =>
      w6(DecideProposedEditsResultSchema, 'POST', `/ai/proposed-edits/${v.id}/decide`, { body: { accept: v.accept, reject: v.reject } }), // X6: api.POST
    onSuccess: () => {
      // An accepted op set is a source save: version, draft and the document's review flag move.
      void qc.invalidateQueries({ queryKey: keys.source(documentId) });
      void qc.invalidateQueries({ queryKey: keys.sourceVersions(documentId) });
      void qc.removeQueries({ queryKey: keys.sourceDraft(documentId) });
      void qc.invalidateQueries({ queryKey: keys.doc(documentId) });
      void qc.invalidateQueries({ queryKey: ['ai'] });
    },
  });
};
```

`apps/web/src/api/hooks/suggestionsEdit.ts`:
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SuggestionAnalyticsSchema, SuggestionSchema, type StructuredEdit, type Suggestion } from '@wecom/shared';
import { keys } from '../keys.js';
import { w6 } from '../wave6.js';

export const useSuggestion = (id: string | null) =>
  useQuery({
    queryKey: keys.suggestion(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<Suggestion> => w6(SuggestionSchema, 'GET', `/suggestions/${id}`), // X6: api.GET('/suggestions/{id}')
  });

const useSugMutation = <V, R>(fn: (v: V) => Promise<R>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['suggestions'] });
      void qc.invalidateQueries({ queryKey: keys.sources });
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
};

export const useStructuredEdit = () =>
  useSugMutation(async (v: { id: string; edit: StructuredEdit }): Promise<Suggestion> =>
    w6(SuggestionSchema, 'PATCH', `/suggestions/${v.id}/edit`, { body: v.edit }), // X6: api.PATCH('/suggestions/{id}/edit')
  );

export const useAcceptSuggestionParts = () =>
  useSugMutation(async (v: { id: string; parts?: string[] }): Promise<Suggestion> =>
    w6(SuggestionSchema, 'POST', `/suggestions/${v.id}/accept`, { body: v.parts ? { parts: v.parts } : {} }), // X6: api.POST('/suggestions/{id}/accept')
  );

export const useSuggestionAnalytics = (q: { from?: string; to?: string; sourceId?: string; type?: string }, enabled = true) =>
  useQuery({
    queryKey: keys.suggestionAnalytics(q),
    enabled,
    queryFn: async () => w6(SuggestionAnalyticsSchema, 'GET', '/suggestions/analytics', { query: q }), // X6: api.GET('/suggestions/analytics')
  });
```

- [ ] **Step 8: Run** — `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4 ai/` → PASS; `pnpm --filter @wecom/web build` clean.

- [ ] **Step 9: Commit** — `feat(web): wave 6 chat transport — SSE reader, chat reducer, conversation/proposed-edit/structured-edit hooks`

---

### Task 3: Shared `ChatPane`

**Files:**
- Create: `apps/web/src/components/ai/ChatPane.tsx`, `MessageList.tsx`, `Composer.tsx`, `ToolCallChip.tsx`, `ProposedEditsCard.tsx`, `RefinedSuggestionCard.tsx`, `FeedbackButtons.tsx`
- Test: `apps/web/test/ai/ChatPane.test.tsx`

**Interfaces:**
- Consumes: hooks from Task 2; `useCan` from `api/hooks/me.ts`; `useToast`; `Fmt` (`components/Fmt.tsx`) for rendering Hebrew with bidi; `payloadSummary` from `components/sources/SuggestionCard.tsx` (import only).
- Produces: `ChatPane` with the props contract in the names table; `ProposedEditsCard({ ops, onAccept(ids), onReject(ids), onAcceptAll(), disabled? })`; `RefinedSuggestionCard({ suggestionId, editedPayload, onApply() })`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { ChatPane } from '../../src/components/ai/ChatPane.js';
import { aiState, resetAiState, scriptStream, DOC_1, PE_1 } from '../msw/ai-handlers.js';
import { server } from '../msw/server.js';
import { withMe } from '../msw/handlers.js';

beforeEach(() => resetAiState());

describe('ChatPane', () => {
  it('renders history, streams a reply token by token and shows tool chips', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChatPane kind="workspace" documentId={DOC_1} />);
    expect(await screen.findByText('מה משתנה אם אקצר את סעיף 3?')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'הודעה למערכת' }), 'קצר את סעיף 3');
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/read_impact|בדיקת השפעה/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('קיצור סעיף 3 משפיע על שלושה מסמכים.')).toBeInTheDocument());
    expect(aiState.sent[0]?.body).toMatchObject({ content: 'קצר את סעיף 3' });
  });
  it('Shift+Enter inserts a newline and does not send', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChatPane kind="workspace" documentId={DOC_1} />);
    const box = await screen.findByRole('textbox', { name: 'הודעה למערכת' });
    await user.type(box, 'שורה{Shift>}{Enter}{/Shift}שנייה');
    expect((box as HTMLTextAreaElement).value).toContain('\n');
    expect(aiState.sent).toHaveLength(0);
  });
  it('surfaces proposed edits as a card and calls onProposedEdits', async () => {
    const user = userEvent.setup();
    const got: string[] = [];
    renderWithProviders(<ChatPane kind="workspace" documentId={DOC_1} onProposedEdits={(pe) => got.push(pe.id)} />);
    await user.type(await screen.findByRole('textbox', { name: 'הודעה למערכת' }), 'קצר');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('region', { name: 'עריכות מוצעות' })).toBeInTheDocument();
    await waitFor(() => expect(got).toEqual([PE_1]));
  });
  it('shows a rate-limit error and re-enables the composer', async () => {
    scriptStream([], 429);
    const user = userEvent.setup();
    renderWithProviders(<ChatPane kind="workspace" documentId={DOC_1} />);
    await user.type(await screen.findByRole('textbox', { name: 'הודעה למערכת' }), 'x');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('יותר מדי בקשות');
    expect(screen.getByRole('button', { name: 'שלח' })).toBeEnabled();
  });
  it('Escape stops a streaming reply', async () => {
    scriptStream(Array.from({ length: 200 }, (_, i) => ({ type: 'token' as const, text: `t${i} ` })));
    const user = userEvent.setup();
    renderWithProviders(<ChatPane kind="workspace" documentId={DOC_1} />);
    const box = await screen.findByRole('textbox', { name: 'הודעה למערכת' });
    await user.type(box, 'x');
    await user.keyboard('{Enter}');
    fireEvent.keyDown(box, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'עצור' })).not.toBeInTheDocument());
  });
  it('is read-only for a caller without ai.chat and hidden without ai.ask', async () => {
    server.use(withMe({ permissions: ['docs.read', 'ai.ask'] }));
    renderWithProviders(<ChatPane kind="article" documentId={DOC_1} />);
    expect(await screen.findByRole('textbox', { name: 'הודעה למערכת' })).toBeInTheDocument();
    expect(screen.queryByText('עריכות מוצעות')).not.toBeInTheDocument();
    server.use(withMe({ permissions: ['docs.read'] }));
    const { container } = renderWithProviders(<ChatPane kind="article" documentId={DOC_1} />);
    await waitFor(() => expect(container.querySelector('.chat-pane')).toBeNull());
  });
  it('hands tool payloads to onToolResult when the reply seals', async () => {
    scriptStream([
      { type: 'tool_call', id: 't9', name: 'draft_step', args: {} },
      { type: 'tool_result', id: 't9', ok: true, summary: 'טיוטה', payload: { title: 'שלב חדש' } } as never,
      { type: 'done', messageId: MSG_2, tokensIn: 1, tokensOut: 1, latencyMs: 1 },
    ]);
    const user = userEvent.setup();
    const got: unknown[] = [];
    renderWithProviders(<ChatPane kind="editor" documentId={DOC_1} onToolResult={(name, payload) => got.push([name, payload])} />);
    await user.type(await screen.findByRole('textbox', { name: 'הודעה למערכת' }), 'טיוטה');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(got).toEqual([['draft_step', { title: 'שלב חדש' }]]));
  });
  it('posts feedback from the thumbs', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChatPane kind="workspace" documentId={DOC_1} />);
    await user.click(await screen.findByRole('button', { name: 'תשובה טובה' }));
    await waitFor(() => expect(aiState.feedback[0]).toMatchObject({ rating: 'up' }));
  });
});
```
(`withMe` from `test/msw/handlers.ts` overrides `/auth/me`; check its exact partial shape — `fx.me` — and pass `permissions` the way `test/feedback/*.test.tsx` does.)

- [ ] **Step 2: Run to verify failure** — `… test -- ai/ChatPane`. Expected: FAIL.

- [ ] **Step 3: Implement**

`Composer.tsx`:
```tsx
import { useRef, useState } from 'react';

export function Composer({
  disabled,
  streaming,
  contextLabel,
  onClearContext,
  onSend,
  onStop,
}: {
  disabled: boolean;
  streaming: boolean;
  contextLabel?: string;
  onClearContext?: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const submit = () => {
    const t = text.trim();
    if (!t || disabled || streaming) return;
    onSend(t);
    setText('');
  };
  return (
    <form
      className="chat-composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {contextLabel ? (
        <span className="chip chip-blue chat-context">
          {contextLabel}
          {onClearContext ? (
            <button type="button" className="linklike" aria-label="הסר הקשר" onClick={onClearContext}>
              ✕
            </button>
          ) : null}
        </span>
      ) : null}
      <textarea
        ref={ref}
        rows={2}
        dir="rtl"
        aria-label="הודעה למערכת"
        placeholder={disabled ? 'אין הרשאה לשוחח' : 'שאל, בקש שינוי, או בקש הצעות לשיפור…'}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && streaming) {
            e.preventDefault();
            onStop();
          } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="chat-composer-actions">
        <span className="small muted">Enter לשליחה · Shift+Enter לשורה חדשה</span>
        {streaming ? (
          <button type="button" className="btn sm" onClick={onStop}>
            עצור
          </button>
        ) : (
          <button type="submit" className="btn sm primary" disabled={disabled || !text.trim()}>
            שלח
          </button>
        )}
      </div>
    </form>
  );
}
```

`ToolCallChip.tsx` — a `<span className="chip chip-gray tool-chip">` with a Hebrew label map `TOOL_LABEL: Record<AiToolName, string>` (`read_document` "קריאת מסמך", `read_topic` "קריאת נושא", `search_kb` "חיפוש בספרייה", `explain_step` "הסבר שלב", `read_source` "קריאת מסמך המקור", `read_impact` "בדיקת השפעה", `list_suggestions` "רשימת הצעות", `propose_source_edit` "הצעת עריכה במקור", `refine_suggestion` "עידון הצעה", `review_document` "סקירת מסמך", `draft_step` "טיוטת שלב", `read_eval` "תוצאות הערכה"), a spinner while `ok === undefined`, ✓/✕ after, `title={summary}`.

`ProposedEditsCard.tsx`:
```tsx
import type { ProposedEditOp } from '@wecom/shared';
import { htmlToPlain } from '../../lib/proposedEdits.js';

export function ProposedEditsCard({ ops, onAccept, onReject, onAcceptAll, disabled }: {
  ops: ProposedEditOp[];
  onAccept: (ids: string[]) => void;
  onReject: (ids: string[]) => void;
  onAcceptAll: () => void;
  disabled?: boolean;
}) {
  const KIND: Record<ProposedEditOp['kind'], string> = { replace: 'החלפה', insert: 'הוספה', delete: 'מחיקה' };
  return (
    <section className="pe-card" role="region" aria-label="עריכות מוצעות">
      <div className="hd">
        <b>עריכות מוצעות במסמך המקור</b>
        <button type="button" className="btn xs primary" disabled={disabled || !ops.length} onClick={onAcceptAll}>
          קבל הכל
        </button>
      </div>
      <ol className="pe-ops">
        {ops.map((op) => (
          <li key={op.id} className={'pe-op ' + op.kind}>
            <span className="chip chip-gray">{KIND[op.kind]}</span>
            <span className="anchor">{op.anchor}</span>
            {op.before ? <del dir="rtl">{htmlToPlain(op.before)}</del> : null}
            {op.after ? <ins dir="rtl">{htmlToPlain(op.after)}</ins> : null}
            <span className="pe-actions">
              <button type="button" className="btn xs" disabled={disabled} onClick={() => onReject([op.id])}>דחה</button>
              <button type="button" className="btn xs primary" disabled={disabled} onClick={() => onAccept([op.id])}>קבל</button>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

`RefinedSuggestionCard.tsx` — `role="region" aria-label="הצעה מעודנת"`, shows `payloadSummary(editedPayload)` and a button "החל על ההצעה" calling `onApply()`.

`FeedbackButtons.tsx` — two `<button>`s `aria-label="תשובה טובה"` / `"תשובה לא טובה"`; on 👎 open a one-line `modal.prompt('מה היה חסר?', 'הערה', '')` and post with the note; after posting, render the chosen thumb as pressed (`aria-pressed`).

`MessageList.tsx` — renders history (`AiMessage[]`) then the reducer's `sealed` replies that are not yet in history (dedupe by `messageId`), then the `streaming` bubble with a caret. Assistant bubbles render `content` through `renderAnswer(content, documentId, stepIndex)` — a local function in `MessageList.tsx` that today returns `<Fmt text={content} noCrm …/>` and that X6 replaces with `renderWithStepLinks` from `components/ai/citations.tsx` (X4b's file; citations "שלב <num>" become `<Link to="/doc/:id/:stepKey">` when `stepIndex[num]` exists). `MessageList` takes `documentId` and `stepIndex` props for that reason. Tool chips above the text, then `ProposedEditsCard` / `RefinedSuggestionCard` when present, then `FeedbackButtons` (only for assistant messages with an id). `aria-live="polite"` on the streaming bubble; auto-scroll to bottom on change unless the user scrolled up (track with a ref + `scrollTop` check).

`ChatPane.tsx`:
```tsx
import { useEffect, useMemo, useState } from 'react';
import type { ProposedEdits, SuggestionPayload } from '@wecom/shared';
import { useCan } from '../../api/hooks/me.js';
import { useConversation, useConversationFor, useSendMessage, useDecideProposedEdits, useMessageFeedback } from '../../api/hooks/ai.js';
import { useStructuredEdit } from '../../api/hooks/suggestionsEdit.js';
import { useToast } from '../ui/Toast.js';
import { Composer } from './Composer.js';
import { MessageList } from './MessageList.js';

export interface ChatContext { stepKey?: string; suggestionId?: string; selection?: string }
export type ChatKind = 'workspace' | 'editor' | 'article';

const KIND_LABEL: Record<ChatKind, string> = { workspace: 'סביבת העבודה', editor: 'עורך השלבים', article: 'שאל את המערכת' };

/**
 * Shared chat pane. Which tools the model may call is decided server-side from the caller's
 * permissions; here the pane only decides whether to render at all (`ai.ask`) and whether the
 * composer writes (`ai.chat`). Nothing the model returns is applied without a click.
 */
export function ChatPane({
  kind, documentId, sourceRevisionId, context, readOnly, compact, onProposedEdits, onRefinedSuggestion, onToolResult, stepIndex, className,
}: {
  kind: ChatKind; documentId: string; sourceRevisionId?: string; context?: ChatContext; readOnly?: boolean; compact?: boolean;
  onProposedEdits?: (pe: ProposedEdits) => void; onRefinedSuggestion?: (suggestionId: string, payload: SuggestionPayload) => void;
  /** Generic hand-off for tool results that carry a payload (e.g. `draft_step` → the editor dock). */
  onToolResult?: (name: AiToolName, payload: unknown, messageId: string) => void;
  /** step num → step key, so citations like "שלב 3א" become links to `/doc/:id/:stepKey`. */
  stepIndex?: Record<string, string>;
  className?: string;
}) {
  const can = useCan();
  const mayAsk = can('ai.ask');
  const mayChat = !readOnly && can('ai.chat');
  const conv = useConversationFor(kind, documentId, { enabled: mayAsk });
  const [convId, setConvId] = useState<string | null>(null);
  useEffect(() => { if (conv.conversation) setConvId(conv.conversation.id); }, [conv.conversation]);
  const detail = useConversation(convId);
  const chat = useSendMessage(convId);
  const decide = useDecideProposedEdits(documentId);
  const refine = useStructuredEdit();
  const feedback = useMessageFeedback();
  const toast = useToast();
  const [ctx, setCtx] = useState<ChatContext | undefined>(context);
  useEffect(() => setCtx(context), [context]);

  // Hand proposed edits / refinements / tool payloads to the host as soon as the reply seals.
  const last = chat.view.sealed.at(-1);
  useEffect(() => {
    if (!last) return;
    if (last.proposedEditsId && last.proposedOps && onProposedEdits)
      onProposedEdits({ id: last.proposedEditsId, messageId: last.messageId, documentId, baseSourceVersion: -1, ops: last.proposedOps, status: 'proposed', decidedBy: null, decidedAt: null, resultingSourceVersion: null });
    if (last.refined && onRefinedSuggestion) onRefinedSuggestion(last.refined.suggestionId, last.refined.editedPayload);
    if (onToolResult)
      for (const t of last.tools) if (t.ok && t.payload !== undefined) onToolResult(t.name as AiToolName, t.payload, last.messageId);
  }, [last?.messageId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mayAsk) return null;
  const contextLabel = ctx?.suggestionId ? 'הקשר: הצעה' : ctx?.stepKey ? `הקשר: שלב ${ctx.stepKey}` : ctx?.selection ? `הקשר: "${ctx.selection.slice(0, 40)}${ctx.selection.length > 40 ? '…' : ''}"` : undefined;

  const send = async (content: string) => {
    let id = convId;
    if (!id) {
      try { id = (await conv.create()).id; setConvId(id); } catch { toast('לא ניתן לפתוח שיחה', 'warn'); return; }
    }
    // `useSendMessage` is bound to `convId`; a freshly created conversation sends on the next render.
    if (id !== convId) { queueMicrotask(() => sendRef.current?.({ content, context: ctx })); return; }
    chat.send({ content, context: ctx });
  };
  const sendRef = useRefLatest(chat.send);

  return (
    <div className={'chat-pane' + (compact ? ' compact' : '') + (className ? ' ' + className : '')} dir="rtl" aria-label={KIND_LABEL[kind]}>
      <div className="chat-head">
        <b>{KIND_LABEL[kind]}</b>
        <span className="small muted">{detail.data?.conversation.model ?? ''}</span>
      </div>
      <MessageList
        history={detail.data?.messages ?? []}
        view={chat.view}
        streaming={chat.isStreaming}
        canDecide={mayChat && can('docs.edit')}
        onAcceptOps={(peId, ids) => decide.mutate({ id: peId, accept: ids, reject: [] })}
        onRejectOps={(peId, ids) => decide.mutate({ id: peId, accept: [], reject: ids })}
        onAcceptAll={(peId) => decide.mutate({ id: peId, accept: 'all', reject: [] })}
        onApplyRefined={(sid, payload) => (onRefinedSuggestion ? onRefinedSuggestion(sid, payload) : refine.mutate({ id: sid, edit: { type: payload.type, rows: [] } as never }))}
        onFeedback={(messageId, rating, note) => feedback.mutate({ messageId, rating, note })}
      />
      {chat.error ? <div role="alert" className="chat-error">{chat.error}</div> : null}
      <Composer disabled={!mayChat && kind !== 'article'} streaming={chat.isStreaming} contextLabel={contextLabel} onClearContext={() => setCtx(undefined)} onSend={(t) => void send(t)} onStop={chat.stop} />
    </div>
  );
}

function useRefLatest<T>(v: T) { const r = useRef(v); r.current = v; return r; }
```
Notes for the implementer: `useRef` must be imported; the `onApplyRefined` fallback with `rows: []` is a no-op edit — when no host handler is given, prefer opening the `StructuredEditDrawer` (Task 5) prefilled from `editedPayload`; wire that in Task 6 and replace the fallback then. On the article page (`kind === 'article'`) a caller with only `ai.ask` may send questions (the server restricts tools), so the composer is enabled when `mayAsk` even without `ai.chat` — encode that as `disabled={!(mayChat || kind === 'article')}`.

- [ ] **Step 4: Run** — `… test -- ai/ChatPane` → PASS; build clean.

- [ ] **Step 5: Commit** — `feat(web): shared ChatPane — streaming replies, tool chips, proposed-edit and refined-suggestion cards, feedback`

---

### Task 4: Proposed-edits overlay and the workspace page shell with resizable panes

**Files:**
- Create: `apps/web/src/lib/proposedEdits.ts`, `apps/web/src/components/workspace/ProposedEditsOverlay.tsx`, `apps/web/src/components/workspace/PaneResizer.tsx`, `apps/web/src/components/workspace/WorkspacePage.tsx`
- Modify: `apps/web/src/routes.tsx` (append one lazy route)
- Test: `apps/web/test/workspace/proposedEdits.test.ts`, `apps/web/test/workspace/ProposedEditsOverlay.test.tsx`, `apps/web/test/workspace/WorkspacePage.test.tsx`

**Interfaces:**
- Consumes: `SourceEditor` (`components/source/SourceEditor.tsx`, props `{ documentId, onSaved? }`), `useSourceDocument` (`api/hooks/sourcedocs.ts`), `useDocument` (`api/hooks/documents.ts`), `useCan`, `ChatPane`, `useDecideProposedEdits`.
- Produces: `applyOps(html, ops, accepted)`, `htmlToPlain(html)`, `ProposedEditsOverlay`, `PaneResizer({ onDelta(px), label })`, `WorkspacePage`.

- [ ] **Step 1: Write the failing tests**

`proposedEdits.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { applyOps, htmlToPlain } from '../../src/lib/proposedEdits.js';

const html = '<h2 id="h2-3">בדיקה</h2><p>יש לוודא חיבור לרשת לפני הבדיקה.</p><p>פסקה כפולה.</p>';
const ops = [
  { id: 'op-1', anchor: 'h2-3', kind: 'replace' as const, before: '<p>יש לוודא חיבור לרשת לפני הבדיקה.</p>', after: '<p>ודא חיבור לרשת לפני הבדיקה.</p>' },
  { id: 'op-2', anchor: 'h2-3', kind: 'delete' as const, before: '<p>פסקה כפולה.</p>', after: '' },
  { id: 'op-3', anchor: 'h2-3', kind: 'insert' as const, before: '', after: '<p>חדש.</p>' },
];
describe('applyOps', () => {
  it('applies only accepted replace/delete ops by exact before-match', () => {
    const out = applyOps(html, ops, new Set(['op-1']));
    expect(out).toContain('ודא חיבור לרשת');
    expect(out).toContain('פסקה כפולה');
  });
  it('appends an insert after the anchor block when accepted', () => {
    const out = applyOps(html, ops, new Set(['op-3']));
    expect(out.indexOf('<p>חדש.</p>')).toBeGreaterThan(out.indexOf('בדיקה</h2>'));
  });
  it('leaves html unchanged when before does not match (stale base)', () => {
    expect(applyOps('<p>אחר</p>', ops, new Set(['op-1']))).toBe('<p>אחר</p>');
  });
  it('htmlToPlain strips tags and decodes entities', () => {
    expect(htmlToPlain('<p>a &amp; b</p>')).toBe('a & b');
  });
});
```

`ProposedEditsOverlay.test.tsx`: renders with `proposed = sampleProposedEdits()`; shows 2 hunks with "קבל"/"דחה" each and "קבל הכל"; ticking "קבל" on op-1 then "אשר החלטות" posts `{ accept: ['op-1'], reject: ['op-2'] }` (rejecting the untouched rest is explicit: the button label reads "אשר החלטות (1 מתקבלת, 1 נדחית)"); "קבל הכל" posts `{ accept: 'all', reject: [] }`; a 409 `SOURCE_MOVED` from the decide route (script it via `server.use`) shows the toast "מסמך המקור השתנה בינתיים — טען מחדש והצע שוב"; without `docs.edit` the buttons are absent and the hunks are read-only.

`WorkspacePage.test.tsx`: at `/workspace/:id` with an editor (`ai.chat`, `docs.edit`, `suggestions.review`) renders three regions `aria-label` "מסמך המקור", "הצעות", "סביבת העבודה"; the header shows the document title and a link "חזרה לפריט" to `/doc/:id`; a caller without `ai.chat` sees `Empty` "אין הרשאה לסביבת העבודה"; pressing ArrowLeft on the first resizer (`role="separator"`) changes the grid template (assert `style.gridTemplateColumns` changes); a `proposed_edits` event from the chat shows the overlay above the source editor (`findByRole('region', { name: 'עריכות מוצעות במסמך' })`).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`lib/proposedEdits.ts`:
```ts
import type { ProposedEditOp } from '@wecom/shared';

/** Strip tags and decode the five entities the sanitizer emits — for diff previews only. */
export const htmlToPlain = (html: string): string =>
  html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

/**
 * Client-side PREVIEW of accepted ops. The server is the one that applies them on
 * `POST /ai/proposed-edits/:id/decide` (with `If-Match` on the base version); this only renders what
 * the source will look like. Exact-match on `before`; an op whose `before` is absent is skipped —
 * that is the "source moved" case the server answers 409 for.
 */
export function applyOps(html: string, ops: ProposedEditOp[], accepted: ReadonlySet<string>): string {
  let out = html;
  for (const op of ops) {
    if (!accepted.has(op.id)) continue;
    if (op.kind === 'insert') {
      const at = anchorEnd(out, op.anchor);
      out = at < 0 ? out + op.after : out.slice(0, at) + op.after + out.slice(at);
    } else if (op.before && out.includes(op.before)) {
      out = out.replace(op.before, op.kind === 'delete' ? '' : op.after);
    }
  }
  return out;
}

/** Index just after the closing tag of the block whose id equals the anchor; -1 when absent. */
function anchorEnd(html: string, anchor: string): number {
  const open = html.indexOf(`id="${anchor}"`);
  if (open < 0) return -1;
  const tagStart = html.lastIndexOf('<', open);
  const tag = /<([a-z0-9]+)/i.exec(html.slice(tagStart))?.[1];
  if (!tag) return -1;
  const close = html.indexOf(`</${tag}>`, open);
  return close < 0 ? -1 : close + tag.length + 3;
}
```

`ProposedEditsOverlay.tsx` — holds `accepted: Set<string>` and `rejected: Set<string>` in state (initially empty), renders the hunk list (reuse `ProposedEditsCard`'s row markup but with tri-state per row: "קבל" toggles into `accepted`, "דחה" into `rejected`), a live preview toggle "תצוגה מקדימה" that renders `applyOps(source.html, ops, accepted)` read-only in a `<div className="prose source-html" dangerouslySetInnerHTML>` (the html came from the server-sanitized source plus server-produced ops — the same trust level `SourcePane` already renders), and a footer with "אשר החלטות (N מתקבלות, M נדחות)" → `decide.mutate({ id, accept: [...accepted], reject: [...rejected, ...untouched] })`, and "בטל" → `onDismiss()`. On 409 `SOURCE_MOVED`: toast + `onDismiss()`. `role="region" aria-label="עריכות מוצעות במסמך"`.

`PaneResizer.tsx` — `<div role="separator" aria-orientation="vertical" tabIndex={0} aria-label={label} onPointerDown … onKeyDown (ArrowLeft/ArrowRight → onDelta(∓16))>`; pointer drag calls `onDelta` with the movement.

`WorkspacePage.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ProposedEdits, SuggestionPayload } from '@wecom/shared';
import { useDocument } from '../../api/hooks/documents.js';
import { useSourceDocument } from '../../api/hooks/sourcedocs.js';
import { useCan } from '../../api/hooks/me.js';
import { SourceEditor } from '../source/SourceEditor.js';
import { ChatPane, type ChatContext } from '../ai/ChatPane.js';
import { Empty, LoadError } from '../ui/index.js';
import { PaneResizer } from './PaneResizer.js';
import { ProposedEditsOverlay } from './ProposedEditsOverlay.js';
import { SuggestionsPanel } from './SuggestionsPanel.js';

const PANES_KEY = 'kb.workspace.panes';
const DEFAULT = [46, 27, 27]; // percent: source, suggestions, chat
const loadPanes = (): number[] => { try { const v = JSON.parse(localStorage.getItem(PANES_KEY) ?? ''); return Array.isArray(v) && v.length === 3 ? v : DEFAULT; } catch { return DEFAULT; } };

/** /workspace/:id — source editor, suggestions, chat; the chat proposes, the user decides. */
export function WorkspacePage() {
  const { id = '' } = useParams<{ id: string }>();
  const can = useCan();
  const doc = useDocument(id);
  const source = useSourceDocument(id);
  const [panes, setPanes] = useState<number[]>(loadPanes);
  const [proposed, setProposed] = useState<ProposedEdits | null>(null);
  const [ctx, setCtx] = useState<ChatContext | undefined>(undefined);
  const [refined, setRefined] = useState<{ suggestionId: string; payload: SuggestionPayload } | null>(null);
  useEffect(() => { try { localStorage.setItem(PANES_KEY, JSON.stringify(panes)); } catch { /* per-viewer convenience */ } }, [panes]);
  const resize = useCallback((i: 0 | 1) => (deltaPx: number) => {
    setPanes((p) => {
      const total = document.getElementById('workspace')?.clientWidth || 1200;
      const d = (deltaPx / total) * 100;
      const n = [...p];
      n[i] = Math.max(20, Math.min(70, n[i]! - d));
      n[i + 1] = Math.max(15, Math.min(70, n[i + 1]! + d));
      return n;
    });
  }, []);

  if (!can('ai.chat')) return <Empty title="אין הרשאה לסביבת העבודה">סביבת העבודה זמינה לעורכי תוכן.</Empty>;
  if (doc.isError) return <LoadError what="הפריט" error={doc.error} />;
  if (doc.isPending) return <div className="route-loading">טוען…</div>;

  return (
    <div className="workspace" id="workspace" dir="rtl">
      <header className="workspace-head">
        <b>{doc.data.title}</b>
        <span className="small muted">גרסת מקור {source.data?.version ?? '—'}</span>
        <span className="grow" />
        <Link className="btn sm" to={`/doc/${id}`}>חזרה לפריט</Link>
      </header>
      <div className="workspace-panes" style={{ gridTemplateColumns: `${panes[0]}% 6px ${panes[1]}% 6px ${panes[2]}%` }}>
        <section className="pane" aria-label="מסמך המקור">
          {proposed ? (
            <ProposedEditsOverlay documentId={id} proposed={proposed} onDecided={() => setProposed(null)} onDismiss={() => setProposed(null)} />
          ) : null}
          <SourceEditor documentId={id} />
        </section>
        <PaneResizer label="שינוי רוחב מסמך המקור" onDelta={resize(0)} />
        <section className="pane" aria-label="הצעות">
          <SuggestionsPanel documentId={id} onAskAbout={(suggestionId) => setCtx({ suggestionId })} refined={refined} onRefinedConsumed={() => setRefined(null)} />
        </section>
        <PaneResizer label="שינוי רוחב ההצעות" onDelta={resize(1)} />
        <section className="pane" aria-label="סביבת העבודה">
          <ChatPane kind="workspace" documentId={id} context={ctx} onProposedEdits={setProposed} onRefinedSuggestion={(suggestionId, payload) => setRefined({ suggestionId, payload })} />
        </section>
      </div>
    </div>
  );
}
```
(`SuggestionsPanel`'s `refined`/`onRefinedConsumed` props are added in Task 5; until then pass nothing and let TypeScript guide the wiring in Task 6.)

Route: append to `routes.tsx` in the wave 6 block, lazy like the others: `{ path: 'workspace/:id', element: split(WorkspacePage) }` with `const WorkspacePage = lazyPage(() => import('./components/workspace/WorkspacePage.js').then((m) => ({ default: m.WorkspacePage })))` — copy the exact helper the file uses for `SourceEditPage`.

- [ ] **Step 4: Run** — `… test -- workspace/` → PASS; build clean.

- [ ] **Step 5: Commit** — `feat(web): /workspace/:id — resizable source/suggestions/chat panes and the proposed-edits overlay`

---

### Task 5: Suggestions panel — affects chips, structured edit drawer, partial apply

**Files:**
- Create: `apps/web/src/lib/suggestionRows.ts`, `apps/web/src/components/workspace/AffectsChips.tsx`, `apps/web/src/components/workspace/StructuredEditDrawer.tsx`, `apps/web/src/components/workspace/SuggestionsPanel.tsx`
- Test: `apps/web/test/workspace/suggestionRows.test.ts`, `apps/web/test/workspace/SuggestionsPanel.test.tsx`

**Interfaces:**
- Consumes: `SuggestionCard`, `payloadSummary` (`components/sources/SuggestionCard.tsx`), `useSuggestions`, `useDecideSuggestion`, `useEditSuggestion` (`api/hooks/pipeline.ts`), `useStructuredEdit`, `useAcceptSuggestionParts`, `useSuggestion` (Task 2), `useDocument` (for `sourceId`), `useModal`, `counted`/`documents` from `lib/count.ts`.
- Produces: `rowsOf`, `applyRows`, `AffectsChips`, `StructuredEditDrawer`, `SuggestionsPanel`.

- [ ] **Step 1: Write the failing tests**

`suggestionRows.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { rowsOf, applyRows } from '../../src/lib/suggestionRows.js';

describe('rowsOf / applyRows', () => {
  it('update-step rows follow the pinned id scheme', () => {
    const rows = rowsOf({ type: 'update-step', addActions: ['א', 'ב'], patch: { hint: 'רמז' }, outcomes: [{ kind: 'ok', text: 'סיום' }], branch: { q: 'ש?', options: [{ kind: 'if', label: 'כן', text: 'המשך' }] } });
    expect(rows.map((r) => r.rowId)).toEqual(['add-0', 'add-1', 'branch-0', 'outcome-0', 'patch-hint']);
  });
  it('new-card rows are one per step plus title', () => {
    const rows = rowsOf({ type: 'new-card', title: 'כ', description: '', category: 'sim', wave: 1, priority: 'h', phases: [{ id: 'p1', label: '', steps: [{ key: 's1', num: '1', title: 'שלב', deps: [], blockRefs: [], actions: [], outcomes: [] }] }] });
    expect(rows.map((r) => r.rowId)).toEqual(['title', 'step-0-0']);
  });
  it('applyRows edits and removes only the addressed rows', () => {
    const p = { type: 'update-step' as const, addActions: ['א', 'ב', 'ג'], patch: {} };
    const out = applyRows(p, { type: 'update-step', rows: [{ rowId: 'add-1', op: 'edit', value: 'ב2' }, { rowId: 'add-2', op: 'remove' }] });
    expect(out).toMatchObject({ addActions: ['א', 'ב2'] });
  });
  it('deprecate-step and field-alert expose one row each', () => {
    expect(rowsOf({ type: 'deprecate-step', reason: 'ישן' }).map((r) => r.rowId)).toEqual(['reason']);
    expect(rowsOf({ type: 'field-alert', fieldName: 'x', issue: 'unknown' }).map((r) => r.rowId)).toEqual(['alert']);
  });
});
```

`SuggestionsPanel.test.tsx`: with the fixture that has `affects`, the card shows the chips text "משפיע על מסמך אחד · בלוק משותף אחד · שדה CRM אחד" (via `counted`), clicking a chip of kind `document` navigates to `/doc/:id`; "עריכה מפורטת" opens the drawer (`role="dialog"`, name "עריכת ההצעה") listing rows from `rowsOf`, each with radios "שמור"/"ערוך"/"הסר"; choosing "ערוך" reveals a textarea; "שמור עריכה" PATCHes the structured edit (`aiState.edits[0].body.rows`); ticking two of three row checkboxes then "החל חלקית" posts `parts` with exactly those ids; the reviewer-less caller (`docs.read` only) sees neither drawer nor checkboxes; "שאל על ההצעה" calls `onAskAbout(id)`; when `refined` is passed, a banner "התקבלה הצעה מעודנת מהצ'אט" with "פתח בעורך" opens the drawer prefilled (rows whose value differs are pre-set to `edit`).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`lib/suggestionRows.ts`:
```ts
import type { StructuredEdit, SuggestionPayload } from '@wecom/shared';

export interface SuggestionRow { rowId: string; label: string; value: string }

/** Row ids are the contract with X3's server-side apply — see the plan's pinned scheme. */
export function rowsOf(p: SuggestionPayload): SuggestionRow[] {
  switch (p.type) {
    case 'update-step':
      return [
        ...p.addActions.map((a, i) => ({ rowId: `add-${i}`, label: 'פעולה חדשה', value: a })),
        ...(p.replaceActions ?? []).map((a, i) => ({ rowId: `replace-${i}`, label: 'החלפת פעולה', value: a.text })),
        ...(p.branch?.options ?? []).map((o, i) => ({ rowId: `branch-${i}`, label: 'אפשרות הסתעפות', value: `${o.label} — ${o.text}` })),
        ...(p.outcomes ?? []).map((o, i) => ({ rowId: `outcome-${i}`, label: 'תוצאה', value: o.text })),
        ...Object.entries(p.patch).map(([k, v]) => ({ rowId: `patch-${k}`, label: `שדה ${k}`, value: typeof v === 'string' ? v : JSON.stringify(v) })),
      ];
    case 'new-card':
      return [{ rowId: 'title', label: 'כותרת', value: p.title }, ...p.phases.flatMap((ph, pi) => ph.steps.map((s, si) => ({ rowId: `step-${pi}-${si}`, label: `שלב ${s.num}`, value: s.title })))];
    case 'new-step':
      return [{ rowId: 'title', label: 'כותרת', value: p.title }, ...p.actions.map((a, i) => ({ rowId: `action-${i}`, label: 'פעולה', value: a }))];
    case 'update-block':
      return [...p.actions.map((a, i) => ({ rowId: `action-${i}`, label: 'פעולה', value: a.text })), ...(p.script ? [{ rowId: 'script', label: 'תסריט', value: p.script }] : [])];
    case 'deprecate-step':
      return [{ rowId: 'reason', label: 'סיבה', value: p.reason }];
    case 'field-alert':
      return [{ rowId: 'alert', label: 'התראת שדה', value: `${p.fieldName} · ${p.issue}` }];
  }
}

/** Pure preview of an edit — the server applies the real thing; this feeds the drawer summary. */
export function applyRows(p: SuggestionPayload, edit: StructuredEdit): SuggestionPayload {
  const ops = new Map(edit.rows.map((r) => [r.rowId, r]));
  const keepOrEdit = <T>(rowId: string, v: T, set: (s: string) => T): T | null => {
    const r = ops.get(rowId);
    if (!r || r.op === 'keep') return v;
    if (r.op === 'remove') return null;
    return r.value === undefined ? v : set(r.value);
  };
  const compact = <T>(xs: (T | null)[]): T[] => xs.filter((x): x is T => x !== null);
  switch (p.type) {
    case 'update-step':
      return {
        ...p,
        addActions: compact(p.addActions.map((a, i) => keepOrEdit(`add-${i}`, a, (s) => s))),
        replaceActions: p.replaceActions ? compact(p.replaceActions.map((a, i) => keepOrEdit(`replace-${i}`, a, (s) => ({ ...a, text: s })))) : undefined,
        outcomes: p.outcomes ? compact(p.outcomes.map((o, i) => keepOrEdit(`outcome-${i}`, o, (s) => ({ ...o, text: s })))) : undefined,
        branch: p.branch ? { ...p.branch, options: compact(p.branch.options.map((o, i) => keepOrEdit(`branch-${i}`, o, (s) => ({ ...o, text: s })))) } : p.branch,
        patch: Object.fromEntries(compact(Object.entries(p.patch).map(([k, v]) => keepOrEdit(`patch-${k}`, [k, v] as [string, unknown], (s) => [k, s])))),
      };
    case 'new-card':
      return { ...p, title: keepOrEdit('title', p.title, (s) => s) ?? p.title, phases: p.phases.map((ph, pi) => ({ ...ph, steps: compact(ph.steps.map((s, si) => keepOrEdit(`step-${pi}-${si}`, s, (t) => ({ ...s, title: t })))) })) };
    case 'new-step':
      return { ...p, title: keepOrEdit('title', p.title, (s) => s) ?? p.title, actions: compact(p.actions.map((a, i) => keepOrEdit(`action-${i}`, a, (s) => s))) };
    case 'update-block':
      return { ...p, actions: compact(p.actions.map((a, i) => keepOrEdit(`action-${i}`, a, (s) => ({ ...a, text: s })))), script: p.script ? (keepOrEdit('script', p.script, (s) => s) ?? undefined) : p.script };
    case 'deprecate-step':
      return { ...p, reason: keepOrEdit('reason', p.reason, (s) => s) ?? p.reason };
    case 'field-alert':
      return p;
  }
}
```

`AffectsChips.tsx` — groups `affects` by kind; renders "משפיע על " + parts joined with " · " using `counted(n, documents, …)` for documents, "בלוק משותף אחד / N בלוקים משותפים", "שדה CRM אחד / N שדות CRM", "נושא אחד / N נושאים" (add `blocks`, `crmFields` helpers to `lib/count.ts`? — **no**, `count.ts` is not on the append list for X4a; spell the four plural forms locally in this component with `plural()` from `@wecom/shared`); each part is a `<button className="chip chip-amber">` with a `title` listing the item titles and `why`; clicking a document part navigates to `/doc/:id` of the first item (or opens a small popover listing all when more than one — a `<details>` element is enough).

`StructuredEditDrawer.tsx` — `role="dialog" aria-modal="true" aria-label="עריכת ההצעה"` (focus-trapped with `useFocusTrap` from `components/ui/useFocusTrap.ts`, Escape closes), rows from `rowsOf(suggestion.editedPayload ?? suggestion.payload)`, each row a fieldset with three radios (`שמור`/`ערוך`/`הסר`) and a textarea shown for `ערוך`; a summary line "תוצאה: " + `payloadSummary(applyRows(payload, edit))`; buttons "ביטול" and "שמור עריכה" → `onSave(edit)` (rows left as `keep` are omitted). Accepts an optional `prefill?: SuggestionPayload` (the refined payload): rows whose value differs from the original are initialised as `edit` with the refined value.

`SuggestionsPanel.tsx` — header "הצעות" with counts (`pending` via `plural`), the list of `SuggestionCard`s for this document's source (`useSuggestions({ sourceId })`, where `sourceId` comes from `useDocument(id).data.sourceId`; when the document has no source, show `Empty` "לפריט זה אין מסמך מקור מקושר"); under each pending card: `AffectsChips`, a row of buttons "עריכה מפורטת" (opens the drawer), "שאל על ההצעה" (`onAskAbout`), and for `suggestions.review` holders a checkbox list of `rowsOf(...)` with "החל חלקית" → `useAcceptSuggestionParts({ id, parts })` (disabled until ≥1 row is ticked; "אשר" on the card stays the full accept). The drawer's `onSave` → `useStructuredEdit`. A `refined` banner as described in the test.

- [ ] **Step 4: Run** — `… test -- workspace/` → PASS.

- [ ] **Step 5: Commit** — `feat(web): suggestions panel — affects chips, structured edit drawer, partial apply`

---

### Task 6: Wiring, selection context, CSS, accessibility

**Files:**
- Modify: `apps/web/src/components/workspace/WorkspacePage.tsx`, `apps/web/src/components/ai/ChatPane.tsx` (refined fallback → drawer), `apps/web/src/styles/app.css` (append `/* wave 6 — X4a */`)
- Test: extend `apps/web/test/workspace/WorkspacePage.test.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: a working `/workspace/:id` end to end against MSW.

- [ ] **Step 1: Write the failing tests** (append to `WorkspacePage.test.tsx`)
  - selecting text inside the source editor (dispatch `selectionchange` with a Range inside `.source-html`) sets the chat context chip to `הקשר: "…"`, and the next send carries `context.selection`;
  - a `refined_suggestion` event (script it) opens the "התקבלה הצעה מעודנת מהצ'אט" banner in the suggestions pane and "פתח בעורך" opens the drawer prefilled;
  - accepting one hunk in the overlay then "אשר החלטות" posts to decide and the overlay disappears; the source query is invalidated (`qc.getQueryState(['source', id])?.isInvalidated`);
  - at 900px width the three panes stack (assert the container has class `stacked` when `matchMedia('(max-width: 900px)')` matches — mock `matchMedia`).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** — `useEffect` in `WorkspacePage` listening to `document.onselectionchange`, debounced 300 ms, that sets `ctx.selection` when the selection is non-empty and inside the source pane (`section[aria-label="מסמך המקור"]`), capped to 4000 chars; a `matchMedia` hook toggling `stacked`; the refined fallback in `ChatPane` replaced by the host callback (WorkspacePage passes `onRefinedSuggestion`; the step editor and article page from X4b pass their own or nothing — when nothing, `ChatPane` shows the refined card with a copy-summary button and no apply).

CSS block (`app.css`, appended):
```css
/* wave 6 — X4a (workspace: source + suggestions + chat; the shared chat pane) */
.workspace { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.workspace-head { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--line); background: var(--surface-1); }
.workspace-panes { display: grid; flex: 1; min-height: 0; }
.workspace-panes.stacked { grid-template-columns: 1fr !important; grid-auto-rows: minmax(240px, auto); overflow: auto; }
.workspace .pane { min-width: 0; min-height: 0; overflow: auto; position: relative; background: var(--surface-0); }
.workspace [role="separator"] { cursor: col-resize; background: var(--line); outline-offset: -2px; }
.workspace [role="separator"]:focus-visible { outline: 2px solid var(--accent); }
.workspace-panes.stacked [role="separator"] { display: none; }
.pe-overlay { position: sticky; top: 0; z-index: 3; background: var(--surface-1); border-bottom: 1px solid var(--line); padding: 8px 12px; box-shadow: var(--shadow-1); }
.pe-ops { list-style: none; margin: 6px 0; padding: 0; display: grid; gap: 6px; }
.pe-op { display: grid; grid-template-columns: auto auto 1fr auto; gap: 8px; align-items: start; padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--r-2); }
.pe-op del { color: var(--del-text); background: var(--del-mark); text-decoration: line-through; }
.pe-op ins { color: var(--ok-text); background: var(--ok-mark); text-decoration: none; }
.pe-op.accepted { border-color: var(--ok); } .pe-op.rejected { opacity: .55; }
.pe-actions { display: flex; gap: 4px; }
.chat-pane { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.chat-pane.compact .chat-head { display: none; }
.chat-head { display: flex; gap: 8px; align-items: baseline; padding: 8px 12px; border-bottom: 1px solid var(--line); }
.chat-messages { flex: 1; overflow: auto; padding: 10px 12px; display: grid; gap: 10px; align-content: start; }
.chat-msg { max-width: 92%; padding: 8px 10px; border-radius: var(--r-3); line-height: 1.5; }
.chat-msg.user { background: var(--accent-soft); margin-inline-start: auto; }
.chat-msg.assistant { background: var(--surface-2); }
.chat-msg.streaming::after { content: '▍'; animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { opacity: 0; } }
.chat-tools { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.tool-chip .spin { display: inline-block; width: 10px; height: 10px; border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.chat-composer { display: grid; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--line); background: var(--surface-1); }
.chat-composer textarea { width: 100%; resize: vertical; min-height: 44px; }
.chat-composer-actions { display: flex; justify-content: space-between; align-items: center; }
.chat-context { justify-self: start; }
.chat-error { color: var(--warn-text); padding: 4px 12px; }
.chat-feedback button[aria-pressed="true"] { color: var(--accent); }
.affects { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }
.sug-rows { list-style: none; padding: 0; margin: 6px 0; display: grid; gap: 4px; }
.sug-rows li { display: flex; gap: 6px; align-items: start; }
.sed-drawer { position: fixed; inset-block: 0; inset-inline-start: 0; width: min(520px, 100%); background: var(--surface-0); border-inline-end: 1px solid var(--line); box-shadow: var(--shadow-2); z-index: 40; display: flex; flex-direction: column; }
.sed-drawer .rows { flex: 1; overflow: auto; padding: 12px; display: grid; gap: 10px; }
.sed-drawer fieldset { border: 1px solid var(--line); border-radius: var(--r-2); padding: 8px; }
.sed-drawer .foot { display: flex; gap: 8px; justify-content: flex-end; padding: 10px 12px; border-top: 1px solid var(--line); }
@media (max-width: 900px) { .workspace-head { flex-wrap: wrap; } }
```
Use the token names that exist in `app.css` (check `--accent-soft`, `--del-text`, `--ok-text`, `--warn-text`, `--shadow-1/2`, `--r-2/3`; substitute the nearest existing token where one is missing — never introduce a new colour literal).

Accessibility pass: every control is a `<button>`; drawer is focus-trapped; separators are keyboard-resizable; the streaming bubble is `aria-live="polite"`; tool chips have `title`; the composer's `aria-label` is stable ("הודעה למערכת").

- [ ] **Step 4: Run** — full web suite `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4` → green (known flake: `wave4-mounts.test.tsx` TipTap race — re-run in isolation before calling it red); `pnpm --filter @wecom/web build`; `pnpm lint`; `prettier --check apps/web`.

- [ ] **Step 5: Commit** — `feat(web): workspace wiring — selection context, refined-suggestion hand-off, stacked layout, wave 6 styles`

---

### Task 7: Gate and lane report

**Files:**
- Create: `.superpowers/sdd/program/X4a-report.md` (git-ignored; worktree only)

- [ ] **Step 1: Gate** — `pnpm --filter @wecom/web build`, `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4`, `pnpm lint`, `prettier --check apps/web`. All green; record counts.
- [ ] **Step 2: Grep-proof the isolation** — `git diff --name-only main...HEAD` contains only files in this plan's file structure; no `apps/api/**`, no `packages/**`; `routes.tsx`/`keys.ts`/`handlers.ts`/`app.css` diffs are pure appends.
- [ ] **Step 3: Write the report** with: per-task status and commits; test counts; deviations from this plan's literal code and why; the exact component props (copy the names table, corrected to what shipped); the `// X6: api.*` swap list (every `w6`/`w6Maybe`/`w6Void` call site) and the instruction to delete `wave6.ts`; the row-id scheme as shipped (for X3/X6 parity); mount points for X6 (article/editor/sources "פתח בסביבת העבודה" buttons, `['ai']` prefix invalidation on the `ai.message` event in `api/events.ts`); anything X4b must know to mount `ChatPane` (`kind`, `context`, `compact`, `readOnly`).
- [ ] **Step 4: Commit nothing for the report** (git-ignored); reply with status, branch + head SHA, one-line test summary, concerns.

## Self-review

- Spec coverage: §1.3 (proposals, never direct writes — overlay + decide route, `docs.edit` gate), §1.4 (workspace kind; the shared `ChatPane` serves the other two kinds), §1.8 (structured editing, partial apply, original kept — the drawer sends rows, the server stores original/edited/diff), §4.3 routes (conversations, messages SSE, feedback, decide), §4.2 (`GET /suggestions/:id`, `PATCH edit`, `POST accept` with parts), §5 Workspace (three panes, selection context, refined → card, chips) — each has a task and a test.
- Placeholders: none; every code step is complete or names the exact file to read for the one detail it depends on (the `withMe` partial shape, the lazy-route helper name, token names in `app.css`).
- Type consistency: `ChatViewState`/`chatReducer` names match between Task 2 and Task 3; `rowsOf`/`applyRows`/`StructuredEdit` between Tasks 5 and 6; `ProposedEdits` ops between Tasks 1, 3 and 4; keys `keys.ai.*`, `keys.suggestion`, `keys.suggestionAnalytics` between Task 2 and the hooks.
- Contract questions for the controller are in the fork's reply, not in this file.
