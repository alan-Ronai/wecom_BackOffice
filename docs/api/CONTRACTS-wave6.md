# Wave 6 API contract (authoritative for lanes X1–X6)

Schemas: `packages/shared/src/schemas/wave6.ts` (conversations, chat stream, proposed edits, tools, AI settings, model tiers, eval) plus the additive fields merged into `SuggestionSchema` and the structured-edit/analytics schemas in `pipeline.ts`. Every route validates with those schemas, appears in `docs/api/openapi.json`, and is what `apps/web` calls. Spec: `docs/superpowers/specs/2026-09-15-kb-wave6-ai-copilot-design.md`.

X0 is on `main` before any lane starts. Nothing X0 landed changes behaviour: `MODEL_TIER` is unset, so both generation slots still resolve to `MODEL_NAME` and the embedder stays `nomic-embed-text`/768 until X1's 0051 and the tier switch land together.

## Migrations

| Lane | File | Owns |
|---|---|---|
| X0 | `0050_wave6_ai_settings.js` | `ai.ask`/`ai.chat`/`ai.manage` + grants, `ai_setting_versions`, the four `ai.*` `app_settings` rows (done) |
| X1 | `0051` | `documents.embedding` → `EMBED_DIMENSION`, `step_embeddings`, `suggestions.affects`, `suggestions.prompt_version`, `suggestions.model` |
| X2 | `0052` | `ai_conversations`, `ai_messages`, `ai_message_feedback`, `ai_proposed_edits` |
| X3 | `0053` | `suggestions.edit_diff`, `suggestions.applied_parts` |
| X6 | `0054` | seams |

`checkOrder` is on and nothing else reserves below `0055`.

## Canonical names produced by X0 (import these; do not rename)

| Concern | Name |
|---|---|
| Permissions | `ai.ask` (agent+), `ai.chat` (editor+), `ai.manage` (admin only; `approver` gets none) |
| Event | `ai.message { conversationId, messageId, userId }` — per-user SSE fan-out, like `notification.created` |
| Queues | `QUEUES.aiEval = 'ai.eval'`, `QUEUES.aiReindex = 'ai.reindex'` |
| Config | `MODEL_TIER` (0–4, optional), `SUGGEST_MODEL`, `CHAT_MODEL`; `MODEL_TIER_PRESETS` in `wave6.ts`; `resolveModelSlots(config)` in `apps/api/src/lib/modelSlots.ts` → `{ tier, suggestModel, chatModel, embedModel, embedDimension }` |
| Settings | keys `ai.brief`, `ai.style`, `ai.models`, `ai.limits` (`AI_SETTINGS_KEYS`); `getAiSettings(q)`, `putAiSettings(tx, patch, actorId)`, `currentPromptVersion(settings)` in `apps/api/src/lib/aiSettings.ts` |
| Model contract | `ChatMessage`, `ToolCall`, `ChatToolSpec`, `ChatResult`, `ModelClient.chat?`, `ModelClient.embedBatch?`, `ImpactSet`, `FewShotExample`, `ProposalContext` += `brief`, `style`, `impact`, `examples`, `maxContextChars` |
| Conversations | `ConversationKindSchema`, `ConversationSchema`, `CreateConversationBodySchema`, `ConversationsQuerySchema`, `ConversationsResponseSchema`, `MessageRoleSchema`, `AiMessageSchema`, `ConversationDetailSchema`, `SendMessageBodySchema`, `ChatEventSchema`, `MessageFeedbackBodySchema` |
| Proposed edits | `ProposedEditOpSchema`, `ProposedEditsSchema`, `DecideProposedEditsBodySchema`, `DecideProposedEditsResultSchema` |
| Tools | `AI_TOOLS`, `AiToolNameSchema`, `toolsFor(permissions)` |
| Suggestions | `AffectsItemSchema`, `SuggestionSchema` += `affects` / `promptVersion` / `model` / `editDiff` / `appliedParts`, `StructuredEditSchema`, `STRUCTURED_EDIT_ROW_GROUPS`, `StructuredEditDiffSchema`, `AcceptSuggestionBodySchema`, `SuggestionAnalyticsQuerySchema`, `SuggestionAnalyticsSchema` |
| AI settings | `AiModelsSettingsSchema`, `AiLimitsSettingsSchema`, `AiSettingsSchema`, `AiSettingsPutSchema`, `AiSettingVersionSchema`, `AiSettingVersionsResponseSchema`, `JobQueuedSchema`, `ModelTestBodySchema`, `ModelTestResultSchema` |
| Eval | `EvalCaseSchema`, `EvalLinkedStepSchema`, `EvalExpectationSchema`, `EvalRunSchema`, `EvalRunsResponseSchema` |
| Web routes reserved | `/workspace/:id` (X4a), `/admin/ai` (X4b) |

