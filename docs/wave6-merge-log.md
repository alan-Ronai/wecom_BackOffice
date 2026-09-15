# Wave 6 — merge log (`wave6/integration`)

Branch created from `main` `49ebef7` ("docs(plan): X4a — ChatPane onToolResult/stepIndex pins applied").
X0 (contracts, migration 0050) was already on `main`. Lanes are merged `--no-ff`, one at a time,
with a gate after each.

## Lane inventory

| Lane | Branch | Head merged | Report |
|---|---|---|---|
| X0 contracts | (on `main`) | `49ebef7` | `.superpowers/sdd/program/X0-report.md` |
| X1 generation quality | `worktree-agent-adcdcfb4cb74550bf` | `d151555` | `.superpowers/sdd/program/X1-report.md` |
| X2 chat backend | `worktree-agent-abe0d6649e504e56a` | `0a7a379` | `.superpowers/sdd/program/X2-report.md` |
| X3 suggestion editing & analytics | `worktree-agent-a0e0083ecf976c5ac` | `da678eb` | `.superpowers/sdd/program/X3-report.md` |
| X4a workspace web | `worktree-agent-a9e1f15bb0dff2a13` | `c22157a` | `.superpowers/sdd/program/X4a-report.md` |
| X4b chat elsewhere + admin web | `worktree-agent-a4ffaf11d0339e937` | `f3b2abe` | `.superpowers/sdd/program/X4b-report.md` |

Merge order on this branch deviates from the plan's X1 → X2 → X3 → X4a → X4b. The lanes finished
in a different order, so the actual order was **X3 → X4b → X4a → X2 → X1**, each merged as soon as
its head arrived and gated before the next. The order is safe because the file sets barely
overlap: X3 touches `apps/api/src/modules/sources` + `packages/shared`, X4a/X4b touch only
`apps/web`, X2 adds `apps/api/src/modules/ai`, and X1 is the only lane that meets X3 (in
`sources/suggestions.ts`) and X2 (in `packages/model`).

## Conflicts and how they were resolved

