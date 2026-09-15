# X6 — Wave 6 Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge lanes X1–X4b onto one branch, perform the mounts the lanes were forbidden to make (sidebar/admin console, article, editor, sources page), close the cross-lane seams (chat impact port → X1's impact service, web hooks → generated client, SSE for `ai.message`, migration 0054), evaluate the model tiers on the VM and record the scores, prove the AI-copilot flows end to end against the real stack, and hand a green `wave6/integration` to the controller for the final merge into `main`.

**Architecture:** Same pattern as V6 (`2026-09-15-V6-integration.md`): an integration branch, lanes merged in dependency order with append-only conflict rules, a verified import table before any mount, mounts as minimal edits at named anchors in the files no lane could touch, seams as small explicit commits, then Playwright against Postgres + API + built SPA. The real e2e stack runs with `MODEL_DISABLED=true` and no Ollama (`scripts/e2e-real.mjs:407`), so the two wave-6 flows run the chat through X2's deterministic **`AI_TEST_SCRIPT`** mode (a scripted `ModelClient` that answers by rule, never by inference) while every other layer — tools, persistence, proposed-edit application, suggestions, structured edits, analytics — is the real code. Model *quality* is measured separately by the eval harness on the VM (Task 7), not by e2e.

**Tech Stack:** pnpm workspaces, TypeScript strict, Fastify 5 + pg, React 18 + React Router + TanStack Query + generated `openapi-fetch` client, SSE (`fetch` + `ReadableStream` in `aiStream.ts`), Vitest + MSW, Playwright (`scripts/e2e-real.mjs`), node-pg-migrate, Ollama on the LAN VM.

**Spec:** `docs/superpowers/specs/2026-09-15-kb-wave6-ai-copilot-design.md` (§1 decisions, §4 API, §5 behaviour, §6 tiers, §7 isolation, §8 acceptance). Contract: `docs/api/CONTRACTS-wave6.md` (written by X0). X0 plan: `2026-09-15-X0-wave6-contracts.md` (canonical names).

## Global Constraints

- Node `>=22`, pnpm `>=9`, TypeScript `strict: true`; run from the repo root; web tests with `--minWorkers=1 --maxWorkers=4`.
- All work on branch `wave6/integration`, created from `main` in this worktree. Never commit to `main`; the controller merges.
- Migrations: wave 6 owns exactly `0050`–`0054` (X0 0050, X1 0051, X2 0052, X3 0053, X6 0054). `checkOrder` is on (`apps/api/src/migrate.ts:18`); nothing at 0055+ may exist on this branch; the other session reserves nothing below 0055. `apps/api/test/migrations.test.ts:414-422` counts every migration ≥ 0030 for the wave-4-only rollback — no change needed for 0050–0054, but the rollback case must stay green with them present.
- Append-only shared files (keep both sides on conflict, older wave first): `apps/api/src/modules/index.ts`, `apps/web/src/routes.tsx` (lazy `split(...)` form), `packages/shared/src/events.ts` (+ `events.test.ts` order), `packages/shared/src/permissions.ts` (+ test), `apps/api/src/plugins/boss.ts`, `apps/web/src/api/keys.ts`, `apps/web/test/msw/handlers.ts` (`handlers` array at `:122`). `docs/api/openapi.json` and `apps/web/src/api/schema.d.ts` are never hand-merged — `pnpm openapi`.
- Peer constraints (binding, from the wave-3 session): `EMBED_DIMENSION` boot check stays; anything wrapping `app.model.embed` also wraps `embedBatch`; `guardedFetch` is the only outbound fetch; no inline scripts (CSP; first paint must not leave the origin); `apps/api/test/route-coverage.test.ts` needs an integration test naming every new operation's path (allowlist entries need a ≥20-char reason); test fixtures that set `SESSION_SECRET`/`CONNECTOR_KEY` must use real-looking hex.
- e2e ports: `E2E_PG_PORT=55535 E2E_API_PORT=3212 E2E_WEB_PORT=4282` (`E2E_OIDC_PORT=9412`); 4190/6000/10080 are WHATWG bad ports and the harness refuses them; 8443–8446 belong to the compose gate; never run the two `e2e:real` variants concurrently (shared local-login rate limit).
- Hebrew UI copy, English identifiers; conventional commits ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Facts about `main` at planning time (2026-09-15, HEAD 6825284)

- Wave 5 is merged (3a968f1); the other session's post-pilot lanes are merged through 4b0e681 (embedding status, TRUST_PROXY_HOPS, CSP, self-hosted fonts, `MIN_SEARCH_CHARS=3`, route coverage, Hebrew `VALIDATION` envelope, `DocumentSyncState`, `asset_refs` triggers with five owners).
- `apps/api/src/plugins/model.ts:32-44` builds one `OllamaModel` from `MODEL_NAME`/`EMBED_MODEL`, runs `assertEmbeddingDimension` at boot and wraps the client with `instrumentEmbedding` (a Proxy measuring `embed` widths). X0 makes it read `resolveModelSlots(config)`; X2 adds a second client for `CHAT_MODEL`; X1 swaps the embedder and rebuilds the column in 0051 reading the same `EMBED_DIMENSION` env.
- `scripts/e2e-real.mjs:407` starts the API with `MODEL_DISABLED: 'true'` — the real gate has **no Ollama**. `RuleBasedModel` produces suggestions; X1's `affects` must be attached server-side (impact service) so suggestions in the gate still carry it; the chat must have X2's `AI_TEST_SCRIPT=1` scripted client to be testable there.
- `deploy/e2e.env` pins `MODEL_NAME=qwen2.5:0.5b-instruct-q4_K_M`, `EMBED_MODEL=nomic-embed-text:latest`, `EMBED_DIMENSION=768`; `scripts/e2e-compose.mjs:187-238` waits for `ollama-pull` and asserts both tags literally; `deploy/ollama-pull.sh` loops over `MODEL_NAME` + `EMBED_MODEL`. X1 owns extending these to the two slots + `bge-m3`; X6 verifies `pnpm e2e:compose` still passes after the merge (Task 10).
- `Sidebar.tsx:51-58` `adminLinks` = `[label, to, permission][]`; `AdminLayout.tsx:11-20` `LINKS` = `[to, label, needs][]` — `/admin/ai` goes into both. `Sidebar.tsx:264-272` is the "נתונים" section (sources, data, graph, dashboards, feedback, analytics).
- `ArticlePage.tsx:459-480` header `meta` chips (`LearningBadge` at `:476`); `:529-541` `workOrSource` (source-review strip, `RefreshBanner`, `paneBody`); `:676-700` topbar buttons (`FeedbackButton`, `PaneModeToggle`, print, pin, edit); `overflowItems` at `:593` for the narrow topbar.
- `EditorPage.tsx:294` `const [doc, setDoc] = useState<Document | null>(null)`; `:752-800` toolbar (templates, "מיפוי מקור ↔ שלבים", `ImportExportButtons`, "ערוך מקור" link, JSON export, "שלח לסקירה", publish); `:1031-1037` `<SidePane doc published checks fields blocks />`. `apps/web/src/lib/editorModel.ts` exports `newStep(num)`, `addBasic(...)`, `addAction(doc, key, text)`, `renumber(doc)` — the `draft_step` insertion uses `addBasic` + `renumber` and `setDoc`.
- `SourcesPage.tsx:266-310` right `aside.src-panel` renders `SuggestionCard` per suggestion with `onDecide`/`onEdit(text)`; `SuggestionCard` props are `{ suggestion, canReview, canApply, onDecide, onEdit }` (`SuggestionCard.tsx:31-43`). X4a's `SuggestionsPanel` (structured editor, `affects` chips, partial apply) replaces this list on the workspace; X6 mounts the same components here so the sources page and the workspace never diverge.
- `apps/web/src/api/events.ts:72-118` is an if/else chain by event name; `ai.message` falls through until Task 6.
- `apps/web/e2e/real/helpers/users.ts` provides `adminApi`, `createUser(request, 'agent'|'editor'|'lead'|'approver')`, `signInAs` (handles the `E2E_OIDC=1` disclosure); `learning-loop.spec.ts` is the pattern for staged specs (numbered stages, durable post-conditions, `opened` registry drained in `afterEach`).
- `apps/api/test/route-coverage-allowlist.json` already exempts `POST /suggestions/{id}/reset` and `PUT /suggestions/{id}/edit` for fixture cost; X3's structured edit must **not** widen that list — `wave6-seams.test.ts` names the paths.

