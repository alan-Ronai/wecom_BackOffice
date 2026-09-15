# Wave 6 API contract (authoritative for lanes X1–X6)

Schemas: `packages/shared/src/schemas/wave6.ts` (conversations, chat stream, proposed edits, tools, AI settings, model tiers, eval) plus the additive fields merged into `SuggestionSchema` and the structured-edit/analytics schemas in `pipeline.ts`. Every route validates with those schemas, appears in `docs/api/openapi.json`, and is what `apps/web` calls. Spec: `docs/superpowers/specs/2026-09-15-kb-wave6-ai-copilot-design.md`.

X0 is on `main` before any lane starts. Nothing X0 landed changes behaviour: `MODEL_TIER` is unset, so both generation slots still resolve to `MODEL_NAME` and the embedder stays `nomic-embed-text`/768 until X1's 0051 and the tier switch land together.

## Migrations

| Lane | File | Owns |
|---|---|---|
| X0 | `0050_wave6_ai_settings.js` | `ai.ask`/`ai.chat`/`ai.manage` + grants, `ai_setting_versions`, the four `ai.*` `app_settings` rows (done) |
| X1 | `0051` | `documents.embedding` → `EMBED_DIMENSION`, `step_embeddings`, `suggestions.affects`, `suggestions.prompt_version`, `suggestions.model` |
| X2 | `0052` | `ai_conversations`, `ai_messages`, `ai_message_feedback`, `ai_proposed_edits` |
| X3 | `0053` | `suggestions.edit_diff`, `suggestions.applied_parts`, `suggestions.parent_id` (FK → `suggestions`, `on delete set null`), `suggestions_status_decided_idx`, `suggestions_parent_idx` |
| X6 | `0054` | seams |

`checkOrder` is on and nothing else reserves below `0055`.

## Canonical names produced by X0 (import these; do not rename)

| Concern | Name |
|---|---|
| Permissions | `ai.ask` (agent+), `ai.chat` (editor+), `ai.manage` (admin only; `approver` gets none) |
| Event | `ai.message { conversationId, messageId, userId }` — per-user SSE fan-out, like `notification.created` |
| Queues | `QUEUES.aiEval = 'ai.eval'`, `QUEUES.aiReindex = 'ai.reindex'` |
| Config | `MODEL_TIER` (0–4, optional), `SUGGEST_MODEL`, `CHAT_MODEL`; `MODEL_TIER_PRESETS` in `wave6.ts`; `resolveModelSlots(config)` in `apps/api/src/lib/modelSlots.ts` → `{ tier, suggestModel, chatModel, embedModel, embedDimension }` |
| Settings | keys `ai.brief`, `ai.style`, `ai.models`, `ai.limits` (`AI_SETTINGS_KEYS`); `getAiSettings(q, slots?)`, `putAiSettings(tx, patch, actorId)`, `currentPromptVersion(settings)`, `modelsFromSlots(slots)` in `apps/api/src/lib/aiSettings.ts`. `ai.models` is a **derived** block: pass `resolveModelSlots(app.config)` as `slots` and a `models` patch is refused (A-I5) |
| Model contract | `ChatMessage`, `ToolCall`, `ChatToolSpec`, `ChatResult`, `ModelClient.chat?`, `ModelClient.embedBatch?`, `ImpactSet`, `FewShotExample`, `ProposalContext` += `brief`, `style`, `impact`, `examples`, `maxContextChars` |
| Conversations | `ConversationKindSchema`, `ConversationSchema`, `CreateConversationBodySchema`, `ConversationsQuerySchema`, `ConversationsResponseSchema`, `MessageRoleSchema`, `AiMessageSchema`, `ConversationDetailSchema`, `SendMessageBodySchema`, `ChatEventSchema`, `MessageFeedbackBodySchema` |
| Proposed edits | `ProposedEditOpSchema`, `ProposedEditsSchema`, `DecideProposedEditsBodySchema`, `DecideProposedEditsResultSchema` |
| Tools | `AI_TOOLS`, `AiToolNameSchema`, `toolsFor(permissions)` |
| Suggestions | `AffectsItemSchema`, `SuggestionSchema` += `affects` / `promptVersion` / `model` / `editDiff` / `appliedParts` (+ `parentId`, X3), `StructuredEditSchema`, `STRUCTURED_EDIT_ROW_GROUPS`, `StructuredEditDiffSchema`, `AcceptSuggestionBodySchema`, `SuggestionAnalyticsQuerySchema`, `SuggestionAnalyticsSchema`; X3 adds `rowsOf` / `applyStructuredEdit` / `diffPayloads` / `splitByParts` / `NotSplittableError` / `SuggestionRow` in `packages/shared/src/suggestions/structured.ts` |
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
| 1 | 4 vCPU / 16 GB | `aya-expanse:8b-q4_K_M` (fallback `qwen2.5:7b-instruct-q4_K_M`) | same | `bge-m3` (1024) |
| 2 | 8 vCPU / 32 GB | `gemma3:12b-it-q4_K_M` | `aya-expanse:8b-q4_K_M` | `bge-m3` |
| 3 | 16 vCPU / 64 GB | `gemma3:27b-it-q4_K_M` | `gemma3:12b-it-q4_K_M` | `bge-m3` |
| 4 | + GPU 24 GB | `gemma3:27b-it-q4_K_M` | same | `bge-m3` |

