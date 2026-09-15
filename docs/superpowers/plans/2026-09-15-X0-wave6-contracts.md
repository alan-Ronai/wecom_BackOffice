# X0 — Wave 6 Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land on `main`, before any wave 6 lane is dispatched, every shared name lanes X1–X6 consume: `packages/shared/src/schemas/wave6.ts`, three permissions, one event, two queues, the model-contract additions (`chat`, `embedBatch`, impact-aware `ProposalContext` fields), the config model slots and tier presets, the AI settings reader, migration 0050, and `docs/api/CONTRACTS-wave6.md`.

**Architecture:** Additive to the existing contract layer (ADR 0001). Defaults do not change behaviour on main: `MODEL_TIER` is unset by default, `SUGGEST_MODEL`/`CHAT_MODEL` fall back to `MODEL_NAME`, `EMBED_MODEL`/`EMBED_DIMENSION` keep today's defaults until X1's migration 0051 and tier switch land together. Settings live in `app_settings` under `ai.*` keys with a version table, read through one `getAiSettings(q)` in `apps/api/src/lib/aiSettings.ts` mirroring wave 5's `workflowSettings.ts`.

**Tech Stack:** TypeScript strict, zod 3, Fastify 5, node-pg-migrate, vitest 2.

**Spec:** `docs/superpowers/specs/2026-09-15-kb-wave6-ai-copilot-design.md` (§1 decisions, §2 lanes, §3 data model, §4 API, §6 tiers).

## Global Constraints

- Node `>=22`, pnpm `>=9`, TypeScript `strict: true`; run from the repo root.
- New schemas only in `packages/shared/src/schemas/wave6.ts` (+ additive fields on `SuggestionSchema` in `pipeline.ts`); never duplicated in apps.
- Append-only edits to `permissions.ts`, `events.ts`, `apps/api/src/plugins/boss.ts`, `packages/model/src/contract.ts`, `apps/api/src/config.ts`.
- Migration for this plan: `apps/api/migrations/0050_wave6_ai_settings.js`. Lanes own 0051 (X1), 0052 (X2), 0053 (X3), 0054 (X6). The other session reserves nothing below 0055. `checkOrder` is on.
- Peer constraints (binding): keep `EMBED_DIMENSION`'s boot check against `documents.embedding` (`apps/api/src/plugins/model.ts` / `lib/embedStatus.ts`); anything that wraps `app.model.embed` must also wrap `embedBatch`; `guardedFetch` (`packages/connectors/src/guards.ts`) is the only sanctioned outbound fetch; no inline scripts (CSP); `apps/api/test/route-coverage.test.ts` requires an integration test naming every new operation's path.
- Hebrew user-facing labels; conventional commits ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Canonical names produced by this plan (lanes import these verbatim)