## File structure

```
docs/wave6-merge-log.md                                    (new) inventory, conflicts, verified import table
docs/wave6-acceptance.md                                   (new) §1 decision → test matrix, eval table, gate, parked
apps/web/src/components/shell/Sidebar.tsx                 (modify) adminLinks += /admin/ai; "סביבת עבודה" not a nav entry
apps/web/src/components/admin/AdminLayout.tsx             (modify) LINKS += ['ai', 'בינה מלאכותית', 'ai.manage']
apps/web/src/components/article/ArticlePage.tsx           (modify) ArticleAskPane; "פתח בסביבת העבודה" (ai.chat)
apps/web/src/components/editor/EditorPage.tsx             (modify) EditorChatDock; draft_step insertion; workspace link
apps/web/src/components/sources/SourcesPage.tsx           (modify) SuggestionsPanel (affects chips, structured editor, partial apply); workspace link
apps/web/src/api/events.ts                                (modify) ai.message invalidation
apps/web/src/api/hooks/{ai,suggestions,aiAdmin}.ts (X2–X4b files) (modify) bridges → generated client (streaming stays on aiStream.ts)
apps/web/src/components/ai/*.tsx (X4a/X4b)                (modify only if a stub must go)
apps/web/test/integration/wave6-mounts.test.tsx           (new) one describe per mount
apps/web/e2e/real/workspace-copilot.spec.ts               (new) W6-E2E-1
apps/web/e2e/real/article-ask.spec.ts                     (new) W6-E2E-2
apps/api/src/modules/ai/impactPort.ts                     (modify) → X1's ImpactService
apps/api/src/modules/ai/scripted.ts (X2)                  (verify) AI_TEST_SCRIPT client; extend rules only if a spec needs one
apps/api/migrations/0054_wave6_seams.js                   (new) FKs/indexes the seams need
apps/api/test/int/wave6-seams.test.ts                     (new) impact port, scripted chat end to end, FKs, route names
packages/model/eval/**  (X1)                              (run, not edit) tier 0 vs tier 1 on the VM
```

## Names consumed from other lanes (verified in Task 1; adapt imports there, never re-implement)

| Lane | Import | Path assumed |
|---|---|---|
| X0 | permissions `ai.ask`/`ai.chat`/`ai.manage`; event `ai.message`; `QUEUES.aiEval`/`aiReindex`; `resolveModelSlots(config)`; `getAiSettings(q)`, `currentPromptVersion`; `wave6.ts` schemas (`ConversationSchema`, `ChatEventSchema`, `ProposedEditsSchema`, `DecideProposedEditsBodySchema`, `StructuredEditSchema`, `AcceptSuggestionBodySchema`, `SuggestionAnalyticsSchema`, `AiSettingsSchema`, `EvalRunSchema`, `AI_TOOLS`, `toolsFor`, `MODEL_TIER_PRESETS`) | `@wecom/shared`, `apps/api/src/lib/{modelSlots,aiSettings}.ts`, `apps/api/src/plugins/boss.ts` |
| X1 | `ImpactService` with `impactFor(q, change: { documentIds, blockIds, fieldNames, sourceId }): Promise<ImpactSet>` and `affectsFor(q, suggestion): Promise<AffectsItem[]>`; prompt v3 assembler `buildSystemPrompt(settings, ctx)`; `packages/model/eval` (`pnpm --filter @wecom/model eval --model <tag> --embed <tag> --out <json>`); `POST /admin/ai/models/test`; reindex job; migration 0051; deploy scripts updated for two slots + `bge-m3` | `apps/api/src/modules/sources/impact.ts`, `packages/model/src/prompt.ts`, `packages/model/eval/*`, `deploy/*` |
| X2 | `apps/api/src/modules/ai/*`: routes per contract §4.3, `ChatOrchestrator`, tool runtime (`tools/*.ts`), `impactPort.ts` (`ImpactPort { impactFor, affectsFor }` implemented locally until X6 re-points), `proposedEdits.ts` (`applyProposedEdits(tx, id, decision, user)` reusing `saveSourceDocument` with `If-Match`), export route; **`AI_TEST_SCRIPT=1` scripted client** `scripted.ts` (see requirement below); migration 0052 | `apps/api/src/modules/ai/*` |
| X3 | `PATCH /suggestions/:id/edit` (structured), `POST /suggestions/:id/accept` with `parts`, `GET /suggestions/analytics`, `editDiff`/`appliedParts` persistence; migration 0053 | `apps/api/src/modules/sources/{suggestions,structuredEdit,analytics}.ts` |
| X4a | `WorkspacePage` (`/workspace/:id`), `ChatPane({ conversationKind, documentId, sourceRevisionId?, context?, tools? })`, `ProposedEditsOverlay`, `SuggestionsPanel({ sourceId, documentId?, canReview, canApply })`, `StructuredEditDrawer`, `AffectsChips({ affects })`; `apps/web/src/api/aiStream.ts` (`streamMessage(conversationId, body, onEvent, signal)`); hooks `useConversations`, `useConversation`, `useCreateConversation`, `useDecideProposedEdits`, `useStructuredEdit`, `useAcceptParts`, `useSuggestionAnalytics`; keys `keys.ai.*`, `keys.suggestionAnalytics` | `apps/web/src/components/workspace/*`, `apps/web/src/components/ai/*`, `apps/web/src/api/{aiStream.ts,hooks/ai.ts,hooks/suggestions.ts}` |
| X4b | `EditorChatDock({ documentId, onDraftStep(step) })`, `ArticleAskPane({ documentId })`, `AiPage` (`/admin/ai`), hooks `useAiSettings`, `usePutAiSettings`, `useModelTest`, `useEvalRuns`, `useAdminConversations`, `exportConversationsUrl` | `apps/web/src/components/ai/EditorChatDock.tsx`, `apps/web/src/components/ai/ArticleAskPane.tsx`, `apps/web/src/components/admin/AiPage.tsx`, `apps/web/src/api/hooks/aiAdmin.ts` |