The tags are X1's to confirm against the VM's Ollama library; `POST /admin/ai/models/test` is what proves one exists before an admin selects the tier. Changing them is a change to `MODEL_TIER_PRESETS` alone.

## Routes

### X0/X1 — AI settings and eval

| Method | Path | Body / Query | Response | Requires |
|---|---|---|---|---|
| GET | `/admin/ai/settings` | — | `AiSettingsSchema` (the `models` block is **derived**, see below) | ai.manage |
| PUT | `/admin/ai/settings` | `AiSettingsPutSchema` | `AiSettingsSchema` (deep-merged; a brief/style text change bumps that version). A non-empty `models` is **400 `MODELS_ENV_ONLY`** | ai.manage |
| GET | `/admin/ai/settings/versions` | `?key` | `AiSettingVersionsResponseSchema` | ai.manage |
| POST | `/admin/ai/models/test` | `ModelTestBodySchema` | `ModelTestResultSchema` | ai.manage |
| POST | `/admin/ai/eval` | — | 202 `JobQueuedSchema` (queues `ai.eval`) | ai.manage |
| GET | `/admin/ai/eval/runs` | — | `EvalRunsResponseSchema` | ai.manage |
| POST | `/admin/ai/reindex` | — | 202 `JobQueuedSchema` (queues `ai.reindex`) | ai.manage |

**The `models` block is read-only and environment-derived** (fix wave, A-I5). `AiSettingsSchema.models` reports `resolveModelSlots(config)` — the same resolution `makeChatModel`, `app.model`, the boot dimension check and `reindexEmbeddings` use — not the `ai.models` row. Before the fix an admin could move the tier on `/admin/ai`, see it saved, see `POST /admin/ai/models/test` confirm the new tag, and change nothing that runs; `embedDimension` in particular could be set to a width `documents.embedding` cannot hold. So:

- `PUT /admin/ai/settings` with a non-empty `models` object answers **400 `MODELS_ENV_ONLY`** (an empty `{}` is not a write and passes through). `brief`, `style` and `limits` are unchanged — those *are* read live.
- `POST /admin/ai/models/test` probes the tag `resolveModelSlots` resolves for the slot, so the probe answers for what a restart would load.
- `models.tier` reports `0` when no `MODEL_TIER` is configured (the slots then come from `MODEL_NAME` / `EMBED_MODEL`); the three tag fields always say what is actually loaded.
- Changing a slot is `MODEL_TIER` (or `SUGGEST_MODEL`/`CHAT_MODEL`/`EMBED_MODEL`) plus a restart, plus migration 0051 and `POST /admin/ai/reindex` when the width moves — spec §6, and the Deploy checklist below.
- **Web:** `ModelsTab` is a display surface and the "test" button; it must not offer a save. See the handoff note in the fix-wave report.

### X1/X3 — Suggestions

Existing routes keep their paths and their permissions (`suggestions.review`, `suggestions.apply`).

| Method | Path | Body / Query | Response | Requires |
|---|---|---|---|---|
| GET | `/suggestions/:id` | — | `SuggestionSchema`, now including `affects`, `promptVersion`, `model`, `editDiff`, `appliedParts`, `parentId` | suggestions.review |
| PUT | `/suggestions/:id/edit` | `SuggestionDecisionBodySchema` — exactly one of `editedPayload` (full payload) or `structuredEdit` (`StructuredEditSchema`, per type) | `SuggestionSchema` (stores `editedPayload` + the server-derived `editDiff`; the original payload is kept) | suggestions.review |
| POST | `/suggestions/:id/accept` | `AcceptSuggestionBodySchema` `{ parts? }` — row ids; omitted, empty or no body at all = the whole suggestion | `SuggestionSchema` (`appliedParts` records what was applied) | suggestions.review |
| GET | `/suggestions/analytics` | `SuggestionAnalyticsQuerySchema` | `SuggestionAnalyticsSchema` | suggestions.review |