Every exported schema has a type alias of the same name without `Schema`.

The four `ai.*` settings values are **patches**, never the full object: `getAiSettings` parses them through `AiSettingsSchema`, so a key a lane does not store still reads back as its default. Add settings keys to the schema, never to a migration.

## Shared files a lane may touch (append-only)

`apps/api/src/modules/index.ts` (one import + one list entry), `apps/web/src/routes.tsx` (route entries), `packages/shared/src/events.ts` (new names + payloads only), `packages/shared/src/permissions.ts` (new names + role additions only), `apps/api/src/plugins/boss.ts` (`QUEUES` entries), `apps/web/src/api/keys.ts` (new keys), `packages/model/src/contract.ts` (new optional members only).

**Never** edit: `apps/api/src/app.ts`, `apps/web/src/components/shell/*`, `ArticlePage.tsx`, `EditorPage.tsx`, `SourcesPage.tsx`, `IdentityPage.tsx`. Ship a component plus a documented one-line mount in your lane report; X6 mounts it.

Two peer constraints are binding for every lane:

- `EMBED_DIMENSION` is held against `documents.embedding`'s own declared width at boot (`apps/api/src/plugins/model.ts` → `lib/embedStatus.ts`). X1 changes the column, the config default and the tier together, or the API does not come up. `resolveModelSlots` deliberately does **not** feed that check.
- Anything that wraps `app.model.embed` must wrap `embedBatch` too, or the reindex job silently escapes the instrumentation that `GET /system/health`'s `embedStatus` reports.

## Model tiers (spec §6)

`MODEL_TIER=n` selects a whole row; each slot is individually overridable. `resolveModelSlots` precedence is **explicit env → tier preset → today's defaults** (`MODEL_NAME`, `nomic-embed-text`, 768). Because `EMBED_MODEL`/`EMBED_DIMENSION` carry zod defaults, they count as explicit only when they differ from that legacy pair — an install that wants `nomic-embed-text` under a tier uses `MODEL_TIER=0`.

| Tier | VM | suggest | chat | embed |
|---|---|---|---|---|
| 0 | 4 vCPU / 16 GB | `qwen2.5:3b-instruct-q4_K_M` | same | `nomic-embed-text` (768) |
| 1 | 4 vCPU / 16 GB | `dictalm2.0-instruct:7b-q4_K_M` (fallback `aya-expanse:8b-q4_K_M`) | same | `bge-m3` (1024) |
| 2 | 8 vCPU / 32 GB | `gemma3:12b-it-q4_K_M` | `dictalm2.0-instruct:7b-q4_K_M` | `bge-m3` |
| 3 | 16 vCPU / 64 GB | `gemma3:27b-it-q4_K_M` | `gemma3:12b-it-q4_K_M` | `bge-m3` |
| 4 | + GPU 24 GB | `gemma3:27b-it-q4_K_M` | same | `bge-m3` |

The tags are X1's to confirm against the VM's Ollama library; `POST /admin/ai/models/test` is what proves one exists before an admin selects the tier. Changing them is a change to `MODEL_TIER_PRESETS` alone.

## Routes

### X0/X1 — AI settings and eval