**Requirement X6 places on X2 (verify in Task 1; if absent, implement it in X2's module as a lane defect):** when `AI_TEST_SCRIPT=1`, `plugins/model.ts` (or X2's chat client factory) must provide a `ScriptedChatModel implements ModelClient['chat']` that never calls Ollama and answers deterministically from the last user message:
- a message matching `/^(שנה|החלף|תקן|קצר)\b/` → one `propose_source_edit` tool call whose op replaces the first paragraph containing the quoted or `"…"`-delimited text (or the first `<p>` when none) with the text after `ל-`/`→`, then a one-line Hebrew confirmation;
- a message matching `/^(שפר|עדכן) את ההצעה/` with `context.suggestionId` → one `refine_suggestion` tool call that appends the message's quoted text as an action;
- a message ending with `?` → `read_document` then an answer that names the first step as `שלב 1` (so the article Q&A can assert a citation);
- a message matching `/^(מחק|שנה) את המסמך/` from an `ai.ask` caller → the orchestrator refuses the write tool before the model sees it, answering `אין לי הרשאה לשנות תוכן` (this is the orchestrator's permission gate, not the script);
- any other message → `הבנתי.`
The scripted client is only constructed when `AI_TEST_SCRIPT=1` **and** `NODE_ENV !== 'production'`; the config test asserts production refuses it.

---

### Task 1: Inventory and merge playbook

**Files:**
- Create: `docs/wave6-merge-log.md`
- Modify: `.superpowers/sdd/program/progress.md` (git-ignored ledger; append, never commit)

**Interfaces:**
- Consumes: lane branches X1–X4b, `main` (≥ 4b0e681).
- Produces: `wave6/integration` with every lane merged, a verified import table, a green baseline.

- [ ] **Step 1: Create the branch and record the inventory**

```bash
git checkout -b wave6/integration main
git branch -a --format='%(refname:short) %(objectname:short) %(subject)' | grep -E 'worktree-agent|wave6|fix/wave6' | tee docs/wave6-merge-log.md
```
Identify lanes by their first commit subjects (`feat(model)`/`feat(sources): impact` = X1, `feat(ai)` = X2, `feat(suggestions)` = X3, `feat(web): workspace` = X4a, `feat(web): ai chat dock`/`admin ai` = X4b). Write `Lane | branch | head | report path` (reports at `.claude/worktrees/agent-<id>/.superpowers/sdd/program/X*-report.md`, copies under `/Users/alankantor/Downloads/Ronai/wecom_BackOffice/.superpowers/sdd/program/`).

- [ ] **Step 2: Merge in this order, one at a time** — X1 → X2 → X3 → X4a → X4b.

```bash
git merge --no-ff <branch> -m "Merge wave 6 lane <Xn>: <one-line scope>"
```
Conflict rules: append-only files keep both sides (wave 5 before wave 6, alphabetical within); `apps/api/src/plugins/model.ts` — X1 (embedder/`resolveModelSlots`) and X2 (chat client) both edit it: merge by function, keep `assertEmbeddingDimension` + `instrumentEmbedding` and wrap **both** `embed` and `embedBatch`; `apps/api/src/modules/sources/suggestions.ts` — X1 (`affects`/`promptVersion`/`model` on insert) and X3 (structured edit / partial apply) both edit it: merge by function and run `apps/api/test/sources/*.test.ts` + `test/int/wiring.test.ts`; `packages/shared/src/schemas/pipeline.ts` — X0 added the fields, X1/X3 may append more: keep all; `apps/web/test/msw/handlers.ts` — one group per lane, dedupe identical paths in favour of `CONTRACTS-wave6.md`. Anything else is a seam: resolve for the spec, log it, add a test in Task 6.

- [ ] **Step 3: Gate after every merge**

```bash
pnpm install --frozen-lockfile || pnpm install
pnpm -r build && pnpm typecheck
pnpm --filter @wecom/shared test && pnpm --filter @wecom/connectors test && pnpm --filter @wecom/model test
pnpm --filter @wecom/api test && RUN_INTEGRATION=1 pnpm --filter @wecom/api test:int
pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4
pnpm openapi && git diff --exit-code docs/api/openapi.json apps/web/src/api/schema.d.ts || { git add docs/api/openapi.json apps/web/src/api/schema.d.ts && git commit -m "chore(contract): regenerate OpenAPI after merging <Xn>"; }
pnpm lint
echo "X6: merged <Xn> (<sha>) — gate green" >> .superpowers/sdd/program/progress.md
```
Known load flakes (re-run in isolation before calling red): `apps/api/test/boss.test.ts`, `apps/api/test/sources/routes.test.ts`, web `wave4-mounts.test.tsx` (TipTap race), `editor/*`. A genuine red blocks the next merge: smallest `fix(<lane>): …` commit, logged.

- [ ] **Step 4: Verify the import table and the X2 requirement**

```bash
for f in apps/api/src/modules/sources/impact.ts apps/api/src/modules/ai/index.ts apps/api/src/modules/ai/routes.ts apps/api/src/modules/ai/orchestrator.ts apps/api/src/modules/ai/impactPort.ts apps/api/src/modules/ai/proposedEdits.ts apps/api/src/modules/ai/scripted.ts apps/api/src/modules/sources/structuredEdit.ts apps/api/src/modules/sources/analytics.ts packages/model/eval/run.ts apps/web/src/api/aiStream.ts apps/web/src/api/hooks/ai.ts apps/web/src/api/hooks/suggestions.ts apps/web/src/api/hooks/aiAdmin.ts apps/web/src/components/workspace/WorkspacePage.tsx apps/web/src/components/ai/ChatPane.tsx apps/web/src/components/ai/ProposedEditsOverlay.tsx apps/web/src/components/ai/SuggestionsPanel.tsx apps/web/src/components/ai/StructuredEditDrawer.tsx apps/web/src/components/ai/AffectsChips.tsx apps/web/src/components/ai/EditorChatDock.tsx apps/web/src/components/ai/ArticleAskPane.tsx apps/web/src/components/admin/AiPage.tsx; do [ -f "$f" ] && echo "ok   $f" || echo "MISS $f"; done
grep -rn "AI_TEST_SCRIPT" apps/api/src | head
grep -rn "export \(function\|const\|class\|interface\) \(ImpactService\|ImpactPort\|ChatOrchestrator\|ScriptedChatModel\|applyProposedEdits\|streamMessage\|useConversation\|useDecideProposedEdits\|useStructuredEdit\|useAcceptParts\|useSuggestionAnalytics\|useAiSettings\|useEvalRuns\|WorkspacePage\|ChatPane\|SuggestionsPanel\|EditorChatDock\|ArticleAskPane\|AiPage\)" apps/api/src apps/web/src packages/model/src | sort
grep -n "propose_source_edit\|refine_suggestion\|read_document" apps/api/src/modules/ai/scripted.ts
```
Write the real names into `docs/wave6-merge-log.md`. A missing component is a lane defect: implement it minimally in the lane's directory with a unit test, `fix(<lane>): add missing <Component>`, logged. If `scripted.ts` is missing or lacks the four rules above, implement it in `apps/api/src/modules/ai/scripted.ts` exactly as specified (it is ~80 lines: a regex switch returning `ChatResult` objects with `toolCalls`), gate it in `plugins/model.ts` on `AI_TEST_SCRIPT === '1' && NODE_ENV !== 'production'`, and add `apps/api/test/unit/scripted-chat.test.ts` covering the four rules.

- [ ] **Step 5: Commit the baseline**

```bash
git add docs/wave6-merge-log.md && git commit -m "docs(x6): wave 6 merge log and verified import table"
echo "X6: baseline $(git rev-parse --short HEAD) — X1–X4b merged, green" >> .superpowers/sdd/program/progress.md
```

---

### Task 2: Shell and admin-console mounts

**Files:**
- Modify: `apps/web/src/components/shell/Sidebar.tsx:51-58`, `apps/web/src/components/admin/AdminLayout.tsx:11-20`, `apps/web/src/routes.tsx` (only if X4b did not register `admin/ai` and `workspace/:id`)
- Test: `apps/web/test/integration/wave6-mounts.test.tsx` (create)

**Interfaces:**
- Consumes: `AiPage` (X4b), `WorkspacePage` (X4a), routes `/admin/ai`, `/workspace/:id`.
- Produces: `/admin/ai` reachable from both the sidebar admin list and the admin console tabs for `ai.manage`; no top-level nav entry for the workspace (it is reached from a document, spec §5).

- [ ] **Step 1: Write the failing test**

```tsx
/**
 * X6 — wave 6 components mounted into the shell, admin console, article, editor and sources page.
 * One describe per mount task; copy asserted against what the lanes shipped.
 */
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { fx } from '../msw/fixtures.js';

const B = '/api/v1';
const side = async () => within(await screen.findByRole('complementary', { name: 'ניווט ראשי' }));
const withPermissions = (...permissions: string[]) =>
  server.use(http.get(`${B}/auth/me`, () => HttpResponse.json({ ...fx.me, permissions })));

describe('X6 shell + admin mounts', () => {
  it('lists בינה מלאכותית under admin for ai.manage', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const s = await side();
    expect(await s.findByText('בינה מלאכותית')).toBeInTheDocument();
  });
  it('hides it without ai.manage and shows it in the admin console tabs with it', async () => {
    withPermissions('docs.read', 'users.manage');
    renderWithProviders(<App />, { route: '/admin/users' });
    const s = await side();
    expect(s.queryByText('בינה מלאכותית')).toBeNull();
    server.resetHandlers();
    renderWithProviders(<App />, { route: '/admin/ai' });
    expect(await screen.findByRole('heading', { name: /בינה מלאכותית/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'בינה מלאכותית' })).toHaveClass('active');
  });
});
```
(The heading text comes from X4b's `AiPage`; adjust the regex to the shipped `<h1>` after Task 1.)

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @wecom/web test -- test/integration/wave6-mounts.test.tsx` → FAIL (no such nav entry).

- [ ] **Step 3: Mount**

`Sidebar.tsx` — append to `adminLinks` (after `['מצב מערכת', '/admin/system', 'system.admin']`):
```ts
    ['בינה מלאכותית', '/admin/ai', 'ai.manage'],
```
`AdminLayout.tsx` — append to `LINKS` (after `['system', 'מצב מערכת', 'system.admin']`):
```ts
  ['ai', 'בינה מלאכותית', 'ai.manage'],
```
and add `can('ai.manage')` to the console's visibility `||` chain at `:25-29`. If `routes.tsx` lacks them, add under the admin children `{ path: 'ai', element: split(AiPage) }` and at top level `{ path: 'workspace/:id', element: split(WorkspacePage) }` with lazy loaders in the existing style.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `feat(web): mount the AI admin page in the sidebar and admin console`.

---

### Task 3: Article mounts — ask pane and workspace link

**Files:**
- Modify: `apps/web/src/components/article/ArticlePage.tsx` (`:676-700` topbar, `:593` `overflowItems`, `:529-541` `workOrSource`)
- Test: `apps/web/test/integration/wave6-mounts.test.tsx` (extend)

**Interfaces:**
- Consumes: `ArticleAskPane({ documentId })` (X4b; gates itself on `ai.ask`, collapsed by default, header "שאל את המערכת"), route `/workspace/:id`.
- Produces: the ask pane under the work view; a "🧭 סביבת עבודה" button for `ai.chat` holders.

- [ ] **Step 1: Tests**
```tsx
describe('X6 article mounts', () => {
  it('offers the ask pane to an agent and no workspace link', async () => {
    withPermissions('docs.read', 'ai.ask');
    renderWithProviders(<App />, { route: `/doc/${fx.docs[0].id}` });
    expect(await screen.findByRole('button', { name: /שאל את המערכת/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /סביבת עבודה/ })).toBeNull();
  });
  it('offers the workspace link to an editor with ai.chat and hides the pane without ai.ask', async () => {
    withPermissions('docs.read', 'docs.edit', 'ai.chat');
    renderWithProviders(<App />, { route: `/doc/${fx.docs[0].id}` });
    expect(await screen.findByRole('button', { name: /סביבת עבודה/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /שאל את המערכת/ })).toBeNull();
  });
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Mount** — imports `import { ArticleAskPane } from '../ai/ArticleAskPane.js';`. In `workOrSource` after `<RefreshBanner documentId={doc.id} />` add `<ArticleAskPane documentId={doc.id} />`. In the topbar after the edit button:
```tsx
              {can('ai.chat') && can('docs.edit', doc) ? (
                <button className="btn sm" onClick={() => go(`/workspace/${doc.id}`)}>
                  🧭 סביבת עבודה
                </button>
              ) : null}
```
and the same entry in `overflowItems` (`{ label: '🧭 סביבת עבודה', run: () => go(`/workspace/${doc.id}`) }`, gated identically).
- [ ] **Step 4: Run → PASS. Step 5: Commit** — `feat(web): article — ask pane for agents, workspace link for editors`.

---

### Task 4: Editor mounts — chat dock, draft-step insertion, workspace link

**Files:**
- Modify: `apps/web/src/components/editor/EditorPage.tsx` (`:752-800` toolbar, `:1031-1037` SidePane, `:294` doc state)
- Test: `apps/web/test/integration/wave6-mounts.test.tsx` (extend)

**Interfaces:**
- Consumes: `EditorChatDock({ documentId, onDraftStep })` (X4b) — `onDraftStep(step: Step)` is called when the chat's `draft_step` tool result is accepted in the dock; `addBasic`, `renumber` from `lib/editorModel.ts`.
- Produces: the dock beside `SidePane` for `ai.chat`; a drafted step lands at the end of the active phase and the editor becomes dirty.

- [ ] **Step 1: Tests**
```tsx
describe('X6 editor mounts', () => {
  it('shows the chat dock for ai.chat and inserts a drafted step into the document', async () => {
    withPermissions('docs.read', 'docs.edit', 'ai.chat');
    renderWithProviders(<App />, { route: `/edit/${fx.docs[0].id}` });
    const dock = await screen.findByRole('complementary', { name: 'עוזר עריכה' });
    await userEvent.click(within(dock).getByRole('button', { name: 'הוסף שלב מהצעה' })); // MSW scripted reply
    expect(await screen.findByText('שלב מוצע מהעוזר')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /פרסם/ })).toBeEnabled();
  });
  it('hides the dock without ai.chat', async () => {
    withPermissions('docs.read', 'docs.edit');
    renderWithProviders(<App />, { route: `/edit/${fx.docs[0].id}` });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('complementary', { name: 'עוזר עריכה' })).toBeNull();
  });
});
```
(The MSW group from X4b must answer `POST /ai/conversations/:id/messages` with a `tool_result` for `draft_step` carrying `{ step: { title: 'שלב מוצע מהעוזר', actions: [...] } }` — verify the fixture name in Task 1 and adapt the button label to the shipped dock.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Mount** — import `EditorChatDock` and `addBasic, renumber`. After `<SidePane … />`:
```tsx
      {!isNew && can('ai.chat') && can('docs.edit', doc) ? (
        <EditorChatDock
          documentId={id}
          onDraftStep={(step) =>
            setDoc((d) => {
              if (!d) return d;
              const phaseId = d.phases[d.phases.length - 1]?.id ?? null;
              const next = addBasic(d, 'step', phaseId, null);
              const last = next.phases[next.phases.length - 1];
              const inserted = last.steps[last.steps.length - 1];
              Object.assign(inserted, { title: step.title, description: step.description, actions: step.actions, outcomes: step.outcomes });
              return renumber(next);
            })
          }
        />
      ) : null}
```
Read `addBasic`'s real signature at `lib/editorModel.ts:40` and adapt (it may take `(doc, type, phaseId, afterKey)`); keep the dirty-marking path the existing add-step button uses (`markDirty`/`setDirty` if present — grep `dirty` in EditorPage). Toolbar: after the "ערוך מקור" link add `{!isNew && can('ai.chat') ? <Link className="btn sm" to={`/workspace/${id}`}>🧭 סביבת עבודה</Link> : null}`.
- [ ] **Step 4: Run → PASS. Step 5: Commit** — `feat(web): editor — AI chat dock with draft-step insertion, workspace link`.

---

### Task 5: Sources-page mounts — affects chips, structured editor, partial apply

**Files:**
- Modify: `apps/web/src/components/sources/SourcesPage.tsx:266-310`
- Test: `apps/web/test/integration/wave6-mounts.test.tsx` (extend)

**Interfaces:**
- Consumes: `SuggestionsPanel({ sourceId, canReview, canApply })` (X4a) — renders `AffectsChips`, opens `StructuredEditDrawer`, calls `useAcceptParts`; keeps the "אשר הכל" and publish footer semantics.
- Produces: the sources page and the workspace show the same suggestion cards.

- [ ] **Step 1: Tests**
```tsx
describe('X6 sources mounts', () => {
  it('renders affects chips and opens the structured editor from the sources page', async () => {
    renderWithProviders(<App />, { route: `/sources/${fx.sources[0].id}` });
    const panel = await screen.findByRole('complementary', { name: 'הצעות לכרטיסים' });
    expect(await within(panel).findByText(/משפיע על/)).toBeInTheDocument();
    await userEvent.click(within(panel).getAllByRole('button', { name: 'עריכה מובנית' })[0]);
    expect(await screen.findByRole('dialog', { name: /עריכת הצעה/ })).toBeInTheDocument();
  });
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Mount** — replace the `items.map((s) => <SuggestionCard …/>)` block and its `onEdit` text-blob mapping with `<SuggestionsPanel sourceId={current.id} canReview={canReview} canApply={canApply} />`, keeping the `hd` header, the "אשר הכל" control (it now calls the panel's exposed `acceptAllPending()` or stays as is if the panel does not expose one — decide in Task 1) and the publish footer. Delete the now-unused `onEdit` payload mapping; if `SuggestionCard` has no other consumer, leave it (X4a reuses it inside the panel) — grep before deleting. Give the `aside` `aria-label="הצעות לכרטיסים"`.
- [ ] **Step 4: Run → PASS**, plus `apps/web/test/sources/Sources.test.tsx` (update the two assertions that relied on the text-blob editor). **Step 5: Commit** — `feat(web): sources page uses the workspace suggestions panel (affects, structured edit, partial apply)`.

---

### Task 6: Seams — impact port, SSE, generated client, migration 0054

**Files:**
- Modify: `apps/api/src/modules/ai/impactPort.ts`, `apps/web/src/api/events.ts`, X2/X4a/X4b hook files that still carry a `checked()`/fetch bridge for non-streaming routes
- Create: `apps/api/migrations/0054_wave6_seams.js`, `apps/api/test/int/wave6-seams.test.ts`
- Test: `apps/web/test/api/events.test.tsx` (extend)

**Interfaces:**
- Consumes: X1 `ImpactService` (`impactFor`, `affectsFor`); X2 `ImpactPort`; `keys.ai.*`.
- Produces: one impact implementation; `ai.message` invalidates `keys.ai.conversation(id)` + `['ai','conversations']`; every non-streaming wave-6 call on `api.GET/POST/PATCH/DELETE`; FKs for `ai_proposed_edits.document_id → documents`, `ai_messages.refined_suggestion_id → suggestions`, `ai_conversations.source_revision_id → source_revisions`, and `suggestions.parent_id` if X3 added it without one; an index on `ai_messages(conversation_id, seq)` if 0052 lacks it.

- [ ] **Step 1: API seam test**
```ts
// apps/api/test/int/wave6-seams.test.ts (RUN_INTEGRATION=1)
it('the chat impact port answers with X1 impact (shared block users appear in affects)', async () => {
  // seed: two documents sharing one block; ask the orchestrator's read_impact tool for doc A
  const r = await app.inject({ method: 'POST', url: `/api/v1/ai/conversations`, headers: editor, payload: { kind: 'workspace', documentId: docA } });
  const conv = r.json();
  const events = await streamToArray(app, `/api/v1/ai/conversations/${conv.id}/messages`, editor, { content: 'מה מושפע מהשינוי?' }); // AI_TEST_SCRIPT=1 answers by rule
  const impact = events.find((e) => e.type === 'tool_result' && e.name === 'read_impact');
  expect(impact?.summary).toMatch(docBTitle);
});
it('0054 foreign keys exist and cascade', async () => { /* information_schema.table_constraints for the four FKs; delete a document, assert its proposed edits are gone */ });
it('names every wave 6 route (route coverage)', async () => { /* touch GET /ai/conversations, GET /admin/ai/settings, GET /suggestions/analytics, GET /admin/ai/eval/runs, GET /admin/ai/conversations with the right roles and assert 200/403 */ });
```
(`streamToArray` — a 20-line helper that reads the SSE body from `app.inject` and parses `data:` lines with `ChatEventSchema`; put it in `apps/api/test/helpers/sse.ts` if X2 did not ship one.) Run with `AI_TEST_SCRIPT=1` in the test env (`buildTestApp` config override).
- [ ] **Step 2: Run → FAIL** (port answers from X2's local SQL, no shared-block users; FKs missing).
- [ ] **Step 3: Re-point the port** — `impactPort.ts` becomes `export const impactPort: ImpactPort = { impactFor: (q, c) => impactService.impactFor(q, c), affectsFor: (q, s) => impactService.affectsFor(q, s) }` importing X1's service; delete X2's local SQL copy. Write `0054_wave6_seams.js`:
```js
/** Wave 6 (X6): cross-lane foreign keys 0052/0053 could not declare. */
exports.up = (pgm) => {
  pgm.addConstraint('ai_proposed_edits', 'ai_proposed_edits_document_id_fkey', { foreignKeys: { columns: 'document_id', references: 'documents', onDelete: 'CASCADE' } });
  pgm.addConstraint('ai_messages', 'ai_messages_refined_suggestion_id_fkey', { foreignKeys: { columns: 'refined_suggestion_id', references: 'suggestions', onDelete: 'SET NULL' } });
  pgm.addConstraint('ai_conversations', 'ai_conversations_source_revision_id_fkey', { foreignKeys: { columns: 'source_revision_id', references: 'source_revisions', onDelete: 'SET NULL' } });
  pgm.createIndex('ai_messages', ['conversation_id', 'seq'], { ifNotExists: true });
};
exports.down = (pgm) => {
  pgm.dropIndex('ai_messages', ['conversation_id', 'seq'], { ifExists: true });
  pgm.dropConstraint('ai_conversations', 'ai_conversations_source_revision_id_fkey');
  pgm.dropConstraint('ai_messages', 'ai_messages_refined_suggestion_id_fkey');
  pgm.dropConstraint('ai_proposed_edits', 'ai_proposed_edits_document_id_fkey');
};
```
Check 0052/0053 first and drop any statement whose constraint already exists.
- [ ] **Step 4: Web seams** — `events.ts`: before the `taxonomy.changed` branch add
```ts
  } else if (ev.name === 'ai.message') {
    const { conversationId } = ev.payload as { conversationId: string };
    void qc.invalidateQueries({ queryKey: keys.ai.conversation(conversationId) });
    void qc.invalidateQueries({ queryKey: ['ai', 'conversations'] });
```
and a case in `apps/web/test/api/events.test.tsx`. Then `grep -rn "checked(\|stageJson\|w6(\|aiRequest(" apps/web/src/api/hooks/{ai,suggestions,aiAdmin}.ts` — every non-streaming call moves to `api.*` now that the routes are in `openapi.json`; `aiStream.ts` keeps its `fetch` (SSE has no generated client) with the same `API_BASE`/credentials as `client.ts`. Delete any `ChatPane` placeholder stub X4b may have shipped for the dock.
- [ ] **Step 5: Run** — `wave6-seams.test.ts`, `migrations.test.ts`, web `events` + `ai` tests, `pnpm typecheck`, `pnpm openapi` (no diff), route-coverage → green. **Commit** in three parts: `feat(api): wave 6 seams — impact port, 0054 FKs`, `feat(web): ai.message SSE invalidation; hooks on the generated client`.

---

### Task 7: Model evaluation on the VM (tier 0 vs tier 1)

**Files:**
- Modify: `docs/wave6-acceptance.md` (create; eval table), `.superpowers/sdd/program/progress.md`
- Run: `packages/model/eval` (X1), `deploy/ollama-pull.sh`

**Interfaces:**
- Consumes: `pnpm --filter @wecom/model eval --model <tag> --embed <tag> --out <path>` (X1); `POST /admin/ai/models/test`; `MODEL_TIER_PRESETS` from `@wecom/shared`.
- Produces: `ai_eval_runs` rows on the dev database and a scores table in the acceptance doc; the tier-1 tags confirmed to exist (or the recorded substitution).

- [ ] **Step 1: Confirm the tags exist in the local Ollama library**
```bash
node -e 'const p=require("./packages/shared/dist/index.js").MODEL_TIER_PRESETS;for(const t of [0,1])console.log(t,JSON.stringify(p[t]))'
for tag in $(node -e 'const p=require("./packages/shared/dist/index.js").MODEL_TIER_PRESETS;console.log([...new Set([p[0].suggestModel,p[1].suggestModel,p[1].chatModel,p[0].embedModel,p[1].embedModel])].join(" "))'); do OLLAMA_HOST=${MODEL_URL:-http://localhost:11434} ollama pull "$tag" || echo "MISSING $tag"; done
```
A `MISSING` tag means the preset names a tag the library does not carry: apply spec §6's fallback (DictaLM 2.0 → Aya Expanse 8B; if both are missing, Qwen2.5 7B instruct q4) by editing **only** the preset string in `wave6.ts` + `CONTRACTS-wave6.md`, and record the substitution and the reason in the acceptance doc. Never leave a preset pointing at a tag that does not exist.
- [ ] **Step 2: Run the harness for both tiers** (each run uses the tier's suggest + embed model; the eval set is `packages/model/eval/cases/*.json`, committed by X1):
```bash
pnpm --filter @wecom/model eval --model qwen2.5:3b-instruct-q4_K_M --embed nomic-embed-text --out /tmp/eval-tier0.json
pnpm --filter @wecom/model eval --model <tier1 suggest tag> --embed bge-m3 --out /tmp/eval-tier1.json
```
Then `POST /admin/ai/eval` against the dev API for tier 1 so an `ai_eval_runs` row exists through the product path, and `GET /admin/ai/eval/runs` shows it. Record for each: cases, hit-target, hit-type, content-overlap, median seconds per case, RAM peak (`docker stats` or `ps`), and the machine's load average — the VM is the reference; if you are not on the VM, say so in the table and mark the numbers "dev machine".
- [ ] **Step 3: Write the table** into `docs/wave6-acceptance.md` under "Model evaluation" with the ruling line: tier 1 becomes the default (`MODEL_TIER=1` in `deploy/.env.example` — X1 owns that line; verify it) only if its hit-target ≥ tier 0's; otherwise keep tier 0 default, record why, and open a parked row. Commit `docs(x6): model evaluation tier 0 vs tier 1`.

---

### Task 8: Real e2e — W6-E2E-1 workspace copilot loop

**Files:**
- Create: `apps/web/e2e/real/workspace-copilot.spec.ts`
- Modify: `scripts/e2e-real.mjs` (one env line: `AI_TEST_SCRIPT: '1'` next to `MODEL_DISABLED: 'true'` at `:407`), `apps/web/e2e/real/helpers/users.ts` (only if a role is missing)

**Interfaces:**
- Consumes: the scripted chat (Task 1 requirement), `/workspace/:id`, `SuggestionsPanel`, `GET /suggestions/analytics`.
- Produces: the acceptance evidence for spec §1.3, §1.6, §1.8, §1.9 (live half).

- [ ] **Step 1: Write the spec** (pattern: `learning-loop.spec.ts` — numbered stages, durable post-conditions, `opened` registry):
```ts
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminApi, createUser, signInAs } from './helpers/users.js';

/**
 * W6-E2E-1 — the AI copilot loop against the real stack (chat in AI_TEST_SCRIPT mode, everything
 * else real): an editor opens the workspace of a document that has a source, asks the chat to
 * change a paragraph, accepts one hunk → a new source version → the pipeline proposes suggestions
 * that carry `affects` → the editor edits one action row in the structured editor and applies part
 * of the suggestion → analytics reflects one edited-accept.
 */
const opened: { pages: Page[]; apis: APIRequestContext[] } = { pages: [], apis: [] };
test.afterEach(async () => { for (const p of opened.pages.splice(0)) await p.context().close(); for (const a of opened.apis.splice(0)) await a.dispose(); });

const stamp = Date.now().toString(36);
const DOC_TITLE = 'איטיות גלישה / חוסר גלישה'; // seeded flagship document with a source

test('W6-E2E-1 chat proposes an edit, the pipeline reacts with affects, a partial apply lands', async ({ browser, page, baseURL }) => {
  test.setTimeout(240_000);
  const api = await adminApi(page, baseURL!); opened.apis.push(api);
  const editor = await createUser(api, 'editor'); // editor role holds ai.chat + suggestions.review
  const e = await signInAs(browser, editor, baseURL!); opened.pages.push(e);

  /* 1. open the workspace from the article ---------------------------------- */
  await e.goto('/library'); await e.getByRole('link', { name: DOC_TITLE }).first().click();
  await e.getByRole('button', { name: /סביבת עבודה/ }).click();
  await expect(e).toHaveURL(/\/workspace\/[0-9a-f-]+/);
  const docId = /\/workspace\/([0-9a-f-]+)/.exec(e.url())![1];
  const before = await (await api.get(`/api/v1/documents/${docId}/source`)).json();

  /* 2. ask the chat for a change; accept exactly one hunk --------------------- */
  const chat = e.getByRole('complementary', { name: 'עוזר' });
  await chat.getByRole('textbox').fill(`שנה את "מעל 5 מגה" ל-"מעל 6 מגה ${stamp}"`);
  await chat.getByRole('button', { name: 'שלח' }).click();
  const overlay = e.getByRole('region', { name: 'שינויים מוצעים' });
  await expect(overlay.getByRole('button', { name: 'קבל' }).first()).toBeVisible({ timeout: 60_000 });
  await overlay.getByRole('button', { name: 'קבל' }).first().click();
  await expect.poll(async () => (await (await api.get(`/api/v1/documents/${docId}/source`)).json()).version, { timeout: 30_000 }).toBeGreaterThan(before.version);
  const after = await (await api.get(`/api/v1/documents/${docId}/source`)).json();
  expect(after.html).toContain(`מעל 6 מגה ${stamp}`);

  /* 3. suggestions arrive with affects --------------------------------------- */
  const doc = await (await api.get(`/api/v1/documents/${docId}`)).json();
  await expect.poll(async () => {
    const r = await (await api.get(`/api/v1/suggestions?sourceId=${doc.sourceId}&status=pending`)).json();
    return r.items?.length ?? 0;
  }, { timeout: 120_000 }).toBeGreaterThan(0);
  const pending = (await (await api.get(`/api/v1/suggestions?sourceId=${doc.sourceId}&status=pending`)).json()).items;
  const withAffects = pending.find((s: { affects: unknown[] }) => (s.affects ?? []).length > 0) ?? pending[0];
  expect(Array.isArray(withAffects.affects)).toBeTruthy();
  await expect(e.getByRole('complementary', { name: 'הצעות לכרטיסים' }).getByText(/משפיע על|ללא השפעה נוספת/).first()).toBeVisible();

  /* 4. structured edit + partial apply --------------------------------------- */
  const card = e.getByRole('article', { name: withAffects.title });
  await card.getByRole('button', { name: 'עריכה מובנית' }).click();
  const drawer = e.getByRole('dialog', { name: /עריכת הצעה/ });
  const firstRow = drawer.getByRole('textbox').first();
  await firstRow.fill(`${await firstRow.inputValue()} (${stamp})`);
  await drawer.getByRole('button', { name: 'שמור' }).click();
  await card.getByRole('checkbox').first().check();
  await card.getByRole('button', { name: 'החל נבחרים' }).click();
  await expect.poll(async () => (await (await api.get(`/api/v1/suggestions/${withAffects.id}`)).json()).status, { timeout: 30_000 }).toMatch(/accepted|applied/);
  const detail = await (await api.get(`/api/v1/suggestions/${withAffects.id}`)).json();
  expect(detail.editDiff?.rows?.length ?? 0).toBeGreaterThan(0);
  expect(detail.appliedParts?.length ?? 0).toBeGreaterThan(0);

  /* 5. analytics reflects one edited-accept ----------------------------------- */
  const an = await (await api.get(`/api/v1/suggestions/analytics?sourceId=${doc.sourceId}`)).json();
  expect(an.rates.edited).toBeGreaterThan(0);

  /* 6. the conversation is persisted with the tool call ------------------------ */
  const convs = await (await api.get(`/api/v1/admin/ai/conversations?documentId=${docId}`)).json();
  expect(convs.items.length).toBeGreaterThan(0);
  const c = await (await api.get(`/api/v1/ai/conversations/${convs.items[0].id}`)).json();
  expect(c.messages.some((m: { toolCalls?: { name: string }[] }) => m.toolCalls?.some((t) => t.name === 'propose_source_edit'))).toBeTruthy();
});
```
Locator names (`'עוזר'`, `'שינויים מוצעים'`, `'קבל'`, `'עריכה מובנית'`, `'החל נבחרים'`) are X4a's; take them from the merge-log import table. Every assertion is a durable post-condition (source version, suggestion status, analytics rate, persisted transcript), not a toast.
- [ ] **Step 2: Add the env line** in `scripts/e2e-real.mjs` after `MODEL_DISABLED: 'true',`: `AI_TEST_SCRIPT: '1', // wave 6: deterministic chat for the copilot specs; refused under NODE_ENV=production`.
- [ ] **Step 3: Run** — `E2E_PG_PORT=55535 E2E_API_PORT=3212 E2E_WEB_PORT=4282 pnpm e2e:real -- --grep W6-E2E-1` until green; a failure on a real defect gets the smallest fix in the owning lane's directory, logged.
- [ ] **Step 4: Commit** — `test(e2e): W6-E2E-1 workspace copilot loop`.

---

### Task 9: Real e2e — W6-E2E-2 article Q&A, refused write, transcript export; full suite

**Files:**
- Create: `apps/web/e2e/real/article-ask.spec.ts`

- [ ] **Step 1: Write the spec**
```ts
test('W6-E2E-2 an agent asks and gets a cited answer, cannot make the assistant write, and the admin exports transcripts', async ({ browser, page, baseURL }) => {
  test.setTimeout(180_000);
  const api = await adminApi(page, baseURL!); opened.apis.push(api);
  const agent = await createUser(api, 'agent'); // ai.ask only
  const a = await signInAs(browser, agent, baseURL!); opened.pages.push(a);
  await a.goto('/library'); await a.getByRole('link', { name: DOC_TITLE }).first().click();
  await a.getByRole('button', { name: /שאל את המערכת/ }).click();
  const pane = a.getByRole('region', { name: 'שאל את המערכת' });
  await pane.getByRole('textbox').fill('מה השלב הראשון?');
  await pane.getByRole('button', { name: 'שלח' }).click();
  await expect(pane.getByText(/שלב 1/)).toBeVisible({ timeout: 60_000 }); // the scripted answer cites step 1 via read_document
  await pane.getByRole('textbox').fill('שנה את המסמך: מחק את השלב הראשון');
  await pane.getByRole('button', { name: 'שלח' }).click();
  await expect(pane.getByText('אין לי הרשאה לשנות תוכן')).toBeVisible({ timeout: 60_000 });
  // durable: no proposed edits, no source version, from an agent's conversation
  const docId = /\/doc\/([0-9a-f-]+)/.exec(a.url())![1];
  const convs = await (await api.get(`/api/v1/admin/ai/conversations?documentId=${docId}&kind=article`)).json();
  const c = await (await api.get(`/api/v1/ai/conversations/${convs.items[0].id}`)).json();
  expect(c.messages.some((m: { toolCalls?: { name: string }[] }) => m.toolCalls?.some((t) => t.name === 'propose_source_edit'))).toBeFalsy();
  // feedback + export
  const last = c.messages.filter((m: { role: string }) => m.role === 'assistant').at(-1);
  expect((await api.post(`/api/v1/ai/messages/${last.id}/feedback`, { data: { rating: 'down', note: 'לא עזר' } })).ok()).toBeTruthy();
  const exp = await api.get('/api/v1/admin/ai/conversations/export.jsonl');
  expect(exp.ok()).toBeTruthy();
  const lines = (await exp.text()).trim().split('\n');
  expect(lines.some((l) => l.includes(convs.items[0].id))).toBeTruthy();
  // an agent cannot open the workspace
  await a.goto(`/workspace/${docId}`);
  await expect(a.getByText(/אין הרשאה|לא זמין/)).toBeVisible();
});
```
- [ ] **Step 2: Run the two new specs, then the full suite twice** (with the ports above): `pnpm e2e:real`, then `E2E_OIDC=1 E2E_OIDC_PORT=9412 pnpm e2e:real`. Both must be green; record counts.
- [ ] **Step 3: Commit** — `test(e2e): W6-E2E-2 article Q&A, refused write tool, transcript export`.

---

### Task 10: Merge main, compose gate, final gate, acceptance matrix, ledger

**Files:**
- Modify: `docs/wave6-acceptance.md` (complete), `docs/wave6-merge-log.md`, `docs/superpowers/plans/README.md` (X6 row status), `.superpowers/sdd/program/progress.md`

- [ ] **Step 1: `git merge main`** (main may have moved; the other session reserves nothing below 0055 and does not touch wave 6 files). Resolve append-only files as in Task 1; regenerate OpenAPI. Confirm `ls apps/api/migrations | tail` ends `…0049_wave5_seams.js 0050_wave6_ai_settings.js 0051_… 0052_… 0053_… 0054_wave6_seams.js` and nothing ≥ 0055.
- [ ] **Step 2: Compose gate** — `pnpm e2e:compose` (X1 changed `ollama-pull.sh`, `ollama-pull-check.sh`, `smoke.sh` `embed_check`, `deploy/e2e.env`/`ci.env` for two slots + `bge-m3`; the gate asserts both tags literally and `EMBED_DIMENSION` matches the rebuilt column). Host ports 8443–8446 must be free. If it is red on a wave-6 change, fix in `deploy/` or `scripts/` (allowed for X6) and log.
- [ ] **Step 3: Final gate** — Task 1 Step 3's list on the merged head, plus both `e2e:real` variants (Task 9) and `pnpm --filter @wecom/api perf:check`.
- [ ] **Step 4: Acceptance matrix** — `docs/wave6-acceptance.md` gets a table `spec §1 decision | lanes | evidence (test file / e2e stage)` for all ten decisions, the eval table (Task 7), the gate table, and a **Parked** table (each row: item, ruling, cost if wrong) seeded from the lanes' reports plus anything X6 deferred.
- [ ] **Step 5: Ledger and hand-off** — `echo "Wave 6 X6 complete: wave6/integration @ $(git rev-parse --short HEAD) — gates green (int N, web N, e2e:real N/N, OIDC N/N, compose N/N); eval tier1 hit-target X vs tier0 Y" >> .superpowers/sdd/program/progress.md`; write `.superpowers/sdd/program/X6-report.md`; reply with status, head SHA, one line per gate, concerns.

---

## Parked (candidates; confirm or strike in Task 10)

| Item | Ruling | Cost if wrong |
|---|---|---|
| Chat quality is proven by the scripted client in e2e, by the eval harness on the VM otherwise | Real inference in the gate would make it flaky and slow; the orchestrator, tools and persistence are the same code | A prompt regression is caught by the eval run, not by CI |
| Tier presets name tags that must be re-verified whenever Ollama's library changes | `POST /admin/ai/models/test` is the runtime check | A renamed tag shows as "not reachable" on `/admin/ai` until the preset is edited |
| Interactive chat latency on the 4 vCPU / 16 GB VM at tier 1 | streaming + tens of seconds is acceptable for editors; agents' article Q&A shows a "עדיין חושב…" state | daily agent use needs tier 4 (GPU) — spec §6 |

## Self-review

- Spec coverage: §1.1/1.2 (tiers, slots, embedder) → Tasks 1, 7, 10; §1.3 (proposed edits only) → Task 8 stage 2, Task 9 refused write; §1.4 (three surfaces) → Tasks 3, 4, and X4a's workspace via Task 8; §1.5 (persistence + export) → Task 9; §1.6 (impact/affects) → Tasks 6, 8; §1.7 (brief, versions) → X1/X4b, evidenced in Task 10's matrix via their tests; §1.8 (structured editing, partial apply) → Tasks 5, 8; §1.9 (eval + analytics) → Tasks 7, 8; §1.10 (embedding mapping) → X1 tests, listed in the matrix.
- Placeholders: none; where a lane's exact export name is unknown the task names the fallback and the merge-log table is the single source.
- Type consistency: `ImpactPort { impactFor, affectsFor }`, `AI_TEST_SCRIPT`, `keys.ai.conversation(id)`, `ChatEventSchema` event names and the tool names match the X0 canonical table and the X2 requirement stated above.