**`PUT`, not `PATCH`.** Spec §4.2 names the edit route `PATCH /suggestions/:id/edit`; the live route the web already calls is `PUT`, so X3 widened that body instead of adding a second route. `editedPayload` and `structuredEdit` are mutually exclusive — a body with both, or with neither, is a 400 `VALIDATION`.

**Permissions.** `accept` and `analytics` both sit behind **`suggestions.review`**, the permission the existing decision routes already use (the table previously said `suggestions.apply` / `analytics.read`; the live routes are `suggestions.review` and X3 kept them consistent). `suggestions.apply` still guards `POST /suggestions/publish`, which is what actually writes documents. **`GET /suggestions/analytics` is `suggestions.review`, not `analytics.read`** — the web tab must be gated on the same permission the route enforces (fix wave; `SuggestionAnalyticsTab` is the web fixer's change).

**World scope (fix wave, A-I6).** The review queue is world-scoped like every other reader, and one predicate says so for all of it — `suggestionVisibleSql` in `apps/api/src/modules/sources/suggestionScope.ts`:

- a suggestion **with** a target document is visible when that document is: live, status-visible to the caller, and inside the caller's world scope;
- a suggestion with **no** target (`new-card`, which carries a whole proposed document in its payload, and `field-alert`) is visible when its source feeds at least one document in the caller's scope (`source_revisions → sources → documents → document_worlds`);
- a caller with no world scope sees everything, as everywhere else. A row outside the caller's reach answers **404**, never 403.

It applies to `GET /suggestions`, `GET /suggestions/:id`, the `before` snapshot every decision route audits against (so `accept`/`reject`/`reset`/`edit` cannot reach past the read), the chat's `list_suggestions` and `refine_suggestion` tools, and the dashboard's `pipeline` panel — whose `bySource` returns source *titles* and therefore cannot stay org-wide while the queue it links to is scoped. `list_suggestions` additionally requires at least one of `documentId` / `sourceRevisionId`: with neither it used to return the 30 most recent suggestions on the instance.

**Row ids** (`rowsOf` in `packages/shared/src/suggestions/structured.ts` — the one scheme the editor renders, the API applies and `applied_parts` stores):

| type | rows | notes |
|---|---|---|
| `update-step` | `add-<i>`, `rep-<action.id>`, `branch`, `out-<i>`, `patch-<key>` | `rep-*` is the atomic group `replace`, `out-*` the atomic group `outcomes` |
| `new-card` | `meta`, `step-<phase>-<step>` | `meta` (title/description/category/wave/priority) is required; a phase left with no steps is dropped |
| `new-step` | `meta`, `act-<i>`, `out-<i>` | `meta` (afterStepKey/title) is required; at least one action must remain |
| `update-block` | `act-<action.id>`, `script` | `act-*` is the atomic group `actions` — the payload is the block's whole new action list |
| `deprecate-step` | `reason` | required, whole-or-nothing |
| `field-alert` | `alert` | required, whole-or-nothing |

A row id outside `STRUCTURED_EDIT_ROW_GROUPS[type]` is a 400 (X3 widened those lists additively to the spellings above). Other errors: 400 `UNKNOWN_ROW` (a row id the payload does not have), 400 `REQUIRED_ROW` (removing a required row, or leaving a `new-step` with no actions), 400 `NOT_SPLITTABLE` with `details.group` (a `parts` selection that cuts through an atomic group, or that cannot be assembled into a valid payload), 409 `ALREADY_APPLIED`.

**Partial apply.** `accept` with `parts` narrows the row's `edited_payload` to the selected rows, records `applied_parts`, and re-queues everything left over as a **new pending suggestion** of the same type, revision, anchor and targets, with `parentId` set, the title suffixed ` (המשך)`, and a `suggestion.created` event — so nothing an editor did not explicitly reject leaves the queue. Selecting every row is an ordinary accept: no remainder, `appliedParts` stays null. Two selections leave no appliable remainder and so produce none: an `update-block` whose `script` was left out (the action list *is* the change), and a payload whose remaining rows are all required.

**Analytics** (`GET /suggestions/analytics`, cached 60 s): **decided** = `accepted|rejected|applied`; **accepted** = `accepted|applied`; **edited** = accepted *and* (`edit_diff` has ≥1 row **or** `applied_parts` is set) — always server-derived; **rejected** = `status='rejected'`. `rates.*` are shares of the decided rows (`0` when none). `meanMinutesToDecision` averages `decided_at - created_at` over decided rows, `null` when nothing is decided. Every bucket is `{ key, total, accepted, edited, rejected, pending }`; `key` is the type, the source id, the model tag or the prompt version. Remainder rows count in their own right. `byModel` / `byPromptVersion` read `suggestions.model` / `suggestions.prompt_version` (X1's 0051) and bucket a row that carries neither — anything generated before the wave, or by the rule-based fallback — under `'—'`.

`affects` is computed **server-side** by X1 from the graph and the embeddings and is not part of `ProposedSuggestion`: a model cannot claim a change touches a document it never saw.

### X2 — Chat

| Method | Path | Body / Query | Response | Requires |
|---|---|---|---|---|
| POST | `/ai/conversations` | `CreateConversationBodySchema` | `ConversationSchema` (201) | ai.ask for `kind: 'article'`, ai.chat otherwise |
| GET | `/ai/conversations` | `ConversationsQuerySchema` | `ConversationsResponseSchema` (own only; `ai.manage` may see all) | ai.ask |
| GET | `/ai/conversations/:id` | — | `ConversationDetailSchema` | ai.ask, own conversation (or ai.manage) |
| POST | `/ai/conversations/:id/messages` | `SendMessageBodySchema` | **SSE** stream of `ChatEventSchema`, persisted as it streams | ai.ask for `article`, ai.chat otherwise |
| POST | `/ai/messages/:id/feedback` | `MessageFeedbackBodySchema` | 204 | ai.ask, own message |
| GET | `/ai/proposed-edits/:id` | — | `ProposedEditsSchema` | ai.ask, own conversation (or ai.manage) |
| POST | `/ai/proposed-edits/:id/decide` | `DecideProposedEditsBodySchema` | `DecideProposedEditsResultSchema` | ai.chat + docs.edit |
| GET | `/admin/ai/conversations` | `ConversationsQuerySchema` (`userId`, `documentId`, `from`, `to`) | `ConversationsResponseSchema` | ai.manage |
| GET | `/admin/ai/conversations/export.jsonl` | same filters | `application/x-ndjson`; audited as **`admin.ai.conversations.export`** with the filter, before the reply is hijacked (A-I7) | ai.manage |
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

**Insert order (fix wave, A-C1).** Several `insert` ops may share one anchor — `diffToOps` emits one op per added paragraph, all anchored to the last echoed ref — and **the ops are applied in array order**: the first insert lands immediately after the anchor, the second after the first, and so on. `applyParagraphEdits` advances a per-anchor cursor to make that true; a renderer showing the hunks must list them in the same order the array gives, because that is the order the document will get.

**`propose_source_edit` is bound to the conversation's document (A-I3).** The orchestrator persists hunks as `{ documentId: conversation.documentId, baseSourceVersion: conversationSource.version }`, so the tool refuses a `documentId` that is not the conversation's, and refuses outright in a conversation opened without a document. Both are `ok:false` with a Hebrew summary, never a silently dropped proposal.

### Untrusted content in the prompt (fix wave, A-I8)

Document text, source text and every tool result reach the model inside a fenced region:

```
<<<WECOM_UNTRUSTED>>>
…content…
<<<END_WECOM_UNTRUSTED>>>
```

The sentinels are stripped from the content before it is wrapped, so content cannot close its own region; the fence is applied *after* the context-budget truncation, so a cut section still ends with its closing sentinel; and the never-truncatable `RULES` block carries one line saying the region is content to reason about and never an instruction. The admin's `brief` and `style` are *not* fenced — those are instructions by design. `apps/api/src/modules/ai/prompt.ts` exports `UNTRUSTED_OPEN`, `UNTRUSTED_CLOSE`, `stripSentinels`, `fenceUntrusted` and `renderToolResult`; nothing else may splice authored content into a prompt.

A tool result is rendered by `renderToolResult`, which truncates **inside `data`** (as a string ending `…`) rather than slicing the stringified envelope, so what the model receives is always parseable JSON.

### Tool sets

The tiers nest — `ai.chat` implies the `ai.ask` tools, `ai.manage` implies both — which is what `toolsFor(permissions)` returns, in catalogue order.

| Permission | Tools |
|---|---|
| `ai.ask` (agent) | `read_document`, `read_topic`, `search_kb`, `explain_step` |
| `ai.chat` (editor) | + `read_source`, `read_impact`, `list_suggestions`, `propose_source_edit`, `refine_suggestion`, `review_document`, `draft_step` |

| `ai.manage` (admin) | + `read_eval` |

No tool writes. `propose_source_edit` returns hunks and `refine_suggestion` returns a payload; both need a human decision afterwards (owner decision §1.3). Every read tool applies the visibility rule, so an agent's answer can never quote unpublished content.

**Every read tool applies the caller's *world* scope too** (fix wave). `read_impact` narrows both halves of the impact set — the inbound-link walk and the embedding-neighbour query — and reports drafts only to a caller holding `docs.read_unpublished`, rather than the queued pipeline's hardcoded `true` (A-I1). `list_suggestions` and `refine_suggestion` use `suggestionVisibleSql` (see the Suggestions section), and `list_suggestions` requires a `documentId` or a `sourceRevisionId` (A-I2). `int/scope-leak.test.ts` is the file that holds all of this.

### Events

`ai.message { conversationId, messageId, userId }`, per-user SSE only.

## Web routes and components, as shipped (owner in parentheses)

Routes: `/workspace/:id` (X4a) · `/admin/ai` (X4b).

| Component | Path | Mounted by X6 at |
|---|---|---|
| `ChatPane` (X4a) | `components/ai/ChatPane.tsx` | inside the three panes below; X4b's placeholder of the same name was deleted at the merge |
| `MessageList`, `Composer`, `ToolCallChip`, `ProposedEditsCard`, `RefinedSuggestionCard`, `FeedbackButtons` (X4a) | `components/ai/*` | inside `ChatPane` |
| `WorkspacePage`, `SuggestionsPanel`, `StructuredEditDrawer`, `AffectsChips`, `ProposedEditsOverlay`, `PaneResizer` (X4a) | `components/workspace/*` | `/workspace/:id`; `SuggestionsPanel` **also** replaces `SourcesPage`'s own card list, so the two review surfaces cannot diverge |
| `ArticleAskPane` (X4b) | `components/ai/ArticleAskPane.tsx` | `ArticlePage`'s work view, under `RefreshBanner`, never in the print frame |
| `EditorChatDock` (X4b) | `components/ai/EditorChatDock.tsx` | the end of `EditorPage`'s `.ed-main` |
| `renderWithStepLinks` (X4b) | `components/ai/citations.tsx` | inside `MessageList`; both mounts pass a step **number → key** map, because the article's deep link is `/doc/:id/:stepKey` |
| `AiPage` + `PromptsTab`, `ModelsTab`, `EvalTab`, `SuggestionAnalyticsTab`, `ConversationsTab` (X4b) | `components/admin/{AiPage.tsx,ai/*}` | `/admin/ai`, listed in both `Sidebar`'s admin links and `AdminLayout`'s tabs behind `ai.manage` |

Two web-side gates are worth stating because they are not the route's own:

- `SuggestionAnalyticsTab` must be gated on **`suggestions.review`**, the permission `GET /suggestions/analytics` actually enforces. X4b gated it on `analytics.read` to match the other analytics surfaces; both seeded roles hold both, so the mismatch is latent, but a custom role holding one and not the other gets a tab that 403s inside itself. The contract is the route's permission (fix wave).
- The admin transcript browser's `feedback` filter is applied in the browser: `ConversationsQuerySchema` has `userId`, `documentId`, `from` and `to`, and no feedback field.

The workspace link ("🧭 סביבת עבודה") is shown to an `ai.chat` holder who can also edit the document, from the article topbar (and its narrow overflow menu) and the editor toolbar. There is no top-level nav entry for it: the workspace is reached from a document (spec §5).

## Deploy checklist (X1 owns)

Switching the default tier is a deploy change, not only a config change:

- `deploy/ollama-pull.sh` loops over **both** generation slots and the embed tag, each with an explicit `:latest` when the tag carries no version, and `deploy/ollama-pull-check.sh` gains the cases for a two-slot pull and for `SUGGEST_MODEL == CHAT_MODEL` pulling once.
- `deploy/smoke.sh`'s `embed_check` asserts the width the configured embedder returns against `EMBED_DIMENSION`, which for tier 1 means 1024.
- `scripts/e2e-compose.mjs` asserts the tags the compose stack actually pulled.
- `deploy/e2e.env` and `deploy/ci.env` set the tier (or the explicit slots) CI runs at; CI stays on the small model.
- `docs/operations.md` § Model upgrade gets the reindex step: 0051 rebuilds `documents.embedding` at the new width and the `ai.reindex` job re-embeds every document. Existing vectors are not convertible, so search ranks lexically until the job finishes.
