# Wave 6 — AI copilot: impact-aware suggestions, better Hebrew models, structured suggestion editing, chat with persisted transcripts

Date: 2026-09-15 · Status: approved in brainstorming (owner decisions marked) · Owner: the wave-4/5 session
Builds on: wave 4 (source documents, feedback), wave 5 (learning), wave 3 (graph/impact, notifications). Contracts: `packages/shared/src/schemas/{stage45,wave4,wave5}.ts`; this wave adds `wave6.ts`.

## 0. Problem

The source-change pipeline (paragraph diff → mapped steps → local model → schema-validated suggestions → editor review) is safe but source-local and unmeasured: the model sees only the changed source's own steps, knows nothing about the company or the knowledge architecture, runs on a 3B model with weak Hebrew, and suggestions can only be edited as one text blob. Editors cannot direct the AI, and nothing is kept for later prompt or model improvement.

## 1. Owner decisions and rulings

1. **Hosted models are off the table.** Everything runs on the LAN VM through Ollama. Model choice is a **tier** (§6) selected by configuration so a VM upgrade needs no code change.
2. **Two model slots:** `SUGGEST_MODEL` (batch, queued, quality first) and `CHAT_MODEL` (interactive, streaming, latency first); `EMBED_MODEL` moves to a multilingual embedder (default `bge-m3`, 1024 dims) with `EMBED_DIMENSION` validated at boot (already exists) and a one-time reindex.
3. **Chat never writes on its own.** "Change the source" requests return **proposed edits** rendered as a diff on the source editor; the user accepts or rejects each; accepted edits become a normal source save (versioned, audited, ingested). Suggestion refinements return an **edited payload** the user still has to accept. **[owner decision]**
4. **Chat is available in three places:** the combined workspace (source editor + suggestions + chat), the working-view (steps) editor, and read-only Q&A on the article page for agents. **[owner decision]** Tools available to the chat depend on the caller's permissions (§4.3).
5. **All chats are persisted** (conversation, every message, tool calls and results, model, prompt version, tokens, latency, user feedback) and exportable as JSONL for prompt tuning or fine-tuning. Retention: indefinite; admins can delete a conversation. **[owner decision]**
6. **Impact-aware generation:** every proposal call receives the change's impact set — shared blocks and every document using them, CRM fields and their users, inbound links and goto sources, sibling items in the same topic, top-k related documents by embedding — and every suggestion carries an `affects` list shown to the editor.
7. **The model is briefed:** a system prompt v3 = company brief + knowledge architecture (worlds, topics, seven doc types, governance rules, style rules for agent-facing text) + task rules. The company brief and style rules are **editable by admins** in settings (`ai.brief`, `ai.style`), versioned; every message and suggestion records the prompt version it used.
8. **Structured suggestion editing:** each suggestion type has a field-level editor (actions, branch options, outcomes, field alerts, new-card steps) with per-row keep/edit/remove and **partial apply**; the original payload, the edited payload and the diff between them are stored.
9. **Accuracy is measured:** an offline evaluation harness (`pnpm --filter @wecom/model eval`) over a committed set of real change cases scores each model tier and prompt version (hit rate on target step, type, and content overlap); a live **acceptance analytics** endpoint reports accept / edit / reject rates by suggestion type, source, model and prompt version. Confidence is calibrated from the eval set (a lookup table per type), not hard-coded.
10. **Mapping uses embeddings:** paragraph → step mapping scores cosine similarity on the multilingual embedder, falling back to the trigram similarity when embeddings are unavailable; threshold calibrated on the eval set.

## 2. Lanes