| Method | Path | Body / Query | Response | Requires |
|---|---|---|---|---|
| GET | `/admin/ai/settings` | — | `AiSettingsSchema` | ai.manage |
| PUT | `/admin/ai/settings` | `AiSettingsPutSchema` | `AiSettingsSchema` (deep-merged; a brief/style text change bumps that version) | ai.manage |
| GET | `/admin/ai/settings/versions` | `?key` | `AiSettingVersionsResponseSchema` | ai.manage |
| POST | `/admin/ai/models/test` | `ModelTestBodySchema` | `ModelTestResultSchema` | ai.manage |
| POST | `/admin/ai/eval` | — | 202 `JobQueuedSchema` (queues `ai.eval`) | ai.manage |
| GET | `/admin/ai/eval/runs` | — | `EvalRunsResponseSchema` | ai.manage |
| POST | `/admin/ai/reindex` | — | 202 `JobQueuedSchema` (queues `ai.reindex`) | ai.manage |

### X1/X3 — Suggestions

Existing routes keep their paths and their permissions (`suggestions.review`, `suggestions.apply`).

| Method | Path | Body / Query | Response | Requires |
|---|---|---|---|---|
| GET | `/suggestions/:id` | — | `SuggestionSchema`, now including `affects`, `promptVersion`, `model`, `editDiff` | suggestions.review |
| PATCH | `/suggestions/:id/edit` | `StructuredEditSchema` (per type) | `SuggestionSchema` (stores `editedPayload` + `editDiff`; the original payload is kept) | suggestions.review |
| POST | `/suggestions/:id/accept` | `AcceptSuggestionBodySchema` `{ parts? }` — row ids; omitted = all | `SuggestionSchema` (`appliedParts` records what was applied) | suggestions.apply |
| GET | `/suggestions/analytics` | `SuggestionAnalyticsQuerySchema` | `SuggestionAnalyticsSchema` | analytics.read |

Row ids are `<group>-<index>` or `<group>:<key>`; the groups each type exposes are `STRUCTURED_EDIT_ROW_GROUPS` (`update-step`: `add`, `replace`, `patch`, `branch`, `outcome` · `new-card`: `phase`, `step`, `patch` · `new-step`: `step`, `action`, `outcome`, `patch` · `update-block`: `action`, `script` · `deprecate-step`: `reason` · `field-alert`: `alert`). A row id from another type's groups is a 400.

`affects` is computed **server-side** by X1 from the graph and the embeddings and is not part of `ProposedSuggestion`: a model cannot claim a change touches a document it never saw.

### X2 — Chat

| Method | Path | Body / Query | Response | Requires |
|---|---|---|---|---|
| POST | `/ai/conversations` | `CreateConversationBodySchema` | `ConversationSchema` (201) | ai.ask for `kind: 'article'`, ai.chat otherwise |
| GET | `/ai/conversations` | `ConversationsQuerySchema` | `ConversationsResponseSchema` (own only; `ai.manage` may see all) | ai.ask |
| GET | `/ai/conversations/:id` | — | `ConversationDetailSchema` | ai.ask, own conversation (or ai.manage) |
| POST | `/ai/conversations/:id/messages` | `SendMessageBodySchema` | **SSE** stream of `ChatEventSchema`, persisted as it streams | ai.ask for `article`, ai.chat otherwise |
| POST | `/ai/messages/:id/feedback` | `MessageFeedbackBodySchema` | 204 | ai.ask, own message |
| POST | `/ai/proposed-edits/:id/decide` | `DecideProposedEditsBodySchema` | `DecideProposedEditsResultSchema` | ai.chat + docs.edit |
| GET | `/admin/ai/conversations` | `ConversationsQuerySchema` (`userId`, `documentId`, `from`, `to`) | `ConversationsResponseSchema` | ai.manage |
| GET | `/admin/ai/conversations/export.jsonl` | same filters | `application/x-ndjson` | ai.manage |
| DELETE | `/admin/ai/conversations/:id` | — | 204 | ai.manage |

Rate limit: `ai.limits.chatPerUserPerHour` (default 60) → 429 `AI_RATE_LIMITED`. Context budget: `ai.limits.maxContextChars` (default 24000), passed to the assembler as `ProposalContext.maxContextChars`.

