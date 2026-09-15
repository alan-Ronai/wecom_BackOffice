# X2 — Chat Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the persisted, streaming AI chat: conversations and messages in Postgres, an SSE route that streams `ChatEventSchema` events while it persists them, a tool runtime whose tool set is decided by the caller's permissions (agents ask, editors direct, admins inspect), proposed source edits that the user accepts per op, per-message feedback, a per-user rate limit, and an admin transcript export — with every model output validated and nothing ever written to a document without a user click.

**Architecture:** One Fastify module `apps/api/src/modules/ai/` registered through `registerModules`. The chat model is a second `OllamaModel` (tag from `resolveModelSlots(config).chatModel`) held in a swappable holder `app.aiChat` so tests inject a scripted fake without touching `plugins/model.ts`. `ChatOrchestrator` builds the system prompt (brief + style from `getAiSettings`, conversation kind, document context), runs a bounded tool loop (≤ 6 rounds), streams tokens to the response as SSE frames, and persists user/assistant/tool messages in the same order they streamed. Tools are server-side functions with zod-validated arguments; read tools apply the visibility rule and world scope; `propose_source_edit` and `refine_suggestion` return structured proposals (`ai_proposed_edits`, `editedPayload`) that the user still has to accept through existing, audited write paths (`saveSourceDocument`, `SuggestionService.edit`). Models without native tool calling get a JSON tool-call envelope; the capability is probed once per tag and cached.

**Tech Stack:** Node 22, Fastify 5, fastify-type-provider-zod, pg, zod, `@wecom/shared` (`wave6.ts`, `pipeline.ts`), `@wecom/model` (`OllamaModel`, `ModelClient.chat`), vitest + testcontainers.

**Spec:** `docs/superpowers/specs/2026-09-15-kb-wave6-ai-copilot-design.md` §1.3, §1.4, §1.5, §3 (`ai_*` tables), §4.3, §4.4, §5. Contract: `docs/api/CONTRACTS-wave6.md`. Canonical names: `docs/superpowers/plans/2026-09-15-X0-wave6-contracts.md`.

## Global Constraints

- TypeScript strict, pnpm from the repo root; migration for this lane is **`apps/api/migrations/0052_wave6_chat.js`** only (`checkOrder` is on; 0050 is X0, 0051 X1, 0053 X3, 0054 X6).
- Every request/response schema comes from `@wecom/shared` (`wave6.ts`); the only schema this lane may append there is none — if a shape is missing, add it to `wave6.ts` append-only and say so in the report.
- Route permission declaration exactly `config: { requires: ['ai.chat'] }` etc.; permission strings from `PERMISSIONS`.
- **The chat never writes to documents, sources or suggestions.** The only write paths are `POST /ai/proposed-edits/:id/decide` (through `saveSourceDocument` + `ingestSourceHtml`) and the existing `PUT /suggestions/:id/edit` (which the web calls with the payload the chat returned). Tools that "change" things return proposals.
- **Tool gating is server-side and by permission**, computed with `toolsFor(user.permissions)` from `wave6.ts`; the model is never told about tools the caller may not run, and a tool call the caller may not run is refused with `tool_result { ok: false }` even if the model asks (defence in depth).
- Every read tool applies `visibleWhere(canReadUnpublished(user))` / `getVisibleDocument` and `hasScope(user, doc.worlds)`; a tool that would reveal an out-of-scope or unpublished document returns "לא נמצא" — never the content.
- Outbound HTTP only to `MODEL_URL` through the model client; no other fetches (peer rule: `guardedFetch` is the only sanctioned outbound fetch elsewhere; the model URL is LAN-local by configuration).
- `apps/api/test/route-coverage.test.ts`: every new operation's path must appear literally in an integration test (`url: '/api/v1/ai/…'` or a `post('/api/v1/ai/…')` helper).
- Hebrew for user-facing strings; commits after every task ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Append-only touches outside the module: `apps/api/src/modules/index.ts` (one import + one list entry), `packages/model/src/ollama.ts` (add `chat`), `apps/api/test/int/scope-leak.test.ts` (new rows), `apps/api/src/plugins/wave4.ts` is **not** edited — the holder lives in this module.

## Cross-lane interfaces

- **From X0 (on main):** `ConversationKindSchema`, `ConversationSchema`, `CreateConversationBodySchema`, `ConversationsQuerySchema`, `ConversationsResponseSchema`, `AiMessageSchema`, `ConversationDetailSchema`, `SendMessageBodySchema`, `ChatEventSchema` (+ `ChatEvent` type), `MessageFeedbackBodySchema`, `ProposedEditOpSchema`, `ProposedEditsSchema`, `DecideProposedEditsBodySchema`, `DecideProposedEditsResultSchema`, `AI_TOOLS`, `AiToolNameSchema`, `toolsFor(permissions)`, `getAiSettings(q)`, `currentPromptVersion(settings)`, `resolveModelSlots(config)`, event `ai.message`, permissions `ai.ask` / `ai.chat` / `ai.manage`, model contract `ModelClient.chat?`, `ChatMessage`, `ToolCall`, `ChatToolSpec`, `ChatResult`.
- **From X1 (parallel):** `ImpactService.impactOf(documentId, user)` → `ImpactSet` and `buildSystemBrief(settings)`. Consumed only through `apps/api/src/modules/ai/impactPort.ts`, which ships a local fallback built on `graph/repo.ts` `inboundFor` and `documents.related`; X6 re-points it.
- **From X3 (parallel):** nothing at compile time; `refine_suggestion` validates with `SuggestionPayloadSchema` (already on main) and the web calls the existing `PUT /suggestions/:id/edit`.
- **Produces for X4a/X4b/X6:** the routes below; `ChatOrchestrator` (`apps/api/src/modules/ai/chat.ts`); `app.aiChat: ChatModelHolder` with `swap(model)`; tool names and argument schemas (§Task 4); `applyProposedEdits`.

## File structure

```
apps/api/migrations/0052_wave6_chat.js
apps/api/src/modules/ai/index.ts               module: holder, orchestrator deps, routes, registration
apps/api/src/modules/ai/chatModel.ts           ChatModelHolder (swap), OllamaChat factory, capability probe (native tools vs envelope)
apps/api/src/modules/ai/repo.ts                conversations, messages, feedback, proposed edits, transcript export query
apps/api/src/modules/ai/prompt.ts              system prompt assembly (brief, style, kind, document context, tool envelope instructions)
apps/api/src/modules/ai/chat.ts                ChatOrchestrator: tool loop, streaming, persistence
apps/api/src/modules/ai/sse.ts                 SSE writer for a POST response (hijack, frame, heartbeat, close)
apps/api/src/modules/ai/tools/registry.ts      ToolDef type, registry, gate by permission, run with zod parse
apps/api/src/modules/ai/tools/read.ts          read_document, read_topic, search_kb, explain_step, read_source, read_impact, list_suggestions, read_eval
apps/api/src/modules/ai/tools/propose.ts       propose_source_edit, refine_suggestion, review_document, draft_step
apps/api/src/modules/ai/proposedEdits.ts       diffToOps (model text vs current source), applyOps, decide (save + ingest + audit)
apps/api/src/modules/ai/rateLimit.ts           per-user sliding window from ai.limits
apps/api/src/modules/ai/export.ts              JSONL streaming export
apps/api/src/modules/ai/impactPort.ts          X1 port with local fallback
apps/api/src/modules/ai/routes.ts              every /ai/* route
packages/model/src/ollama.ts                   (modify: chat() with streaming + tools)
apps/api/test/ai-chat.test.ts                  orchestrator + routes (integration, fake chat model)
apps/api/test/ai-proposed-edits.test.ts        decide/apply/409/audit
apps/api/test/ai-admin.test.ts                 feedback, list, export, delete, rate limit
apps/api/test/unit/ai-proposed-edits.test.ts   diffToOps / applyOps (pure)
apps/api/test/unit/ai-prompt.test.ts           prompt assembly budgets
apps/api/test/helpers/ai/fakeChat.ts           scripted ModelClient.chat
apps/api/test/int/scope-leak.test.ts           (modify: /ai rows)
packages/model/test/ollama-chat.test.ts        chat() against a stub server: streaming, native tools, envelope fallback
```