| Lane | Scope | Migrations |
|---|---|---|
| X0 Contracts | `wave6.ts` (conversations, messages, chat requests/stream events, proposed edits, structured suggestion edits, `affects`, eval + analytics, AI settings), permissions `ai.ask` (agent+), `ai.chat` (editor+), `ai.manage` (admin), events `ai.message` (additive), queues `ai.eval`, `ai.reindex`; model contract additions `chat(messages, tools, onToken)`, `embedBatch`; `MODEL_TIER` presets in config; `docs/api/CONTRACTS-wave6.md` | 0050 (permissions, settings rows `ai.brief`, `ai.style`, `ai.models`) |
| X1 Generation quality (api + model) | system prompt v3 with brief/architecture/style, impact-aware `ProposalContext` (graph + embeddings), few-shot bank from accepted suggestions, `affects` computation, embedding-based mapping, embedder swap + reindex job, eval harness + committed eval set, confidence calibration table | 0051 (embedding column → `EMBED_DIMENSION`, `suggestions.affects`, `suggestions.prompt_version`, `suggestions.model`) |
| X2 Chat backend (api) | conversations/messages tables, streaming chat route over SSE, tool runtime (read document / source / impact / suggestions / topic; `propose_source_edit`; `refine_suggestion`; `review_document`), per-role tool sets, rate limits, feedback, transcript export | 0052 |
| X3 Suggestion editing & analytics (api + shared) | structured edit schema per type, `PATCH /suggestions/:id/edit` (structured), `POST /suggestions/:id/accept` with `parts`, edit diff stored, `GET /suggestions/analytics` | 0053 |
| X4a Workspace web | `/workspace/:id`: source editor (existing `SourceEditor`), suggestions panel with structured editors + `affects` badges + partial apply, chat pane (streaming, proposed-edit diffs with accept/reject per hunk, refine-suggestion flow) | — |
| X4b Chat elsewhere + admin web | chat pane in `EditorPage` (step editor: refine/explain tools), read-only Q&A chat on `ArticlePage` (agents; `ai.ask`), `/admin/ai`: brief + style editor with versions, model slots + tier preset + reachability, eval results table, acceptance analytics, transcript browser + JSONL export + delete | — |
| X6 Integration | mounts, seams, real e2e (chat proposes edit → accept → suggestions with `affects` → structured partial apply → analytics reflects it; agent Q&A on article), model evaluation run at tier 1 on the VM, acceptance matrix | 0054 reserved |

Migrations: wave 6 uses 0050–0054 (the wave-3 session confirmed 0050 is next free; `checkOrder` is on).

## 3. Data model

- `ai_conversations(id, kind check in ('workspace','editor','article'), document_id → documents null, source_revision_id → source_revisions null, user_id → users, title text, model text, prompt_version text, created_at, updated_at, deleted_at)`.
- `ai_messages(id, conversation_id → ai_conversations cascade, seq int, role check in ('user','assistant','tool','system'), content text, tool_calls jsonb null, tool_results jsonb null, proposed_edits jsonb null, refined_suggestion_id → suggestions null, tokens_in int, tokens_out int, latency_ms int, model text, prompt_version text, created_at)`; unique `(conversation_id, seq)`.
- `ai_message_feedback(message_id → ai_messages cascade, user_id, rating check in ('up','down'), note text, created_at, primary key (message_id, user_id))`.
- `ai_proposed_edits(id, message_id → ai_messages cascade, document_id, base_source_version int, ops jsonb (list of {anchor, kind: replace|insert|delete, before, after}), status check in ('proposed','accepted','rejected','partially_accepted'), decided_by, decided_at, resulting_source_version int null)`.
- `suggestions` gains `affects jsonb` (list of `{ kind: document|block|field|topic, id, title, why }`), `prompt_version text`, `model text`, `edit_diff jsonb` (structured diff original → edited), `applied_parts jsonb`.
- `ai_eval_runs(id, model, prompt_version, embed_model, started_at, finished_at, cases int, hit_target real, hit_type real, content_overlap real, notes text)`; `ai_eval_cases` live in the repo as fixtures (`packages/model/eval/cases/*.json`), not in the DB.
- `app_settings` rows: `ai.brief` (text + version history in `ai_setting_versions`), `ai.style`, `ai.models` (`{ tier, suggestModel, chatModel, embedModel, embedDimension }`), `ai.limits` (`{ chatPerUserPerHour, maxContextChars }`).
- `documents.embedding` becomes `vector(EMBED_DIMENSION)` via a rebuild migration (drop + add + reindex job `ai.reindex`); `step_embeddings(step_id, embedding)` for mapping.