`decide` applies the accepted ops as one ordinary source save (`saveSourceDocument`, `If-Match` on `baseSourceVersion` → 409 `SOURCE_MOVED`), labelled "מהצ'אט" with the message id in the audit row. Rejecting everything is a decision too: `resultingSourceVersion` is then `null`.

### SSE event contract

One `ChatEventSchema` frame per SSE `data:` line, in this order: any number of `token` / `tool_call` / `tool_result`, then at most one `proposed_edits` or `refined_suggestion`, then exactly one terminal `done` or `error`.

| `type` | Fields | Notes |
|---|---|---|
| `token` | `text` | The only place tokens appear; the row is written as it streams, so a dropped connection loses the rendering, not the transcript |
| `tool_call` | `id`, `name`, `args` | `name` is an `AiToolName` the caller's permissions allow; arguments are re-validated with zod server-side before anything runs |
| `tool_result` | `id`, `name`, `ok`, `summary`, `payload?` | `summary` is the Hebrew line the pane shows; `payload` is the structured result a pane consumes (`draft_step` → the editor dock) |
| `proposed_edits` | `proposedEditsId`, `documentId`, `baseSourceVersion`, `ops` | Carries the base version so the diff overlay renders without a second fetch |
| `refined_suggestion` | `suggestionId`, `editedPayload` | The user still has to accept it (owner decision §1.3) |
| `done` | `messageId`, `tokensIn`, `tokensOut`, `latencyMs` | |
| `error` | `code`, `message` | `AI_RATE_LIMITED`, `MODEL_UNAVAILABLE`, `SOURCE_MOVED`, … |

**Anchors.** `ProposedEditOp.anchor` is a paragraph ref in `htmlToParagraphs` form — heading path plus index inside it, e.g. `§h2-1.p-3` — resolved client-side by block order, never a DOM id: the sanitizer strips `id` attributes, so there is nothing in the document to look up. Every op carries `before` (the anchor paragraph's current text) including inserts, so the overlay can show a real diff and the apply path can refuse a hunk whose text moved under it.

### Tool sets

The tiers nest — `ai.chat` implies the `ai.ask` tools, `ai.manage` implies both — which is what `toolsFor(permissions)` returns, in catalogue order.

| Permission | Tools |
|---|---|
| `ai.ask` (agent) | `read_document`, `read_topic`, `search_kb`, `explain_step` |
| `ai.chat` (editor) | + `read_source`, `read_impact`, `list_suggestions`, `propose_source_edit`, `refine_suggestion`, `review_document`, `draft_step` |
| `ai.manage` (admin) | + `read_eval` |

No tool writes. `propose_source_edit` returns hunks and `refine_suggestion` returns a payload; both need a human decision afterwards (owner decision §1.3). Every read tool applies the visibility rule, so an agent's answer can never quote unpublished content.

### Events

`ai.message { conversationId, messageId, userId }`, per-user SSE only.

## Web routes (owner in parentheses)

`/workspace/:id` (X4a) · `/admin/ai` (X4b). Chat panes inside `EditorPage` and `ArticlePage` are X4b components; X6 mounts them, as it does the sidebar entries and the `affects` chips on the existing suggestion cards.

## Deploy checklist (X1 owns)

Switching the default tier is a deploy change, not only a config change:

- `deploy/ollama-pull.sh` loops over **both** generation slots and the embed tag, each with an explicit `:latest` when the tag carries no version, and `deploy/ollama-pull-check.sh` gains the cases for a two-slot pull and for `SUGGEST_MODEL == CHAT_MODEL` pulling once.
- `deploy/smoke.sh`'s `embed_check` asserts the width the configured embedder returns against `EMBED_DIMENSION`, which for tier 1 means 1024.
- `scripts/e2e-compose.mjs` asserts the tags the compose stack actually pulled.
- `deploy/e2e.env` and `deploy/ci.env` set the tier (or the explicit slots) CI runs at; CI stays on the small model.
- `docs/operations.md` § Model upgrade gets the reindex step: 0051 rebuilds `documents.embedding` at the new width and the `ai.reindex` job re-embeds every document. Existing vectors are not convertible, so search ranks lexically until the job finishes.