| Concern | Name |
|---|---|
| Permissions | `ai.ask` (agent+), `ai.chat` (editor+), `ai.manage` (admin only) |
| Event | `ai.message { conversationId, messageId, userId }` |
| Queues | `QUEUES.aiEval = 'ai.eval'`, `QUEUES.aiReindex = 'ai.reindex'` |
| Config | `MODEL_TIER` (0–4, optional), `SUGGEST_MODEL` (default `MODEL_NAME`), `CHAT_MODEL` (default `MODEL_NAME`), `MODEL_TIER_PRESETS` (exported from `wave6.ts`, §6 table), `resolveModelSlots(config)` in `apps/api/src/lib/modelSlots.ts` → `{ tier, suggestModel, chatModel, embedModel, embedDimension }` (explicit env beats preset beats today's defaults) |
| Settings | keys `ai.brief`, `ai.style`, `ai.models`, `ai.limits` (`AI_SETTINGS_KEYS`); `getAiSettings(q): Promise<AiSettings>`, `putAiSettings(tx, patch, actorId)` (writes `ai_setting_versions`), `currentPromptVersion(settings)` = `'v3.' + brief.version + '.' + style.version` |
| Model contract (`packages/model/src/contract.ts`, additive) | `ChatMessage { role: 'system'|'user'|'assistant'|'tool'; content: string; toolCalls?: ToolCall[]; toolCallId?: string }`, `ToolCall { id, name, args: Record<string, unknown> }`, `ChatToolSpec { name, description, parameters: JsonSchema }`, `ChatResult { content: string; toolCalls: ToolCall[]; tokensIn: number; tokensOut: number }`, `ModelClient.chat?(input: { model?: string; messages: ChatMessage[]; tools?: ChatToolSpec[]; onToken?: (t: string) => void; signal?: AbortSignal }): Promise<ChatResult>`, `ModelClient.embedBatch?(texts: string[]): Promise<number[][]>`, `ProposalContext` += `brief?: string; style?: string; impact?: ImpactSet; examples?: FewShotExample[]`, `ImpactSet { documents: {id,title,why}[]; blocks: {id,title,usedBy:number}[]; fields: {name,usedBy:number}[]; topics: {id,name}[]; related: {id,title,similarity}[] }`, `FewShotExample { diff: string; suggestion: ProposedSuggestion }` |
| Conversations (`wave6.ts`) | `ConversationKindSchema` (`workspace|editor|article`), `ConversationSchema`, `CreateConversationBodySchema`, `ConversationsQuerySchema`, `ConversationsResponseSchema` (paginated), `MessageRoleSchema`, `AiMessageSchema`, `ConversationDetailSchema { conversation, messages }`, `SendMessageBodySchema { content (1..8000), context?: { stepKey?, suggestionId?, selection? (≤4000) } }`, `ChatEventSchema` (discriminated `type`: `token{text}`, `tool_call{id,name,args}`, `tool_result{id,ok,summary}`, `proposed_edits{proposedEditsId,ops}`, `refined_suggestion{suggestionId,editedPayload}`, `done{messageId,tokensIn,tokensOut,latencyMs}`, `error{code,message}`), `MessageFeedbackBodySchema { rating: 'up'|'down', note? }` |
| Proposed edits | `ProposedEditOpSchema { id, anchor, kind: 'replace'|'insert'|'delete', before: string, after: string }`, `ProposedEditsSchema { id, messageId, documentId, baseSourceVersion, ops, status: 'proposed'|'accepted'|'rejected'|'partially_accepted', decidedBy?, decidedAt?, resultingSourceVersion? }`, `DecideProposedEditsBodySchema { accept: string[] | 'all'; reject: string[] | 'all' }`, `DecideProposedEditsResultSchema { status, resultingSourceVersion: number | null }` |
| Tools | `AI_TOOLS` const: `read_document, read_topic, search_kb, explain_step` (tier `ask`), `read_source, read_impact, list_suggestions, propose_source_edit, refine_suggestion, review_document, draft_step` (tier `chat`), `read_eval` (tier `manage`); `AiToolNameSchema`, `toolsFor(permissions: ReadonlySet<string>): AiToolName[]` |
| Suggestions (additive to `pipeline.ts`) | `AffectsItemSchema { kind: 'document'|'block'|'field'|'topic', id, title, why }`, `SuggestionSchema` += `affects (default [])`, `promptVersion?`, `model?`, `editDiff?` (`StructuredEditDiffSchema`), `appliedParts?: string[]`; `StructuredEditSchema` (discriminated by `type`, rows `{ rowId, op: 'keep'|'edit'|'remove', value? }` per payload field group), `AcceptSuggestionBodySchema { parts?: string[] }`, `SuggestionAnalyticsQuerySchema { from?, to?, sourceId?, type? }`, `SuggestionAnalyticsSchema { total, byType[], bySource[], byModel[], byPromptVersion[], rates { accepted, edited, rejected }, meanMinutesToDecision }` |
| AI settings | `AiModelsSettingsSchema`, `AiLimitsSettingsSchema { chatPerUserPerHour (default 60), maxContextChars (default 24000) }`, `AiSettingsSchema { brief: { text, version }, style: { text, version }, models, limits }`, `AiSettingsPutSchema`, `AiSettingVersionSchema`, `ModelTestBodySchema { slot: 'suggest'|'chat'|'embed' }`, `ModelTestResultSchema { slot, tag, reachable, sizeBytes?, dims?, tokensPerSec? , error? }` |
| Eval | `EvalCaseSchema { id, title, source: { title, singleDocument? }, diffs, linkedSteps, blocks, fields, expected: { type, targetDocumentId?, targetStepKey?, mustContain: string[] }[] }`, `EvalRunSchema { id, model, promptVersion, embedModel, startedAt, finishedAt?, cases, hitTarget, hitType, contentOverlap, notes }`, `EvalRunsResponseSchema { items }` |
| Web routes reserved | `/workspace/:id`, `/admin/ai` |

---

### Task 1: `wave6.ts` — conversations, proposed edits, tools, settings, eval
**Files:** create `packages/shared/src/schemas/wave6.ts`; modify `schemas/index.ts` (export); test `packages/shared/test/wave6.test.ts`.
- [ ] Write failing tests: parse a `ChatEventSchema` of every type; `toolsFor(new Set(['ai.ask']))` returns exactly the four ask tools, `ai.chat` adds the seven, `ai.manage` adds `read_eval`; `AiSettingsSchema.parse({})` yields defaults (limits 60/24000, brief/style version 0, models from tier preset 1); `MODEL_TIER_PRESETS[1].embedDimension === 1024`; `DecideProposedEditsBodySchema` accepts `'all'` and id arrays; type aliases exist.
- [ ] Implement every schema in the canonical table (zod, defaults as stated; `MODEL_TIER_PRESETS` copied from spec §6 with model tags as strings; ids `IdSchema`). Export type aliases for all.
- [ ] Run `pnpm --filter @wecom/shared test` → green. Commit `feat(shared): wave 6 contracts — chat, proposed edits, tools, AI settings, eval`.

### Task 2: Suggestion additive fields and structured edits
**Files:** modify `packages/shared/src/schemas/pipeline.ts`; test `packages/shared/test/pipeline.test.ts` (extend).
- [ ] Tests: an existing suggestion literal without the new fields still parses (`affects` defaults to `[]`); `StructuredEditSchema` for `update-step` accepts `{ type:'update-step', rows:[{ rowId:'add-0', op:'edit', value:'…' }] }` and rejects an unknown op; `AcceptSuggestionBodySchema.parse({})` has no `parts`.
- [ ] Implement `AffectsItemSchema`, the additive fields, `StructuredEditSchema` (one variant per `SuggestionTypeSchema` value: `update-step` rows = addActions + patch keys + branch options; `new-card`/`new-step` rows = steps; `update-block` rows = actions; `deprecate-step` rows = `reason`; `field-alert` rows = the alert), `StructuredEditDiffSchema { rows: { rowId, op, before?, after? }[] }`, `AcceptSuggestionBodySchema`, analytics schemas. Keep the `payload.type === type` refine.
- [ ] Run shared tests → green. Commit.

### Task 3: Permissions, event, queues, model contract
**Files:** modify `permissions.ts`, `events.ts`, `apps/api/src/plugins/boss.ts`, `packages/model/src/contract.ts`; tests `permissions.test.ts`, `events.test.ts`, `packages/model/test/contract.test.ts` (create: a fake `ModelClient` with `chat`/`embedBatch` type-checks and `ProposalContext` with `impact` compiles).
- [ ] Append `ai.ask`, `ai.chat`, `ai.manage`; agent += `ai.ask`; editor += `ai.chat`; admin gets all (unchanged rule). Update the expected catalogue in the test and add the role assertions.
- [ ] Append event `ai.message` with payload `{ conversationId: IdSchema, messageId: IdSchema, userId: IdSchema }`; update the expected names list.
- [ ] Append `aiEval: 'ai.eval'`, `aiReindex: 'ai.reindex'` to `QUEUES`.
- [ ] Add the model-contract types and optional methods exactly as in the canonical table; `RuleBasedModel` implements neither (absent = unsupported).
- [ ] Run shared + model + api unit tests → green. Commit.

### Task 4: Config slots, tier resolution, AI settings reader
**Files:** modify `apps/api/src/config.ts` (append `MODEL_TIER: z.coerce.number().int().min(0).max(4).optional()`, `SUGGEST_MODEL: z.string().optional()`, `CHAT_MODEL: z.string().optional()`); create `apps/api/src/lib/modelSlots.ts`, `apps/api/src/lib/aiSettings.ts`; tests `apps/api/test/unit/modelSlots.test.ts`, `apps/api/test/unit/aiSettings.test.ts`.
- [ ] `resolveModelSlots(config)`: precedence explicit env (`SUGGEST_MODEL`, `CHAT_MODEL`, `EMBED_MODEL`, `EMBED_DIMENSION`) > `MODEL_TIER_PRESETS[MODEL_TIER]` > legacy defaults (`MODEL_NAME`, `nomic-embed-text`, 768). Tests: no tier → legacy; tier 1 → DictaLM/bge-m3/1024; tier 1 + `CHAT_MODEL=x` → chat x.
- [ ] `getAiSettings(q)` / `putAiSettings(tx, patch, actorId)`: same shape as `workflowSettings.ts` (schema parse fills defaults; `for update`; deep merge) **plus** on every change to `brief` or `style`, bump its `version` and insert into `ai_setting_versions(key, version, value, updated_by, updated_at)`; `currentPromptVersion(settings)`. Unit tests with the fake-db pattern from `workflowSettings.test.ts`.
- [ ] Do **not** change `plugins/model.ts` behaviour beyond reading `resolveModelSlots` for the names it passes to `OllamaModel` (suggest model = `slots.suggestModel`; a second `OllamaModel` instance for chat is X2's) — and keep `assertEmbeddingDimension` / `instrumentEmbedding` untouched. Run `pnpm typecheck` + api unit tests → green. Commit.

### Task 5: Migration 0050
**Files:** create `apps/api/migrations/0050_wave6_ai_settings.js`; modify `apps/api/test/migrations.test.ts`.
- [ ] Up: insert permissions (`ai.ask` resource `ai`, `ai.chat`, `ai.manage`) with grants agent→ai.ask; editor→ai.ask, ai.chat; lead→ai.ask, ai.chat; admin→all three (all `on conflict do nothing`); create `ai_setting_versions(id uuid pk default gen_random_uuid(), key text not null, version int not null, value jsonb not null, updated_by uuid references users, updated_at timestamptz default now(), unique(key, version))`; insert `app_settings` rows `ai.brief`, `ai.style`, `ai.models`, `ai.limits` with `'{}'::jsonb` `on conflict do nothing`. Down: reverse (delete rows, drop table, delete grants/permissions).
- [ ] Test: permissions present; `agent` has `ai.ask` and not `ai.chat`; table exists; four settings rows; rollback to empty still passes. Run `RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts test/migrate.test.ts` → green. Commit.

### Task 6: Contract document, OpenAPI, gate
**Files:** create `docs/api/CONTRACTS-wave6.md`; modify `docs/superpowers/plans/README.md`; regenerate `docs/api/openapi.json` (no route changes expected; confirm no drift).
- [ ] Write `CONTRACTS-wave6.md` in the wave 4/5 shape: migrations table (0050 X0, 0051 X1, 0052 X2, 0053 X3, 0054 X6), append-only shared files, never-edit list (shell, ArticlePage, EditorPage, SourcesPage, IdentityPage — X6 mounts), the route tables from spec §4.1–§4.4 grouped by lane with `Requires`, tool sets per permission, the SSE event contract for chat, web routes `/workspace/:id`, `/admin/ai`, and the deploy checklist X1 owns (ollama-pull.sh loops over both slots + embed tag with `:latest`, `ollama-pull-check.sh`, `smoke.sh` `embed_check`, `scripts/e2e-compose.mjs` tag assertion, `deploy/e2e.env`/`ci.env`).
- [ ] Append a Wave 6 table to the plan index (X0–X6 file names: `2026-09-15-X0-wave6-contracts.md`, `X1-generation-quality.md`, `X2-chat-backend.md`, `X3-suggestion-editing.md`, `X4a-workspace-web.md`, `X4b-chat-admin-web.md`, `X6-integration.md`).
- [ ] Gate: `pnpm -r build && pnpm typecheck && pnpm lint && pnpm -r test` (web `--minWorkers=1 --maxWorkers=4`), `RUN_INTEGRATION=1 pnpm --filter @wecom/api test:int`, `pnpm openapi` + contract test. Commit `docs(contracts): wave 6 contract; plan index`. Append `Wave 6 X0 on main (<sha>)` to `.superpowers/sdd/program/progress.md` (git-ignored, do not commit).

## Self-review
- Coverage: every X0 row of spec §2 has a task; §4 routes are fixed in the contract doc; §6 tiers are data (`MODEL_TIER_PRESETS`).
- No behaviour change on main: tier unset, slots default to `MODEL_NAME`, embed defaults untouched until X1.
- Type consistency: names in the canonical table are the ones Tasks 1–5 create and the contract doc references.