## 4. API (`/api/v1`, all from `wave6.ts`)

### 4.1 Settings & eval (X0/X1)
`GET/PUT /admin/ai/settings` (`ai.manage`) · `GET /admin/ai/settings/versions` · `POST /admin/ai/models/test` `{ slot }` (pulls tags, reports reachability, size, dims) · `POST /admin/ai/eval` (queues `ai.eval`) · `GET /admin/ai/eval/runs` · `POST /admin/ai/reindex` (queues `ai.reindex`).

### 4.2 Suggestions (X1/X3)
Existing routes keep their paths. Additive: `GET /suggestions/:id` now includes `affects`, `promptVersion`, `model`, `editDiff`; `PATCH /suggestions/:id/edit` body `StructuredEditSchema` (per type); `POST /suggestions/:id/accept` body `{ parts?: string[] }` (row ids to apply; omitted = all); `GET /suggestions/analytics?from&to&sourceId&type` → accept/edit/reject counts and rates by type, source, model, prompt version, mean minutes to decision.

### 4.3 Chat (X2)
- `POST /ai/conversations` `{ kind, documentId?, sourceRevisionId?, title? }` → Conversation (`ai.ask` for `article`, `ai.chat` otherwise).
- `GET /ai/conversations?documentId&kind&mine` → list (own conversations; `ai.manage` sees all).
- `GET /ai/conversations/:id` → conversation + messages.
- `POST /ai/conversations/:id/messages` `{ content, context?: { stepKey?, suggestionId?, selection? } }` → **SSE stream** of `ChatEventSchema` (`token`, `tool_call`, `tool_result`, `proposed_edits`, `refined_suggestion`, `done { messageId, tokensIn, tokensOut, latencyMs }`, `error`), persisted as it streams.
- `POST /ai/messages/:id/feedback` `{ rating, note? }`.
- `POST /ai/proposed-edits/:id/decide` `{ accept: string[] | 'all', reject: string[] | 'all' }` → applies accepted ops as one source save (reuses `saveSourceDocument`, `If-Match` on `base_source_version` → 409 `SOURCE_MOVED`), returns the new source version.
- `GET /admin/ai/conversations?user&documentId&from&to` · `GET /admin/ai/conversations/export.jsonl` · `DELETE /admin/ai/conversations/:id` (`ai.manage`).
- Tool sets: **agent (`ai.ask`)**: `read_document`, `read_topic`, `search_kb`, `explain_step`; **editor (`ai.chat`)**: agent tools + `read_source`, `read_impact`, `list_suggestions`, `propose_source_edit`, `refine_suggestion`, `review_document`, `draft_step`; **admin**: editor tools + `read_eval`. Tools are server-side functions with zod-validated arguments; the model chooses through Ollama tool calling (or a JSON tool-call envelope for models without native tools; X0 defines both).
- Rate limit: `ai.limits.chatPerUserPerHour` (default 60), 429 `AI_RATE_LIMITED`; context window budget from `maxContextChars`.

### 4.4 Events
`ai.message { conversationId, messageId, userId }` (per-user SSE only).

## 5. Behaviour