---

### Task 1: Migration 0052 — conversations, messages, feedback, proposed edits

**Files:**
- Create: `apps/api/migrations/0052_wave6_chat.js`
- Modify: `apps/api/test/migrations.test.ts`

**Interfaces:**
- Consumes: `users`, `documents`, `source_revisions`, `suggestions` tables.
- Produces: tables `ai_conversations`, `ai_messages`, `ai_message_feedback`, `ai_proposed_edits` exactly per spec §3.

- [ ] **Step 1: Add the failing assertion** (inside the existing integration `describe` in `migrations.test.ts`, before the rollback case):

```ts
  it('0052: creates the AI chat tables with their constraints', async () => {
    const t = await pool.query(
      "select table_name from information_schema.tables where table_schema='public' and table_name like 'ai\\_%' order by 1",
    );
    expect(t.rows.map((r) => r.table_name)).toEqual([
      'ai_conversations',
      'ai_message_feedback',
      'ai_messages',
      'ai_proposed_edits',
      'ai_setting_versions',
    ]);
    const u = await pool.query(
      "select conname from pg_constraint where conrelid='ai_messages'::regclass and contype='u'",
    );
    expect(u.rows.map((r) => r.conname)).toContain('ai_messages_conversation_id_seq_key');
    await expect(
      pool.query("insert into ai_conversations(kind, user_id) values ('nope', gen_random_uuid())"),
    ).rejects.toThrow(/ai_conversations_kind_check|violates/);
  });
```
(`ai_setting_versions` is X0's 0050 table; the `like 'ai\_%'` listing includes it.)

- [ ] **Step 2: Run to verify failure** — `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts` → FAIL (tables missing).

- [ ] **Step 3: Write the migration**

```js
/**
 * Wave 6 (X2): persisted AI chat. Every conversation, message, tool call and proposed edit is
 * kept (spec §1.5) so transcripts can be exported for prompt tuning later. Nothing here is a
 * write path into documents: `ai_proposed_edits` is a proposal the user decides on.
 */
const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
exports.up = (pgm) => {
  pgm.createTable('ai_conversations', {
    id: id(pgm),
    kind: { type: 'text', notNull: true, check: "kind in ('workspace','editor','article')" },
    document_id: { type: 'uuid', references: 'documents', onDelete: 'set null' },
    source_revision_id: { type: 'uuid', references: 'source_revisions', onDelete: 'set null' },
    user_id: { type: 'uuid', notNull: true, references: 'users' },
    title: { type: 'text', notNull: true, default: '' },
    model: { type: 'text', notNull: true, default: '' },
    prompt_version: { type: 'text', notNull: true, default: '' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    deleted_at: 'timestamptz',
  });
  pgm.createIndex('ai_conversations', ['user_id', 'updated_at']);
  pgm.createIndex('ai_conversations', ['document_id', 'kind']);
  pgm.createTable('ai_messages', {
    id: id(pgm),
    conversation_id: { type: 'uuid', notNull: true, references: 'ai_conversations', onDelete: 'cascade' },
    seq: { type: 'integer', notNull: true },
    role: { type: 'text', notNull: true, check: "role in ('user','assistant','tool','system')" },
    content: { type: 'text', notNull: true, default: '' },
    tool_calls: 'jsonb',
    tool_results: 'jsonb',
    proposed_edits: 'jsonb',
    refined_suggestion_id: { type: 'uuid', references: 'suggestions', onDelete: 'set null' },
    tokens_in: { type: 'integer', notNull: true, default: 0 },
    tokens_out: { type: 'integer', notNull: true, default: 0 },
    latency_ms: { type: 'integer', notNull: true, default: 0 },
    model: { type: 'text', notNull: true, default: '' },
    prompt_version: { type: 'text', notNull: true, default: '' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('ai_messages', 'ai_messages_conversation_id_seq_key', { unique: ['conversation_id', 'seq'] });
  pgm.createTable(
    'ai_message_feedback',
    {
      message_id: { type: 'uuid', notNull: true, references: 'ai_messages', onDelete: 'cascade' },
      user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
      rating: { type: 'text', notNull: true, check: "rating in ('up','down')" },
      note: { type: 'text', notNull: true, default: '' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
    { constraints: { primaryKey: ['message_id', 'user_id'] } },
  );
  pgm.createTable('ai_proposed_edits', {
    id: id(pgm),
    message_id: { type: 'uuid', notNull: true, references: 'ai_messages', onDelete: 'cascade' },
    document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' },
    base_source_version: { type: 'integer', notNull: true },
    ops: { type: 'jsonb', notNull: true },
    status: {
      type: 'text',
      notNull: true,
      default: 'proposed',
      check: "status in ('proposed','accepted','rejected','partially_accepted')",
    },
    decided_by: { type: 'uuid', references: 'users' },
    decided_at: 'timestamptz',
    resulting_source_version: 'integer',
  });
  pgm.createIndex('ai_proposed_edits', ['document_id', 'status']);
};
exports.down = (pgm) => {
  for (const t of ['ai_proposed_edits', 'ai_message_feedback', 'ai_messages', 'ai_conversations']) pgm.dropTable(t);
};
```

- [ ] **Step 4: Run** — the same command plus `test/migrate.test.ts` → PASS (up and down-to-empty).
- [ ] **Step 5: Commit** — `feat(api): migration 0052 — AI conversations, messages, feedback, proposed edits`

---

### Task 2: Repo — conversations, messages, feedback, proposed edits, export query

**Files:**
- Create: `apps/api/src/modules/ai/repo.ts`
- Test: `apps/api/test/ai-chat.test.ts` (repo section; the file grows in Tasks 5–6)

**Interfaces:**
- Produces:
```ts
export type Q = Queryable;
export async function createConversation(tx: Tx, input: { kind: ConversationKind; documentId: string | null; sourceRevisionId: string | null; userId: string; title: string; model: string; promptVersion: string }): Promise<Conversation>;
export async function getConversation(q: Q, id: string): Promise<Conversation | null>;            // live only
export async function listConversations(q: Q, query: ConversationsQuery & { userId: string | null }): Promise<{ items: Conversation[]; total: number }>;
export async function listMessages(q: Q, conversationId: string): Promise<AiMessage[]>;
export async function nextSeq(tx: Tx, conversationId: string): Promise<number>;                   // select max(seq)+1 … for update on the conversation row
export async function insertMessage(tx: Tx, m: Omit<AiMessage, 'id' | 'createdAt'>): Promise<AiMessage>;
export async function updateMessage(tx: Tx, id: string, patch: Partial<Pick<AiMessage, 'content' | 'toolCalls' | 'toolResults' | 'proposedEdits' | 'refinedSuggestionId' | 'tokensIn' | 'tokensOut' | 'latencyMs'>>): Promise<void>;
export async function touchConversation(tx: Tx, id: string, title?: string): Promise<void>;
export async function setFeedback(tx: Tx, messageId: string, userId: string, rating: 'up' | 'down', note: string): Promise<void>;
export async function createProposedEdits(tx: Tx, input: { messageId: string; documentId: string; baseSourceVersion: number; ops: ProposedEditOp[] }): Promise<ProposedEdits>;
export async function getProposedEdits(q: Q, id: string): Promise<ProposedEdits | null>;
export async function decideProposedEdits(tx: Tx, id: string, status: ProposedEdits['status'], userId: string, resultingSourceVersion: number | null): Promise<ProposedEdits>;
export async function softDeleteConversation(tx: Tx, id: string): Promise<boolean>;
export function exportCursor(q: Q, filter: { from?: string; to?: string; userId?: string; documentId?: string }): AsyncIterable<{ conversation: Conversation; messages: AiMessage[]; feedback: { messageId: string; rating: string; note: string }[] }>;
```
- Row mappers produce exactly the `wave6.ts` shapes (camelCase, ISO dates).

- [ ] **Step 1: Write the failing test** (`apps/api/test/ai-chat.test.ts`, first describe):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth } from './helpers/fixtures.js';
import { withTransaction } from '../src/lib/sql.js';
import * as repo from '../src/modules/ai/repo.js';