| Merge | File | Resolution |
|---|---|---|
| X3 | — | clean |
| X4b | — | clean |
| X4a | `apps/web/src/api/keys.ts` | union: `keys.ai` keeps X4b's `settings`/`versions`/`evalRuns` **and** X4a's `conversations`/`conversation`/`proposedEdits`; X4a's `keys.suggestion(id)` and the shared `keys.suggestionAnalytics(q)` kept once |
| X4a | `apps/web/src/api/wave6.ts` | X4a's bridge (uses `API_BASE` + `checked`/`unwrap` from the generated-client helpers) wins; X4b's `w6Text` appended so the JSONL export keeps working. Both are deleted in the seams task |
| X4a | `apps/web/src/components/ai/ChatPane.tsx` | X4b's placeholder dropped, X4a's real pane kept (as both lanes agreed). `EditorChatDock`'s `onProposedEdits` was re-typed from `(id: string)` to `(pe: ProposedEdits)` to match the real pane |
| X4a | `apps/web/src/styles/app.css` | both blocks kept (X4b's dock/ask/admin rules, then X4a's workspace rules) |
| X4a | `apps/web/test/msw/handlers.ts` | both handler groups registered: `aiAdminHandlers` (X4b, `/admin/ai/*` + `/suggestions/analytics`) before `aiHandlers` (X4a, `/ai/*` + the wave-6 `/suggestions/:id` routes), both reset in `resetState()`. Two paths were stubbed by **both** groups and silently decided by registration order: `/suggestions/analytics` now has one owner (X4b's, which records the query the admin tab asks with) and `GET /ai/conversations/:id` falls through from X4b's group for an id it did not seed |
| X2 | `apps/api/test/migrations.test.ts` | both lanes appended an assertion at the same line; kept both. The 0052 table list later had to admit `ai_eval_runs` too — X1's 0051 table also matches `ai\\_%` once the whole wave is on one branch |
| X1 | `apps/api/test/migrations.test.ts` | same place again; kept both |
| X1 | `apps/api/src/modules/sources/suggestions.ts` | merged by field: X3's `editDiff`/`appliedParts`/`parentId` and X1's `promptVersion`/`model` both map in `row()`, and the import list takes both lanes' names |

## Verified import table

Filled in as each lane lands; a `MISS` here is a lane defect.

### API

| Export | Path | Status |
|---|---|---|
| `SuggestionService.editStructured` / `acceptParts` | `apps/api/src/modules/sources/suggestions.ts` | ok (X3) |
| `suggestionAnalytics` | `apps/api/src/modules/sources/analytics.ts` | ok (X3) |
| `relaxOptionalBodies` | `apps/api/src/openapi.ts` | ok (X3) |
| `ImpactService` (`impactForSteps`, `impactForDocument`, `affectsFor`, `formatImpact`) | `apps/api/src/modules/sources/impact.ts` | ok (X1) |
| `refreshStepEmbeddings`, `embedMany` | `apps/api/src/modules/sources/embeddings.ts` | ok (X1) — X6 mounted the first at publish and restore |
| admin AI routes (`/admin/ai/settings`, `/models/test`, `/eval`, `/reindex`) | `apps/api/src/modules/ai/admin.ts`, registered from `modules/admin/routes.ts` | ok (X1) — **not** through X2's `adminHook.ts`, which stays a no-op |
| `ChatOrchestrator`, `allowedTools`, `KIND_TOOLS` | `apps/api/src/modules/ai/chat.ts` | ok (X2) |
| `aiChatHolder`, `initChatModel`, `makeChatModel`, `scriptedChatRequested` | `apps/api/src/modules/ai/chatModel.ts` | ok (X2) |
| `ScriptedChatModel` (the four rules, plus the four second calls) | `apps/api/src/modules/ai/scripted.ts` | ok (X2) |
| `impactPort` / `swapImpactPort` | `apps/api/src/modules/ai/impactPort.ts` | ok (X2) — X6 swapped it for X1's service in `ai/impactService.ts` |
| `runTool`, `specsFor`, `visibleDocument` | `apps/api/src/modules/ai/tools/*` | ok (X2) |
| `acceptedOps`, `applyOps`, `decisionStatus` | `apps/api/src/modules/ai/proposedEdits.ts` | ok (X2) |
| `paragraphRefs`, `applyParagraphEdits` | `packages/shared/src/format/htmlParagraphs.ts` | ok (X2, additive) |

### shared

| Export | Path | Status |
|---|---|---|
| `rowsOf`, `applyStructuredEdit`, `diffPayloads`, `splitByParts`, `NotSplittableError`, `SuggestionRow` | `packages/shared/src/suggestions/structured.ts` | ok (X3) |
| `STRUCTURED_EDIT_ROW_GROUPS` (widened for `rep`/`out`/`act`/`meta`) | `packages/shared/src/schemas/pipeline.ts` | ok (X3) |

### web

| Export | Path | Status |
|---|---|---|
| `ChatPane`, `MessageList`, `Composer`, `ToolCallChip`, `ProposedEditsCard`, `RefinedSuggestionCard`, `FeedbackButtons` | `apps/web/src/components/ai/*` | ok (X4a) |
| `WorkspacePage`, `SuggestionsPanel`, `StructuredEditDrawer`, `AffectsChips`, `ProposedEditsOverlay`, `PaneResizer` | `apps/web/src/components/workspace/*` | ok (X4a) |
| `streamChat` | `apps/web/src/api/aiStream.ts` | ok (X4a) — stays after the bridge is deleted |
| `useConversations`, `useConversation`, `useCreateConversation`, `useConversationFor`, `useSendMessage`, `useMessageFeedback`, `useDecideProposedEdits` | `apps/web/src/api/hooks/ai.ts` | ok (X4a) |
| `useSuggestion`, `useStructuredEdit`, `useAcceptSuggestionParts`, `useSuggestionAnalytics` | `apps/web/src/api/hooks/suggestionsEdit.ts` | ok (X4a) |
| `EditorChatDock` (+ `DraftStep`, `DOCK_TITLE`), `ArticleAskPane` (+ `ASK_TITLE`), `renderWithStepLinks` | `apps/web/src/components/ai/*` | ok (X4b) |
| `AiPage`, `PromptsTab`, `ModelsTab`, `EvalTab`, `SuggestionAnalyticsTab`, `ConversationsTab` | `apps/web/src/components/admin/{AiPage.tsx,ai/*}` | ok (X4b) |
| `useAiSettings`, `usePutAiSettings`, `useAiSettingVersions`, `useTestModel`, `useRunEval`, `useReindex`, `useEvalRuns`, `useAdminConversations`, `useDeleteConversation`, `exportConversations` | `apps/web/src/api/hooks/aiAdmin.ts` | ok (X4b) |

## Duplication found at the merge, and what happened to it

| Duplicate | Resolution |
|---|---|
| Two `useSuggestionAnalytics` hooks (X4a's in `hooks/suggestionsEdit.ts`, X4b's in `hooks/suggestionAnalytics.ts`) on the same route and key | One implementation kept; `hooks/suggestionAnalytics.ts` re-exports it under the name `/admin/ai` imports |
| Two `wave6.ts` request bridges | Merged to X4a's (it reuses `API_BASE` and `checked`/`unwrap`) plus X4b's `w6Text`, then **deleted** once every call moved to the generated client |
| Two `ChatPane`s | X4b's placeholder deleted; `EditorChatDock`'s `onProposedEdits` re-typed to take the whole `ProposedEdits`, which is what X4a's real pane hands over |
| `apps/web/src/lib/suggestionRows.ts` (X4a) against X3's shared `rowsOf` | The web module now **derives** its ids, labels, atomic groups and required flags from the shared function and keeps only the drawer's display projection (a one-line value and a read-only hint). X3's Hebrew labels win, as ruled; three X4a tests moved to them |
| `NumField` in `components/admin/ai/` against `WorkflowSettingsSection`'s | Left as is — two ~20-line copies in different trees, and folding them is a refactor with no behaviour attached |
| X2's `adminHook.ts` (`registerAdmin`) | Unused: X1 registered its admin routes under `modules/admin/routes.ts` instead. Left in place as a no-op and parked |

## Defects found at the seams (each fixed here, none in a lane's own gate)

| Defect | Where |
|---|---|
| `SECOND_CALL.refineSuggestion` was the bare string `חידוד הצעה`, which is also `AI_TOOLS`' label for `refine_suggestion` — and the system prompt lists the tools by label. Every first call from an `ai.chat` caller looked like the refine second call to the scripted model | `apps/api/src/modules/ai/prompt.ts` |
| `GET /suggestions/:id` is in the spec and the contract and is called by X4a's drawer, but no lane shipped it — X4a had only ever seen it answered by a mock | `apps/api/src/modules/sources/routes.ts` |
| `GET /ai/proposed-edits/:id` did not exist, so a transcript read back after a reload showed a chip and no hunks | `apps/api/src/modules/ai/routes.ts` |
| `ArticleAskPane` passed `readOnly`, which disables `ChatPane`'s composer outright — an agent got a pane with nothing to ask with | `apps/web/src/components/ai/ArticleAskPane.tsx` |
| The model-facing parse required `targetDocumentId`/`targetStepKey`/`targetBlockId` while the JSON schema handed to Ollama marked them optional; every evaluation case failed on it | `packages/model/src/prompt.ts` |
| `dictalm2.0-instruct:7b-q4_K_M` (tier 1) is not in the Ollama library | `packages/shared/src/schemas/wave6.ts` + the two shell tables + three docs |
| `SuggestionsPanel` required a `documentId`, which `/sources/:id` does not have | `apps/web/src/components/workspace/SuggestionsPanel.tsx` |
| The scripted model treated *any* tool message in the history as a tool turn, so from the second user message onwards in a conversation that had used a tool it stopped evaluating intent entirely | `apps/api/src/modules/ai/scripted.ts` |
| The scripted model matched its rules against the whole user message, which `withContext` extends with a context block — so a question from a pane never ended in `?` and never looked like a question | `apps/api/src/modules/ai/scripted.ts` |
| The structured-edit drawer sent the display **string** for every row, while `applyStructuredEdit` substitutes a row's value verbatim (an action row is `{ id, text }`, a `new-card` `meta` row is the whole metadata object). Every row that was not plain text answered 400, so the editor could not save a `new-card` at all | `apps/web/src/lib/suggestionRows.ts` (`structuredValue`) |
| X4a's `applyRows` was a second implementation of `applyStructuredEdit` and had diverged from it on two rules (an emptied optional list, and whether the atomic-group rule belongs to the apply) | `apps/web/src/lib/suggestionRows.ts` — now delegates to the shared function |