- **Workspace** (`/workspace/:id`, editors): three panes — source editor (existing component), suggestions panel (existing cards upgraded with `affects` chips, structured editor drawer, partial apply checkboxes), chat pane. Chat context is the document + current source version + selected suggestion + text selection. Proposed edits appear as inline diff hunks in the source editor with accept/reject per hunk and "accept all"; accepting saves a source version labelled "מהצ'אט" with the message id in the audit row. Refined suggestions replace the card's edited payload (original kept).
- **Step editor**: chat pane with the editor tool set; `draft_step` returns a step the user inserts; `review_document` returns findings as a checklist.
- **Article page**: a collapsed "שאל את המערכת" pane; agents can ask questions about the current item and topic; answers cite step numbers; no write tools. Answers never reveal unpublished content (tools apply the visibility rule).
- **Suggestions**: cards show `affects` ("משפיע על 3 מסמכים, בלוק משותף אחד, שדה CRM אחד"); editing opens the per-type structured editor; accept applies selected rows; analytics tab on `/sources` (or `/admin/ai`) shows rates.
- **Admin AI page**: brief and style editors with version history and "preview system prompt"; model slots with tier preset (§6) and live test; eval runs with scores; acceptance analytics; transcript browser with search, feedback filter, export and delete.
- **Generation**: prompt v3 assembles brief + architecture + style + impact set + linked steps + few-shot examples (top 3 accepted suggestions of the same type from the same source or world) + diff; output validated as today; each suggestion stores `affects`, `promptVersion`, `model`.

## 6. Model tiers (configuration, no code change between tiers)

| Tier | VM | `SUGGEST_MODEL` | `CHAT_MODEL` | `EMBED_MODEL` | Notes |
|---|---|---|---|---|---|
| 0 | 4 vCPU / 16 GB (today) | `qwen2.5:3b-instruct-q4_K_M` | same | `nomic-embed-text` (768) | current baseline; kept for comparison only |
| 1 | 4 vCPU / 16 GB (today) | DictaLM 2.0 Instruct 7B q4 (Hebrew-specialized); fallback Aya Expanse 8B q4 | same | `bge-m3` (1024) | **default after this wave**; ~6 GB RAM; suggestions 1–3 min/revision queued; chat tens of seconds with streaming |
| 2 | 8 vCPU / 32 GB | Gemma 3 12B q4 or Qwen2.5 14B q4 | DictaLM 7B q4 | `bge-m3` | better impact reasoning; ~10 GB RAM |
| 3 | 16 vCPU / 64 GB | Gemma 3 27B / Aya Expanse 32B / Qwen2.5 32B q4 | 12B q4 | `bge-m3` | best local Hebrew; chat slow without GPU |
| 4 | + GPU 24 GB VRAM | 27–32B q4 | same | `bge-m3` | interactive chat (20–40 tok/s); recommended if chat is used daily |

`MODEL_TIER=1` selects the defaults; each slot is individually overridable; `POST /admin/ai/models/test` verifies the tags exist in the local Ollama library (exact tag names are confirmed by X1 at implementation time; the eval harness runs every candidate available on the VM and records the scores).

## 7. Isolation & merge

Branch point: current main (≥ 72a5ca8). Same append-only rules as waves 4–5; new modules `apps/api/src/modules/ai/`, `apps/api/src/modules/suggestions-edit/` (or inside `sources/`), web `components/ai/**`, `components/workspace/**`, `components/admin/AiPage.tsx`; mounts by X6. X0 lands on main first; X1–X4b in parallel worktrees; X6 on `wave6/integration`; one review, one fix wave, merge.

## 8. Testing & acceptance

Unit: prompt assembly (brief/style/impact/few-shot budgets), tool argument validation, proposed-edit op application, structured edit diff, calibration table. Integration: chat route streams and persists every message and tool call; tool sets per role (agent cannot call write tools; unpublished content never returned); proposed edits apply with If-Match and audit; structured edit + partial apply; `affects` computed for a block/field/link change; analytics numbers; eval run stores scores; reindex job; rate limit. Web: workspace panes, diff accept/reject, structured editor, admin page, article Q&A. Real e2e: editor opens workspace → asks the chat to change a section → accepts one hunk → new source version → suggestions arrive with `affects` → editor edits one action row and applies part → analytics shows one edited-accept; agent asks a question on the article and gets a cited answer; admin exports transcripts.

Done when: every §1 decision has a green test, tier 1 runs on the VM with eval scores recorded, all gates green on main.

## 9. Out of scope

Fine-tuning itself (the export makes it possible), voice, multi-turn memory across conversations, automatic application of any AI output.