const run = integration ? describe : describe.skip;

run('ai repo', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let user: Awaited<ReturnType<typeof makeUser>>;
  beforeAll(async () => {
    db = await startTestDb();
    user = await makeUser(db.pool, { name: 'עורכת' });
  }, 120_000);
  afterAll(async () => db?.stop());

  it('numbers messages per conversation and keeps tool payloads', async () => {
    const c = await withTransaction(db.pool, (tx) =>
      repo.createConversation(tx, { kind: 'editor', documentId: null, sourceRevisionId: null, userId: user.id, title: '', model: 'fake', promptVersion: 'v3.0.0' }),
    );
    const [m1, m2] = await withTransaction(db.pool, async (tx) => {
      const a = await repo.insertMessage(tx, { conversationId: c.id, seq: await repo.nextSeq(tx, c.id), role: 'user', content: 'שלום', toolCalls: null, toolResults: null, proposedEdits: null, refinedSuggestionId: null, tokensIn: 0, tokensOut: 0, latencyMs: 0, model: 'fake', promptVersion: 'v3.0.0' });
      const b = await repo.insertMessage(tx, { conversationId: c.id, seq: await repo.nextSeq(tx, c.id), role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'read_document', args: { documentId: 'x' } }], toolResults: null, proposedEdits: null, refinedSuggestionId: null, tokensIn: 3, tokensOut: 0, latencyMs: 0, model: 'fake', promptVersion: 'v3.0.0' });
      return [a, b];
    });
    expect([m1.seq, m2.seq]).toEqual([1, 2]);
    const list = await repo.listMessages(db.pool, c.id);
    expect(list.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(list[1].toolCalls?.[0].name).toBe('read_document');
  });

  it('lists only the caller’s live conversations unless userId is null', async () => {
    const other = await makeUser(db.pool, { name: 'אחר' });
    await withTransaction(db.pool, (tx) =>
      repo.createConversation(tx, { kind: 'article', documentId: null, sourceRevisionId: null, userId: other.id, title: 'x', model: 'fake', promptVersion: 'v' }),
    );
    const mine = await repo.listConversations(db.pool, { page: 1, pageSize: 50, userId: user.id });
    expect(mine.items.every((c) => c.userId === user.id)).toBe(true);
    const all = await repo.listConversations(db.pool, { page: 1, pageSize: 50, userId: null });
    expect(all.total).toBeGreaterThan(mine.total);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `RUN_INTEGRATION=1 pnpm vitest run test/ai-chat.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `repo.ts`** — plain SQL with `Queryable`/`Tx` from `../../lib/sql.js`. Key statements:
  - `nextSeq`: `select id from ai_conversations where id=$1 for update` then `select coalesce(max(seq),0)+1 as n from ai_messages where conversation_id=$1`.
  - `listConversations`: `where deleted_at is null and ($1::uuid is null or user_id=$1) and ($2::uuid is null or document_id=$2) and ($3::text is null or kind=$3) order by updated_at desc limit $4 offset $5` plus a `count(*)` with the same predicate.
  - `exportCursor`: an async generator over `select id from ai_conversations where deleted_at is null and (…filters…) order by created_at` in pages of 100, each yielding the conversation, its messages (`order by seq`) and feedback rows.
  - Row mappers: `toConversation`, `toMessage`, `toProposedEdits` (ISO strings via `.toISOString()`; jsonb columns passed through; nullables `?? null`).

- [ ] **Step 4: Run** → PASS. `pnpm typecheck` clean.
- [ ] **Step 5: Commit** — `feat(api): AI chat repo — conversations, messages, feedback, proposed edits`

---

### Task 3: Chat model — `OllamaModel.chat`, holder, capability probe

**Files:**
- Modify: `packages/model/src/ollama.ts`
- Create: `apps/api/src/modules/ai/chatModel.ts`
- Test: `packages/model/test/ollama-chat.test.ts`, `apps/api/test/helpers/ai/fakeChat.ts`

**Interfaces:**
- Consumes: `ModelClient.chat?(input)`, `ChatMessage`, `ChatToolSpec`, `ChatResult`, `ToolCall` from X0's contract.
- Produces:
```ts
// packages/model: OllamaModel.chat(input) — streams /api/chat with stream:true; passes `tools` when supportsTools; onToken per content chunk;
//   collects message.tool_calls (native) OR parses a JSON envelope {"tool_calls":[{name,args}]} from content when !supportsTools;
//   returns { content, toolCalls, tokensIn: prompt_eval_count, tokensOut: eval_count }.
export interface OllamaOptions { …existing; supportsTools?: boolean }   // undefined = probe
// apps/api/src/modules/ai/chatModel.ts
export class ChatModelHolder implements Pick<ModelClient, 'name' | 'available' | 'chat'> { constructor(public impl: ModelClient); swap(impl: ModelClient): void; … }
export async function makeChatModel(config: Config, log: FastifyBaseLogger): Promise<ModelClient>;   // OllamaModel for resolveModelSlots(config).chatModel; RuleBased-free: chat has no deterministic fallback, availability is checked per request
export async function probeToolSupport(url: string, tag: string, fetchImpl?: typeof fetch): Promise<boolean>;  // GET /api/show → capabilities includes 'tools'; cached per tag in-process
declare module 'fastify' { interface FastifyInstance { aiChat: ChatModelHolder } }
```

- [ ] **Step 1: Write the failing model test** (`packages/model/test/ollama-chat.test.ts`) against a tiny in-process HTTP stub (see `packages/model/test/fixtures/ollama-stub.ts` for the existing pattern; extend it with a `/api/chat` stream handler that writes NDJSON lines):

```ts
import { describe, it, expect } from 'vitest';
import { OllamaModel } from '../src/index.js';
import { startOllamaStub } from './fixtures/ollama-stub.js';

describe('OllamaModel.chat', () => {
  it('streams tokens and returns native tool calls', async () => {
    const stub = await startOllamaStub({
      chatStream: [
        { message: { role: 'assistant', content: 'בודק ' } },
        { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_document', arguments: { documentId: 'd1' } } }] }, done: true, prompt_eval_count: 10, eval_count: 4 },
      ],
      capabilities: ['completion', 'tools'],
    });
    const m = new OllamaModel({ url: stub.url, model: 'x', supportsTools: true });
    const tokens: string[] = [];
    const r = await m.chat!({ messages: [{ role: 'user', content: 'היי' }], tools: [{ name: 'read_document', description: 'd', parameters: { type: 'object' } }], onToken: (t) => tokens.push(t) });
    expect(tokens.join('')).toBe('בודק ');
    expect(r.toolCalls).toEqual([{ id: expect.any(String), name: 'read_document', args: { documentId: 'd1' } }]);
    expect(r.tokensIn).toBe(10);
    await stub.close();
  });
  it('falls back to the JSON envelope when the model has no tool support', async () => {
    const stub = await startOllamaStub({
      chatStream: [{ message: { role: 'assistant', content: '{"tool_calls":[{"name":"search_kb","args":{"q":"APN"}}]}' }, done: true }],
      capabilities: ['completion'],
    });
    const m = new OllamaModel({ url: stub.url, model: 'x', supportsTools: false });
    const r = await m.chat!({ messages: [{ role: 'user', content: 'x' }], tools: [{ name: 'search_kb', description: 'd', parameters: { type: 'object' } }] });
    expect(r.toolCalls[0]).toMatchObject({ name: 'search_kb', args: { q: 'APN' } });
    expect(r.content).toBe('');
    await stub.close();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @wecom/model test -- ollama-chat` → FAIL (`chat` undefined).

- [ ] **Step 3: Implement `chat` in `ollama.ts`**

```ts
  async chat(input: { model?: string; messages: ChatMessage[]; tools?: ChatToolSpec[]; onToken?: (t: string) => void; signal?: AbortSignal }): Promise<ChatResult> {
    const native = this.o.supportsTools ?? false;
    const messages = native || !input.tools?.length ? input.messages : [
      ...input.messages.slice(0, 1),
      { role: 'system' as const, content: toolEnvelopeInstructions(input.tools) },
      ...input.messages.slice(1),
    ];
    const res = await this.f(this.o.url.replace(/\/$/, '') + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: input.signal,
      body: JSON.stringify({
        model: input.model ?? this.o.model,
        stream: true,
        options: { temperature: 0.2, num_ctx: 8192 },
        messages: messages.map(toOllamaMessage),
        ...(native && input.tools?.length ? { tools: input.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
      }),
    });
    if (!res.ok || !res.body) throw new Error('chat http ' + res.status);
    let content = '';
    const toolCalls: ToolCall[] = [];
    let tokensIn = 0, tokensOut = 0;
    for await (const line of ndjsonLines(res.body)) {
      const chunk = JSON.parse(line) as { message?: { content?: string; tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[] }; done?: boolean; prompt_eval_count?: number; eval_count?: number };
      const piece = chunk.message?.content ?? '';
      if (piece) { content += piece; input.onToken?.(piece); }
      for (const tc of chunk.message?.tool_calls ?? []) toolCalls.push({ id: randomId(), name: tc.function.name, args: tc.function.arguments ?? {} });
      if (chunk.done) { tokensIn = chunk.prompt_eval_count ?? 0; tokensOut = chunk.eval_count ?? 0; }
    }
    if (!native && input.tools?.length) {
      const env = parseToolEnvelope(content); // {"tool_calls":[{name,args}]} possibly wrapped in ```json
      if (env) { toolCalls.push(...env.map((c) => ({ id: randomId(), name: c.name, args: c.args }))); content = ''; }
    }
    return { content, toolCalls, tokensIn, tokensOut };
  }
```
Helpers in the same file: `ndjsonLines(body: ReadableStream)` (TextDecoder, split on `\n`, ignore blanks), `toOllamaMessage` (maps `tool` role to `{ role: 'tool', content, tool_call_id }`; assistant with `toolCalls` to Ollama's `tool_calls` shape), `toolEnvelopeInstructions(tools)` (Hebrew: "כשאתה צריך כלי, החזר אך ורק JSON: {"tool_calls":[{"name":…,"args":{…}}]}. אחרת ענה בטקסט רגיל." + the tool list with parameter names), `parseToolEnvelope(text)` (strip code fences, `JSON.parse`, validate `tool_calls` is an array of `{name: string, args: object}`; return null otherwise), `randomId = () => 'call_' + crypto.randomUUID().slice(0, 8)`. The `onToken` path emits **only** plain content; when `!native` and the content turns out to be an envelope, the orchestrator will already have streamed the JSON text — to avoid that, buffer tokens in envelope mode until the first non-whitespace character is known: if it is `{` or a fence, suppress streaming for that turn (a `pending` buffer flushed on first non-`{`).

- [ ] **Step 4: Implement `chatModel.ts`**

```ts
import fp from 'fastify-plugin';
export class ChatModelHolder { constructor(public impl: ModelClient) {} swap(impl: ModelClient) { this.impl = impl; } get name() { return this.impl.name; } available() { return this.impl.available(); } chat(i: Parameters<NonNullable<ModelClient['chat']>>[0]) { if (!this.impl.chat) throw httpError(503, 'AI_UNAVAILABLE', 'מודל הצ׳אט אינו זמין'); return this.impl.chat(i); } }
const toolSupport = new Map<string, boolean>();
export async function probeToolSupport(url: string, tag: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const hit = toolSupport.get(tag); if (hit !== undefined) return hit;
  try { const r = await fetchImpl(url.replace(/\/$/, '') + '/api/show', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: tag }) });
    const j = (await r.json()) as { capabilities?: string[] }; const ok = !!j.capabilities?.includes('tools'); toolSupport.set(tag, ok); return ok; } catch { return false; }
}
export async function makeChatModel(config: Config, log: FastifyBaseLogger): Promise<ModelClient> {
  const slots = resolveModelSlots(config);
  if (config.MODEL_DISABLED) return { name: 'disabled', available: async () => false } as ModelClient;
  const supportsTools = await probeToolSupport(config.MODEL_URL, slots.chatModel);
  log.info({ chatModel: slots.chatModel, supportsTools }, 'chat model ready');
  return new OllamaModel({ url: config.MODEL_URL, model: slots.chatModel, timeoutMs: 180_000, supportsTools });
}
```
and a scripted fake for tests, `apps/api/test/helpers/ai/fakeChat.ts`:
```ts
export type Script = (turn: { messages: ChatMessage[]; tools: string[] }) => ChatResult | Promise<ChatResult>;
export const fakeChat = (script: Script): ModelClient => ({ name: 'fake-chat', available: async () => true, proposeChanges: async () => [], chat: async (i) => { const r = await script({ messages: i.messages, tools: (i.tools ?? []).map((t) => t.name) }); for (const ch of r.content.split(/(?<=\s)/)) i.onToken?.(ch); return r; } });
```

- [ ] **Step 5: Run** — model tests PASS; `pnpm typecheck` clean.
- [ ] **Step 6: Commit** — `feat(model,api): streaming chat with native tools or a JSON envelope; chat model holder`

---

### Task 4: Tools — registry, read tools, proposal tools

**Files:**
- Create: `apps/api/src/modules/ai/tools/registry.ts`, `tools/read.ts`, `tools/propose.ts`, `apps/api/src/modules/ai/impactPort.ts`
- Test: `apps/api/test/ai-chat.test.ts` (tools section, integration)

**Interfaces:**
- Produces:
```ts
export interface ToolCtx { db: Queryable; user: ReqUser; conversation: Conversation; document: Document | null; model: ModelClient | null; log: FastifyBaseLogger }
export interface ToolDef<A> { name: AiToolName; description: string; args: z.ZodType<A>; run(ctx: ToolCtx, args: A): Promise<{ ok: true; summary: string; data: unknown } | { ok: false; summary: string }> }
export const TOOL_DEFS: Record<AiToolName, ToolDef<any>>;
export function specsFor(names: AiToolName[]): ChatToolSpec[];          // zod → JSON schema via zod-to-json-schema (already a dependency through fastify-type-provider-zod)
export async function runTool(ctx: ToolCtx, allowed: Set<AiToolName>, call: ToolCall): Promise<{ ok: boolean; summary: string; data?: unknown; proposedEdits?: ProposedEditOp[]; refined?: { suggestionId: string; editedPayload: SuggestionPayload } }>;
```
- Tool names and argument schemas (exact):

| tool | args | returns `data` |
|---|---|---|
| `read_document` | `{ documentId: uuid }` | title, status, worlds, tags, phases → steps (key, num, title, actions text, outcomes, branch) — via `getVisibleDocument` + `hasScope` |
| `read_topic` | `{ topicId: uuid }` | topic view items (type, title, description) — `taxonomy/repo.ts` `topicView(q, id, { unpublished: canReadUnpublished(user), worldScopes })` |
| `search_kb` | `{ q: string(≥2, ≤120), limit?: 1..10 }` | `search(db, { q, limit, types: 'documents,steps' }, null, user.worldScopes, canReadUnpublished(user))` groups → flat hits |
| `explain_step` | `{ documentId: uuid, stepKey: string }` | the step + its outcomes' targets and inbound goto sources (from the assembled document) |
| `read_source` | `{ documentId: uuid }` | `getSourceDocument` → `{ version, text (≤ maxContextChars), paragraphs: htmlToParagraphs(html).map(ref,text) }` |
| `read_impact` | `{ documentId: uuid }` | `impactPort.impactOf(documentId, user)` → `ImpactSet` |
| `list_suggestions` | `{ documentId?: uuid, sourceRevisionId?: uuid, status?: 'pending'|'accepted'|'rejected' }` | `SuggestionService.list` rows (id, type, title, targetStepKey, confidence, status, payload) filtered to documents the user may see |
| `propose_source_edit` | `{ documentId: uuid, instruction: string(≤2000), scope?: { paragraphRefs?: string[] } }` | runs a **second model call** (see below) that rewrites only the addressed paragraphs, then `diffToOps(currentParagraphs, proposedParagraphs)`; returns `proposedEdits` ops (persisted by the orchestrator) |
| `refine_suggestion` | `{ suggestionId: uuid, instruction: string(≤2000) }` | second model call with the suggestion payload + instruction, output validated by `SuggestionPayloadSchema` and `payload.type === suggestion.type`; returns `refined` |
| `review_document` | `{ documentId: uuid, focus?: 'clarity'|'completeness'|'consistency'|'all' }` | findings `{ severity: 'high'|'medium'|'low', stepKey: string|null, text }[]` from a second model call; max 12 |
| `draft_step` | `{ documentId: uuid, afterStepKey: string|null, instruction: string }` | one `Step` (validated by `StepSchema`, key `draft-<n>`) the web can insert |
| `read_eval` | `{ limit?: 1..20 }` | rows of `ai_eval_runs` (X1's table; `to_regclass` guard → `[]` when absent) |

Second-model-call tools use `ctx.model.chat` with **no tools** and a JSON `format` where the shape is fixed (`refine_suggestion`, `review_document`, `draft_step`); `propose_source_edit` asks for plain text paragraphs separated by blank lines with the original `§ref` prefix retained so `diffToOps` can anchor them. All of them are bounded by `maxContextChars` (truncate the source text, keep the addressed paragraphs whole).

- [ ] **Step 1: Write the failing tests** (append to `ai-chat.test.ts`; fixture: an admin creates a published `tech` document via `POST /api/v1/documents` + `PUT /structure` + `/publish`, a draft `billing` document, a source document via `PUT /api/v1/documents/:id/source`):

```ts
run('ai tools', () => {
  // …setup like scope-leak.test.ts: admin (all perms), agent (docs.read, ai.ask), scopedEditor (editor perms + ai.chat, scopes ['tech'])
  it('read_document respects visibility and scope', async () => {
    const ctx = mkCtx(agent);
    const ok = await runTool(ctx, new Set(toolsFor(permsOf(agent))), { id: 'c1', name: 'read_document', args: { documentId: techDoc } });
    expect(ok.ok).toBe(true);
    const hidden = await runTool(ctx, new Set(toolsFor(permsOf(agent))), { id: 'c2', name: 'read_document', args: { documentId: billingDraft } });
    expect(hidden.ok).toBe(false);
    expect(JSON.stringify(hidden)).not.toContain(SECRET);
  });
  it('refuses a tool outside the caller’s tier even when asked', async () => {
    const r = await runTool(mkCtx(agent), new Set(toolsFor(permsOf(agent))), { id: 'c3', name: 'propose_source_edit', args: { documentId: techDoc, instruction: 'x' } });
    expect(r).toMatchObject({ ok: false, summary: expect.stringContaining('אין הרשאה') });
  });
  it('rejects malformed arguments with a summary, not an exception', async () => {
    const r = await runTool(mkCtx(admin), new Set(toolsFor(permsOf(admin))), { id: 'c4', name: 'search_kb', args: { q: 'a' } });
    expect(r.ok).toBe(false);
  });
  it('propose_source_edit turns the model’s rewrite into anchored ops and writes nothing', async () => {
    const model = fakeChat(() => ({ content: '§p-1\nהחלף את הסים ובדוק תקינות.\n\n§p-2\nפסקה שנייה ללא שינוי.', toolCalls: [], tokensIn: 1, tokensOut: 1 }));
    const r = await runTool({ ...mkCtx(admin), model }, new Set(toolsFor(permsOf(admin))), { id: 'c5', name: 'propose_source_edit', args: { documentId: techDoc, instruction: 'קצר את הפסקה הראשונה' } });
    expect(r.ok).toBe(true);
    expect(r.proposedEdits).toEqual([expect.objectContaining({ anchor: 'p-1', kind: 'replace' })]);
    const src = await db.pool.query('select current_version from source_documents where document_id=$1', [techDoc]);
    expect(src.rows[0].current_version).toBe(1); // untouched
  });
  it('refine_suggestion returns a payload of the same type or fails closed', async () => {
    const bad = fakeChat(() => ({ content: JSON.stringify({ type: 'new-step', afterStepKey: null, title: 'x', actions: [] }), toolCalls: [], tokensIn: 1, tokensOut: 1 }));
    const r = await runTool({ ...mkCtx(admin), model: bad }, new Set(toolsFor(permsOf(admin))), { id: 'c6', name: 'refine_suggestion', args: { suggestionId, instruction: 'x' } });
    expect(r.ok).toBe(false); // suggestion is update-step
  });
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement `registry.ts`**

```ts
export async function runTool(ctx, allowed, call) {
  const def = TOOL_DEFS[call.name as AiToolName];
  if (!def) return { ok: false, summary: `כלי לא מוכר: ${call.name}` };
  if (!allowed.has(def.name)) return { ok: false, summary: 'אין הרשאה להפעיל כלי זה' };
  const parsed = def.args.safeParse(call.args ?? {});
  if (!parsed.success) return { ok: false, summary: 'ארגומנטים לא תקינים: ' + parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ') };
  try { return await def.run(ctx, parsed.data); }
  catch (e) { const he = e as { statusCode?: number; message?: string }; ctx.log.warn({ tool: def.name, err: he.message }, 'tool failed'); return { ok: false, summary: he.statusCode === 404 ? 'לא נמצא' : 'הכלי נכשל' }; }
}
export const specsFor = (names: AiToolName[]): ChatToolSpec[] => names.map((n) => ({ name: n, description: TOOL_DEFS[n].description, parameters: zodToJsonSchema(TOOL_DEFS[n].args, { target: 'openApi3' }) as Record<string, unknown> }));
```
`read.ts` and `propose.ts` implement the table above; every document-addressed tool starts with `const doc = await getVisibleDocument(ctx.db, args.documentId, ctx.user); if (!doc || !hasScope(ctx.user, doc.worlds)) return { ok: false, summary: 'לא נמצא' };`. `impactPort.ts`: `export const impactPort: { impactOf(q, documentId, user): Promise<ImpactSet> }` implemented locally with `inboundFor(q, { kind: 'document', key: id }, user.worldScopes, canReadUnpublished(user))`, blocks/fields from the assembled steps (`blockId`, `step_field_refs`), topics from `document_topics`, related from `documents.related` — X6 swaps in X1's `ImpactService`.

`diffToOps` lives in `proposedEdits.ts` (Task 6) but is a pure function; implement it now: pair paragraphs by `§ref`; for each ref present in both with different normalized text → `replace {anchor: ref, before, after}`; refs only in the proposal (`§new-<n>` after `§ref`) → `insert {anchor: previous ref, before: '', after}`; refs missing from the proposal when the instruction scope named them → `delete`. Unaddressed paragraphs (outside `scope.paragraphRefs`, when given) are never diffed.

- [ ] **Step 4: Run** → PASS. Commit — `feat(api): AI tool registry — permission-gated, zod-validated read and proposal tools`

---

### Task 5: Orchestrator and the streaming message route

**Files:**
- Create: `apps/api/src/modules/ai/prompt.ts`, `chat.ts`, `sse.ts`, `rateLimit.ts`, `routes.ts` (conversation + message routes; the rest in Task 6), `index.ts`
- Modify: `apps/api/src/modules/index.ts` (one import + list entry)
- Test: `apps/api/test/ai-chat.test.ts` (routes section), `apps/api/test/unit/ai-prompt.test.ts`

**Interfaces:**
- Produces:
```ts
export class ChatOrchestrator {
  constructor(deps: { db: pg.Pool; chat: ChatModelHolder; suggestModel: ModelClient | null; events: EventBus; log: FastifyBaseLogger; settings: () => Promise<AiSettings> });
  /** Streams events to `emit` in order and persists as it goes; resolves with the assistant message id. Never throws after the first event: errors become `{ type: 'error' }` + `done`. */
  run(input: { conversation: Conversation; user: ReqUser; content: string; context?: SendMessageBody['context']; emit: (e: ChatEvent) => void; signal: AbortSignal }): Promise<{ messageId: string }>;
}
export const MAX_TOOL_ROUNDS = 6;
export function buildSystemPrompt(input: { settings: AiSettings; kind: ConversationKind; document: Document | null; source: { version: number; text: string } | null; allowed: AiToolName[]; budgetChars: number }): string;
export function checkRate(userId: string, limitPerHour: number): { ok: true } | { ok: false; retryAfterSec: number };  // in-process sliding window (Map<userId, number[]>)
```
- Routes (this task): `POST /ai/conversations`, `GET /ai/conversations`, `GET /ai/conversations/:id`, `POST /ai/conversations/:id/messages` (SSE).

- [ ] **Step 1: Unit test for the prompt budget** (`test/unit/ai-prompt.test.ts`):

```ts
it('keeps the system prompt inside the char budget and always includes brief, style and rules', () => {
  const p = buildSystemPrompt({ settings: { ...defaults, brief: { text: 'א'.repeat(50_000), version: 1 } }, kind: 'editor', document: bigDoc, source: { version: 3, text: 'ב'.repeat(50_000) }, allowed: ['read_document'], budgetChars: 24_000 });
  expect(p.length).toBeLessThanOrEqual(24_000);
  expect(p).toContain('סגנון');                 // style header survives
  expect(p).toContain('אינך משנה מסמכים בעצמך'); // the never-write rule is not truncatable
});
it('article kind states the read-only role and cites step numbers', () => {
  expect(buildSystemPrompt({ settings: defaults, kind: 'article', document: bigDoc, source: null, allowed: ['read_document','explain_step'], budgetChars: 24_000 })).toMatch(/ציין את מספר השלב/);
});
```
Order of truncation (drop from the end first): source text → document steps text → brief → style; the fixed rules block (never write; propose only; answer in Hebrew; cite steps; say "לא יודע" when the tools return nothing) is never truncated.

- [ ] **Step 2: Integration tests for the route** (append to `ai-chat.test.ts`; parse the SSE body of `app.inject` into events):

```ts
const sse = (body: string): ChatEvent[] => body.split('\n\n').filter((f) => f.startsWith('data: ')).map((f) => JSON.parse(f.slice(6)));

it('streams token → tool_call → tool_result → done and persists them in order', async () => {
  app.aiChat.swap(fakeChat(({ messages }) => messages.some((m) => m.role === 'tool')
    ? { content: 'לפי שלב 2, יש לאפס APN.', toolCalls: [], tokensIn: 5, tokensOut: 7 }
    : { content: '', toolCalls: [{ id: 'c1', name: 'read_document', args: { documentId: techDoc } }], tokensIn: 5, tokensOut: 1 }));
  const c = await post('/api/v1/ai/conversations', { kind: 'editor', documentId: techDoc }, editor);
  const cid = c.json().id;
  const r = await app.inject({ method: 'POST', url: `/api/v1/ai/conversations/${cid}/messages`, headers: auth(editor), payload: { content: 'מה עושים כשאין גלישה?' } });
  expect(r.statusCode).toBe(200);
  expect(r.headers['content-type']).toMatch(/text\/event-stream/);
  const ev = sse(r.body);
  expect(ev.map((e) => e.type)).toEqual(['tool_call', 'tool_result', 'token', 'token', 'token', 'token', 'done']);
  const done = ev.at(-1) as Extract<ChatEvent, { type: 'done' }>;
  const detail = (await get(`/api/v1/ai/conversations/${cid}`, editor)).json();
  expect(detail.messages.map((m: AiMessage) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
  expect(detail.messages.at(-1).id).toBe(done.messageId);
  expect(detail.messages.at(-1).tokensOut).toBe(7);
  expect(detail.messages[2].toolResults[0].ok).toBe(true);
});
it('an agent gets only the ask tools and cannot make the model run a write tool', async () => {
  const seen: string[][] = [];
  app.aiChat.swap(fakeChat(({ tools, messages }) => { seen.push(tools); return messages.some((m) => m.role === 'tool') ? { content: 'לא אוכל לערוך.', toolCalls: [], tokensIn: 1, tokensOut: 1 } : { content: '', toolCalls: [{ id: 'x', name: 'propose_source_edit', args: { documentId: techDoc, instruction: 'x' } }], tokensIn: 1, tokensOut: 1 }; }));
  const c = await post('/api/v1/ai/conversations', { kind: 'article', documentId: techDoc }, agent);
  const r = await app.inject({ method: 'POST', url: `/api/v1/ai/conversations/${c.json().id}/messages`, headers: auth(agent), payload: { content: 'שנה את המסמך' } });
  const ev = sse(r.body);
  expect(seen[0].sort()).toEqual(['explain_step', 'read_document', 'read_topic', 'search_kb']);
  expect(ev.find((e) => e.type === 'tool_result')).toMatchObject({ ok: false });
  const src = await db.pool.query('select count(*)::int n from ai_proposed_edits');
  expect(src.rows[0].n).toBe(0);
});
it('stops after MAX_TOOL_ROUNDS and still ends with done', async () => {
  app.aiChat.swap(fakeChat(() => ({ content: '', toolCalls: [{ id: 'l', name: 'search_kb', args: { q: 'APN' } }], tokensIn: 1, tokensOut: 1 })));
  const c = await post('/api/v1/ai/conversations', { kind: 'editor', documentId: techDoc }, editor);
  const ev = sse((await app.inject({ method: 'POST', url: `/api/v1/ai/conversations/${c.json().id}/messages`, headers: auth(editor), payload: { content: 'לולאה' } })).body);
  expect(ev.filter((e) => e.type === 'tool_call').length).toBe(MAX_TOOL_ROUNDS);
  expect(ev.at(-1)?.type).toBe('done');
});
it('403s an agent opening an editor conversation and 404s a conversation of another user', async () => {
  expect((await post('/api/v1/ai/conversations', { kind: 'editor', documentId: techDoc }, agent)).statusCode).toBe(403);
  const mine = await post('/api/v1/ai/conversations', { kind: 'editor', documentId: techDoc }, editor);
  expect((await get(`/api/v1/ai/conversations/${mine.json().id}`, otherEditor)).statusCode).toBe(404);
});
it('429s past ai.limits.chatPerUserPerHour', async () => {
  await withTransaction(db.pool, (tx) => putAiSettings(tx, { limits: { chatPerUserPerHour: 1 } }, admin.id));
  const c = await post('/api/v1/ai/conversations', { kind: 'editor', documentId: techDoc }, editor);
  await app.inject({ method: 'POST', url: `/api/v1/ai/conversations/${c.json().id}/messages`, headers: auth(editor), payload: { content: '1' } });
  const r = await app.inject({ method: 'POST', url: `/api/v1/ai/conversations/${c.json().id}/messages`, headers: auth(editor), payload: { content: '2' } });
  expect(r.statusCode).toBe(429);
  expect(r.json().code).toBe('AI_RATE_LIMITED');
  await withTransaction(db.pool, (tx) => putAiSettings(tx, { limits: { chatPerUserPerHour: 60 } }, admin.id));
});
```

- [ ] **Step 3: Implement**

`sse.ts`:
```ts
export function openSse(reply: FastifyReply): { send(e: ChatEvent): void; close(): void; signal: AbortSignal } {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write(': connected\n\n');
  const ctl = new AbortController();
  const hb = setInterval(() => res.write(': hb\n\n'), 15_000);
  res.on('close', () => { clearInterval(hb); ctl.abort(); });
  return { send: (e) => res.write(`data: ${JSON.stringify(e)}\n\n`), close: () => { clearInterval(hb); res.end(); }, signal: ctl.signal };
}
```
`chat.ts` (core loop):
```ts
async run(input) {
  const started = Date.now();
  const settings = await this.deps.settings();
  const promptVersion = currentPromptVersion(settings);
  const allowed = toolsFor(input.user.permissions).filter((t) => KIND_TOOLS[input.conversation.kind].includes(t)); // article: ask tools only, whatever the caller holds
  const document = input.conversation.documentId ? await getVisibleDocument(this.deps.db, input.conversation.documentId, input.user).catch(() => null) : null;
  const source = document && allowed.includes('read_source') ? await getSourceDocument(this.deps.db, document.id) : null;
  const system = buildSystemPrompt({ settings, kind: input.conversation.kind, document, source: source && { version: source.version, text: source.text }, allowed, budgetChars: settings.limits.maxContextChars });
  const history = await listMessages(this.deps.db, input.conversation.id);
  const userMsg = await withTransaction(this.deps.db, async (tx) => insertMessage(tx, { …role: 'user', content: input.content, … }));
  const messages: ChatMessage[] = [{ role: 'system', content: system }, ...history.map(toChatMessage), { role: 'user', content: withContext(input.content, input.context) }];
  let assistantId: string | null = null; let tokensIn = 0, tokensOut = 0; let finalContent = '';
  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const r = await this.deps.chat.chat({ messages, tools: round < MAX_TOOL_ROUNDS ? specsFor(allowed) : [], onToken: (t) => input.emit({ type: 'token', text: t }), signal: input.signal });
      tokensIn += r.tokensIn; tokensOut += r.tokensOut;
      if (!r.toolCalls.length || round === MAX_TOOL_ROUNDS) { finalContent = r.content; break; }
      // persist the assistant turn that asked, run tools, persist the tool turn, loop
      await withTransaction(this.deps.db, async (tx) => insertMessage(tx, { …role: 'assistant', content: r.content, toolCalls: r.toolCalls, … }));
      messages.push({ role: 'assistant', content: r.content, toolCalls: r.toolCalls });
      const results = [];
      for (const call of r.toolCalls) {
        input.emit({ type: 'tool_call', id: call.id, name: call.name, args: call.args });
        const res = await runTool(ctx, new Set(allowed), call);
        input.emit({ type: 'tool_result', id: call.id, ok: res.ok, summary: res.summary });
        if (res.proposedEdits?.length) { const pe = await withTransaction(this.deps.db, (tx) => createProposedEdits(tx, { messageId: /* the tool message id, inserted below */, documentId: document!.id, baseSourceVersion: source!.version, ops: res.proposedEdits! })); input.emit({ type: 'proposed_edits', proposedEditsId: pe.id, ops: pe.ops }); }
        if (res.refined) input.emit({ type: 'refined_suggestion', suggestionId: res.refined.suggestionId, editedPayload: res.refined.editedPayload });
        results.push({ id: call.id, ok: res.ok, summary: res.summary, data: res.ok ? res.data : undefined });
        messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(res.ok ? { ok: true, data: res.data } : { ok: false, error: res.summary }).slice(0, 12_000) });
      }
      await withTransaction(this.deps.db, async (tx) => insertMessage(tx, { …role: 'tool', content: '', toolResults: results, proposedEdits: …, … }));
    }
  } catch (e) {
    input.emit({ type: 'error', code: input.signal.aborted ? 'AI_ABORTED' : 'AI_FAILED', message: 'המודל לא הצליח לענות' });
    this.deps.log.warn({ err: (e as Error).message }, 'chat failed');
  }
  const done = await withTransaction(this.deps.db, async (tx) => { const m = await insertMessage(tx, { …role: 'assistant', content: finalContent, tokensIn, tokensOut, latencyMs: Date.now() - started, model: this.deps.chat.name, promptVersion }); await touchConversation(tx, input.conversation.id, titleFrom(history, input.content)); await this.deps.events.publish(tx, makeEvent('ai.message', { conversationId: input.conversation.id, messageId: m.id, userId: input.user.id })); return m; });
  input.emit({ type: 'done', messageId: done.id, tokensIn, tokensOut, latencyMs: Date.now() - started });
  return { messageId: done.id };
}
```
(Persist the tool message **before** running the tools so `createProposedEdits` has its `messageId`; update it with `toolResults` afterwards via `updateMessage`. `KIND_TOOLS`: `article` → the four ask tools; `editor`/`workspace` → all.) `titleFrom`: first user message, first 60 chars, only when the conversation title is empty.

`routes.ts` (Task 5 part): `POST /ai/conversations` — `ai.ask` for `kind: 'article'`, `ai.chat` otherwise (check in-handler: `if (body.kind !== 'article' && !hasPerm(user, 'ai.chat')) throw forbidden()`; route `requires: ['ai.ask']`), `scope: 'document'` when `documentId` given (validate `assertVisibleDocument` + `hasScope`); `GET /ai/conversations` (own; `ai.manage` may pass `mine=false`); `GET /ai/conversations/:id` (owner or `ai.manage`, else 404); `POST /ai/conversations/:id/messages` — owner check, `checkRate(user.id, settings.limits.chatPerUserPerHour)` → 429 `AI_RATE_LIMITED` with `retry-after`, `if (!(await app.aiChat.available()))` → 503 `AI_UNAVAILABLE`, then `openSse` and `orchestrator.run(...)`; `schema.hide: true` for the SSE route body is **not** allowed (route-coverage needs it in OpenAPI) — declare `body: SendMessageBodySchema` and `response: { 200: z.string() }` with `produces: ['text/event-stream']`.

`index.ts`:
```ts
export default async function aiModule(app: FastifyInstance) {
  app.decorate('aiChat', new ChatModelHolder(await makeChatModel(app.config, app.log)));
  const orchestrator = new ChatOrchestrator({ db: app.db, chat: app.aiChat, suggestModel: app.model, events: app.events, log: app.log, settings: () => getAiSettings(app.db) });
  await app.register(aiRoutes({ orchestrator }));
}
```
and one line `ai` appended to the list in `modules/index.ts`.

- [ ] **Step 4: Run** unit + integration → PASS. Commit — `feat(api): AI chat orchestrator, SSE message route, conversations`

---

### Task 6: Proposed edits, feedback, admin routes, export

**Files:**
- Create: `apps/api/src/modules/ai/proposedEdits.ts`, `export.ts`
- Modify: `apps/api/src/modules/ai/routes.ts`
- Test: `apps/api/test/ai-proposed-edits.test.ts`, `apps/api/test/ai-admin.test.ts`, `apps/api/test/unit/ai-proposed-edits.test.ts`

**Interfaces:**
- Produces:
```ts
export function diffToOps(current: Paragraph[], proposed: { ref: string; text: string }[], scope?: string[]): ProposedEditOp[];
export function applyOps(html: string, ops: ProposedEditOp[]): string;                      // paragraph-level, anchored by ref order; throws AI_EDIT_ANCHOR when a `before` no longer matches
export async function decideProposedEdits(app, req, id: string, body: DecideProposedEditsBody): Promise<DecideProposedEditsResult>;
```
- Routes: `POST /ai/proposed-edits/:id/decide` (`ai.chat`; owner of the conversation or `ai.manage`), `POST /ai/messages/:id/feedback` (`ai.ask`; participant only), `GET /admin/ai/conversations`, `GET /admin/ai/conversations/export.jsonl`, `DELETE /admin/ai/conversations/:id` (`ai.manage`).

- [ ] **Step 1: Unit tests** (`test/unit/ai-proposed-edits.test.ts`):
```ts
it('applyOps replaces exactly the anchored paragraph and leaves the rest byte-identical', () => {
  const html = '<h2>כותרת</h2><p>ראשון</p><p>שני</p>';
  const out = applyOps(html, [{ id: 'o1', anchor: 'p-1', kind: 'replace', before: 'ראשון', after: 'ראשון מעודכן' }]);
  expect(out).toBe('<h2>כותרת</h2><p>ראשון מעודכן</p><p>שני</p>');
});
it('applyOps refuses a stale before', () => {
  expect(() => applyOps('<p>א</p>', [{ id: 'o', anchor: 'p-1', kind: 'replace', before: 'ב', after: 'ג' }])).toThrow(/AI_EDIT_ANCHOR/);
});
it('diffToOps yields replace/insert/delete by ref', () => {
  const cur = htmlToParagraphs('<p>א</p><p>ב</p><p>ג</p>');
  const ops = diffToOps(cur, [{ ref: cur[0].ref, text: 'א1' }, { ref: cur[2].ref, text: 'ג' }, { ref: 'new-1', text: 'ד' }], cur.map((p) => p.ref));
  expect(ops.map((o) => o.kind)).toEqual(['replace', 'delete', 'insert']);
});
```
`applyOps` parses the HTML with `node-html-parser`, walks block elements in document order assigning the same refs `htmlToParagraphs` assigns (reuse its ref generator — export `paragraphRefs(html)` from `packages/shared/src/format/htmlParagraphs.ts` if it is not already exported; that is an additive shared change, state it), replaces `textContent` of the addressed block (keeping the tag), inserts `<p>` after the anchor for `insert`, removes the block for `delete`, and returns `sanitizeHtml(root.toString())`.

- [ ] **Step 2: Integration tests** (`ai-proposed-edits.test.ts`): a conversation whose fake model returns `propose_source_edit` ops → `POST /api/v1/ai/proposed-edits/:id/decide { accept: 'all', reject: [] }` → 200, `resultingSourceVersion` = previous + 1, `source_documents.html` contains the new text, an `audit_log` row `ai.proposed_edits.apply` with the message id, a `source_revisions` row (ingest ran), status `accepted`; partial accept → `partially_accepted` and only the accepted op applied; a second decide on the same id → 409 `ALREADY_DECIDED`; editing the source in between (`PUT /source`) → decide answers 409 `SOURCE_MOVED`; a non-owner editor → 404; an agent → 403.
  `ai-admin.test.ts`: feedback up/down upsert (participant only; other user 404), `GET /admin/ai/conversations` requires `ai.manage`, export streams `application/x-ndjson` with one line per conversation containing `messages[]` and `feedback[]`, `DELETE` soft-deletes and the owner's `GET` then 404s; `route-coverage` covers all seven new operations.

- [ ] **Step 3: Implement** — `decideProposedEdits`: load + owner check → `getSourceDocument` → if `current.version !== pe.baseSourceVersion` → 409 `SOURCE_MOVED` → compute accepted op set (`'all'` or ids; reject wins on overlap) → `applyOps` → `withTransaction`: `saveSourceDocument(tx, documentId, { html, label: 'מהצ׳אט', authorId: user.id, ifMatch: current.etag })`, `audit(tx, { action: 'ai.proposed_edits.apply', entityType: 'source_document', entityId: documentId, before: { version: current.version }, after: { version: saved.version, accepted: ids, messageId } })`, `decideProposedEdits(tx, id, status, user.id, saved.version)`, `events.publish(tx, makeEvent('source_document.saved', …))` → after commit `ingestSourceHtml(app, documentId, html, user.id)` exactly as `sourcedocs/routes.ts` does (reuse `enqueueIngestRetry` if exported; otherwise call `ingestSourceHtml` in a `try` and log — do not fail the decide). `export.ts`: `reply.raw` streaming of `JSON.stringify(row) + '\n'` per conversation from `exportCursor`.

- [ ] **Step 4: Run** all three test files + `route-coverage` → PASS. Commit — `feat(api): proposed-edit decisions, message feedback, admin transcript list/export/delete`

---

### Task 7: Boundary rows, OpenAPI, gate, report

**Files:**
- Modify: `apps/api/test/int/scope-leak.test.ts`, `docs/api/openapi.json` (regenerate), `apps/api/test/route-coverage-allowlist.json` (only if unavoidable — it should not be)

- [ ] **Step 1: Scope-leak rows** — add to the W2 unpublished-reader table and the scoped-user table: `POST /api/v1/ai/conversations { kind:'article', documentId: billingDoc }` → 404/403 for the scoped user; a conversation on `techDoc` whose fake model calls `read_document` on `billingDoc` and `search_kb` for `SECRET` → the SSE body contains no `SECRET` and the tool results are `ok: false`; the export as admin contains it (control).
- [ ] **Step 2: Gate** — `pnpm -r build && pnpm typecheck && pnpm lint`, `pnpm --filter @wecom/model test`, `RUN_INTEGRATION=1 pnpm --filter @wecom/api test:int` (known flakes `boss.test.ts`, `sources/routes.test.ts`), `pnpm openapi` + contract + route-coverage tests. The OpenAPI diff must be exactly the new `/api/v1/ai/**` and `/api/v1/admin/ai/conversations*` operations.
- [ ] **Step 3: Report** — `.superpowers/sdd/program/X2-report.md`: per-task status, commits, counts, deviations, the exact tool table, `ChatOrchestrator` API, `app.aiChat.swap` for tests, what X6 must re-point (`impactPort.ts`), and the shared-file touches (`ollama.ts`, `htmlParagraphs.ts` if `paragraphRefs` was exported).

## Self-review

- Spec coverage: §1.3 (proposals only — `propose_source_edit`/`refine_suggestion` return, `decide` is the only write and reuses `saveSourceDocument`), §1.4 (three kinds, per-kind and per-permission tool sets), §1.5 (every message, tool call, result, tokens, latency, prompt version persisted; feedback; JSONL export; admin delete), §3 tables (Task 1), §4.3/§4.4 routes and events (Tasks 5–6), §5 behaviours that are backend (streaming, cited steps in the article prompt).
- Placeholders: none — code blocks are complete where the plan writes code; where a helper is "as in X" the exact file and function are named.
- Type consistency: `ChatEvent` variants match X0's `ChatEventSchema` names (`token`, `tool_call`, `tool_result`, `proposed_edits`, `refined_suggestion`, `done`, `error`); tool names match `AI_TOOLS`; `runTool`'s return feeds exactly the fields the orchestrator emits.
