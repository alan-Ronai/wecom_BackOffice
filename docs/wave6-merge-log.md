# Wave 6 — merge log (`wave6/integration`)

Branch created from `main` `49ebef7` ("docs(plan): X4a — ChatPane onToolResult/stepIndex pins applied").
X0 (contracts, migration 0050) was already on `main`. Lanes are merged `--no-ff`, one at a time,
with a gate after each.

## Lane inventory

| Lane | Branch | Head merged | Report |
|---|---|---|---|
| X0 contracts | (on `main`) | `49ebef7` | `.superpowers/sdd/program/X0-report.md` |
| X1 generation quality | `worktree-agent-adcdcfb4cb74550bf` | _pending_ | `.superpowers/sdd/program/X1-report.md` |
| X2 chat backend | `worktree-agent-abe0d6649e504e56a` | _pending_ | `.superpowers/sdd/program/X2-report.md` |
| X3 suggestion editing & analytics | `worktree-agent-a0e0083ecf976c5ac` | `da678eb` | `.superpowers/sdd/program/X3-report.md` |
| X4a workspace web | `worktree-agent-a9e1f15bb0dff2a13` | `c22157a` | `.superpowers/sdd/program/X4a-report.md` |
| X4b chat elsewhere + admin web | `worktree-agent-a4ffaf11d0339e937` | `f3b2abe` | `.superpowers/sdd/program/X4b-report.md` |

Merge order on this branch deviates from the plan's X1 → X2 → X3 → X4a → X4b: X3 and X4b were
finished first and were merged first (X3, X4b, X4a), then X1 and X2 when they landed. The order is
safe because X3 touches only `apps/api/src/modules/sources` + `packages/shared`, and X4a/X4b touch
only `apps/web`.

## Conflicts and how they were resolved

| Merge | File | Resolution |
|---|---|---|
| X3 | — | clean |
| X4b | — | clean |
| X4a | `apps/web/src/api/keys.ts` | union: `keys.ai` keeps X4b's `settings`/`versions`/`evalRuns` **and** X4a's `conversations`/`conversation`/`proposedEdits`; X4a's `keys.suggestion(id)` and the shared `keys.suggestionAnalytics(q)` kept once |
| X4a | `apps/web/src/api/wave6.ts` | X4a's bridge (uses `API_BASE` + `checked`/`unwrap` from the generated-client helpers) wins; X4b's `w6Text` appended so the JSONL export keeps working. Both are deleted in the seams task |
| X4a | `apps/web/src/components/ai/ChatPane.tsx` | X4b's placeholder dropped, X4a's real pane kept (as both lanes agreed). `EditorChatDock`'s `onProposedEdits` was re-typed from `(id: string)` to `(pe: ProposedEdits)` to match the real pane |
| X4a | `apps/web/src/styles/app.css` | both blocks kept (X4b's dock/ask/admin rules, then X4a's workspace rules) |
| X4a | `apps/web/test/msw/handlers.ts` | both handler groups registered: `aiAdminHandlers` (X4b, `/admin/ai/*` + `/suggestions/analytics`) before `aiHandlers` (X4a, `/ai/*` + the wave-6 `/suggestions/:id` routes), both reset in `resetState()` |

## Verified import table

Filled in as each lane lands; a `MISS` here is a lane defect.

### API

| Export | Path | Status |
|---|---|---|
| `SuggestionService.editStructured` / `acceptParts` | `apps/api/src/modules/sources/suggestions.ts` | ok (X3) |
| `suggestionAnalytics` | `apps/api/src/modules/sources/analytics.ts` | ok (X3) |
| `relaxOptionalBodies` | `apps/api/src/openapi.ts` | ok (X3) |
| `ImpactService` | `apps/api/src/modules/sources/impact.ts` | pending X1 |
| `ChatOrchestrator`, `impactPort`, `proposedEdits`, `scripted` | `apps/api/src/modules/ai/*` | pending X2 |

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

## Known duplication left for the seams task

- Two `useSuggestionAnalytics` hooks (`hooks/suggestionsEdit.ts` from X4a, `hooks/suggestionAnalytics.ts` from X4b) — both read the same route with the same key; dedupe when the bridge goes.
- `apps/web/src/lib/suggestionRows.ts` (X4a) duplicates X3's shared `rowsOf`; the **ids** match X3
  exactly, only the Hebrew labels were never pinned.
- `NumField` in `components/admin/ai/` duplicates `WorkflowSettingsSection`'s.
