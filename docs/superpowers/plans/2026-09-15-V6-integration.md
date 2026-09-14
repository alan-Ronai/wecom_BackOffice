# V6 — Wave 5 Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge lanes V1–V4b onto one branch, perform the mounts the lanes were forbidden to make (shell, article, editor, review queue, identity settings, notifications, SSE), close the cross-lane seams (learning tracking → learning content, web hooks → generated client), land the three wave-4 follow-ups from the whole-program acceptance review (F-4, A-4, E-1), prove the PRD future-phase flows end to end against the real stack, and hand a green `wave5/integration` to the controller for the final merge into `main`.

**Architecture:** Same pattern as W6 (`2026-09-14-W6-integration.md`): an integration branch, lanes merged in dependency order with append-only conflict rules, a verified import table before any mount, mounts as minimal edits at named anchors in the six files no lane could touch, seams as small explicit commits, then Playwright against Postgres + API + built SPA. Every merge and every task ends with the same gate.

**Tech Stack:** pnpm workspaces, TypeScript strict, Fastify 5 + pg, React 18 + React Router + TanStack Query + generated `openapi-fetch` client, Vitest + MSW, Playwright (`scripts/e2e-real.mjs`), node-pg-migrate.

**Spec:** `docs/superpowers/specs/2026-09-15-kb-wave5-learning-design.md` (§2 V6 row, §5 behaviour, §6 isolation & merge, §7 testing & acceptance). Contract: `docs/api/CONTRACTS-wave5.md` (written by V0). Reference for the follow-ups: `.superpowers/sdd/program/acceptance-review.md` items F-4, A-4, E-1.

## Global Constraints

- Node `>=22`, pnpm `>=9`, TypeScript `strict: true`; run from the repo root with `pnpm --filter <pkg> <script>`; web tests with `--minWorkers=1 --maxWorkers=4` (bare `--maxWorkers=4` aborts on this vitest).
- All work on branch `wave5/integration`, created from `main` in this worktree. Never commit to `main`; the controller merges.
- Migrations: wave 5 owns exactly `0038`–`0042` (V0 0038, V1 0039, V2 0040, V3 0041, V6 0042 only if Task 6 needs schema). `0037` belongs to the wave-3 session's cleanup lane and **must be on `main` and merged into this branch before the final gate**; nothing above 0042 may exist.
- Append-only shared files (both sides kept on conflict): `apps/api/src/modules/index.ts`, `apps/web/src/routes.tsx` (lazy style: `split(Component)`), `packages/shared/src/events.ts`, `packages/shared/src/permissions.ts`, `apps/api/src/plugins/boss.ts`, `apps/web/src/api/keys.ts`, `apps/web/test/msw/handlers.ts`. `docs/api/openapi.json` and `apps/web/src/api/schema.d.ts` are never hand-merged — regenerate with `pnpm openapi`.
- Concurrent `e2e:real` runs collide on the Postgres container and ports: always run with `E2E_PG_PORT=55532 E2E_API_PORT=3201 E2E_WEB_PORT=4274 pnpm e2e:real` (main derives the container name from `E2E_PG_PORT`).
- Hebrew UI copy, English identifiers; conventional commits ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Facts about `main` at planning time (2026-09-15, HEAD 9f42ac3)

- Wave 4 is merged (f898b28); the notifications kind check already includes `feedback`/`source` (0026) and V0's 0038 widens it to `learning`/`gap`. `NotificationList.tsx:18-27` keeps an `ICON` map that is `Record<Notification['kind'], string>` — **exhaustive**, so V0's two new kinds make the web typecheck fail until Task 5 adds the two entries.
- `apps/web/src/api/events.ts:72-111` is an if/else chain by event name prefix; the four wave-5 events (`learning.assigned`, `learning.completed`, `learning.refresh_required`, `gap.detected`) fall through and invalidate nothing until Task 5.
- `EditorPage.tsx:139-184` `PublishBody` owns the publish dialog state (`label`, `ids`) and reports upward through callbacks into a `box`; the publish call at `:507-512` spreads `resolveFeedbackIds`. The `significantChange` checkbox goes in the same place, the same way.
- `ReviewsPage.tsx:103-124` `onDecide` awaits `decide.mutateAsync` with no catch; a 403 `APPROVER_REQUIRED` would today surface as an unhandled rejection and no message.
- `IdentityPage.tsx:190-345` is three `<section className="settings-card">` blocks (OIDC, Palo Alto, מושבים); the workflow section is a fourth, mounted after מושבים.
- `Sidebar.tsx:245-264`: nav built with `item(label, to, count?, badge?)`; the "נתונים" section is where wave 4 put `/feedback` and `/analytics`.
- `ArticlePage.tsx:395-410` header `meta` chips; `:458-466` `workOrSource` wraps the pane body with the `source-review-strip` for editors — the refresh banner mounts inside the same wrapper for the learner.
- `documents/repo.ts:780-790` `publishDocument`: `humanPublish` clears `source_review_needed/reason/at` unconditionally. The wave-3 route `GET /documents/:id/sync-state` and its schema `DocumentSyncStateSchema` (`stage45.ts:732-737`) exist as a contract; the route implementation lands with the wave-3 session's "pilot blockers" lane. `connectors/repo.ts:133` `linksForDocument(documentId): Promise<SyncLinkRow[]>` already answers the question locally (`state in ('synced','pending_import','pending_push','conflict')`, `0008_connectors.js:34`).
- `FeedbackButton.tsx:73` renders `` `סוג ${docType}` `` — the raw letter (A-4).
- `wordpress-source.spec.ts:145-152` polls the connector 10 × 1.5 s = 15 s (F-4 says it fails 3/3 under load).
- `apps/web/e2e/real/helpers/users.ts` provides `adminApi`, `createUser(request, 'agent'|'editor'|'lead')`, `signInAs`; V6 adds `'approver'` to the union.

## File structure

```
docs/wave5-merge-log.md                                  (new) branch inventory, conflicts, verified import table
docs/wave5-acceptance.md                                 (new) PRD future-phase bullet → test matrix + parked
apps/web/src/components/shell/Sidebar.tsx               (modify) three nav entries + badge from GET /learning/my
apps/web/src/components/article/ArticlePage.tsx         (modify) RefreshBanner in workOrSource; LearningBadge chip
apps/web/src/components/article/Panel.tsx               (modify) "פריטי למידה" block from GET /documents/:id/learning
apps/web/src/components/editor/EditorPage.tsx           (modify) significantChange checkbox in PublishBody; changeFlag toast
apps/web/src/components/review/ReviewsPage.tsx          (modify) APPROVER_REQUIRED handling + hint
apps/web/src/components/admin/IdentityPage.tsx          (modify) mounts WorkflowSettingsSection
apps/web/src/components/notifications/NotificationList.tsx (modify) ICON/TABS for learning, gap
apps/web/src/api/events.ts                              (modify) invalidation for the four wave-5 events
apps/web/src/api/hooks/*.ts (V4a/V4b files)             (modify) fetch bridges → generated client
apps/web/src/components/feedback/FeedbackButton.tsx     (modify) A-4 label
apps/web/e2e/real/wordpress-source.spec.ts              (modify) F-4 expect.poll
apps/web/e2e/real/helpers/users.ts                      (modify) 'approver' role
apps/web/e2e/real/learning-loop.spec.ts                 (new) W5-E2E-1
apps/web/e2e/real/approver-gate.spec.ts                 (new) W5-E2E-2
apps/api/src/modules/documents/repo.ts                  (modify) E-1: keep the flag when a sync link is pending/conflict
apps/api/src/modules/documents/syncState.ts             (new, only if the wave-3 route is not yet on main) documentSyncState(q, id)
apps/api/src/modules/learning/tracking/itemsPort.ts     (modify) point at V1's repo
apps/api/test/int/wave5-seams.test.ts                   (new) E-1, seams
apps/api/migrations/0042_wave5_fixups.js                (new, only if a seam needs schema)
apps/web/test/integration/wave5-mounts.test.tsx         (new) one describe per mount
```

## Names consumed from other lanes (verified in Task 1; adapt imports there, never re-implement)

| Lane | Import | Path assumed |
|---|---|---|
| V0 | permissions `learning.read/manage/publish`, `gaps.read/manage`; events; `QUEUES.learning*`, `QUEUES.gapsDetect`; `getWorkflowSettings(q)` | `@wecom/shared`, `apps/api/src/plugins/boss.ts`, `apps/api/src/lib/workflowSettings.ts` |
| V1 | module `learning` (`apps/api/src/modules/learning/index.ts`, `repo.ts` exporting `getItem(q, id)`, `listItems`, `publishItem`, `itemSnapshot`), routes per contract | `apps/api/src/modules/learning/*` |
| V2 | `apps/api/src/modules/learning/tracking/*`: `itemsPort.ts` (`ItemsPort` interface with `getPublished(itemId)`, `itemsReferencing(documentId)`), `detectSignificantChange(before, after, blocks): { significant, reasons }`, `applyChangeFlag(tx, documentId, version, flag, actorId)`, the publish-route hunk that reads `body.significantChange` and returns `changeFlag`; optional `GET /documents/:id/change-preview` | `apps/api/src/modules/learning/tracking/*`, `documents/routes.ts` |
| V3 | `apps/api/src/modules/gaps/*`, `apps/api/src/modules/admin/workflow.ts` (`GET/PUT /admin/workflow`), approver gate in `collab/reviews.ts` (403 `APPROVER_REQUIRED`) | as named |
| V4a | `MyLearningPage`, `BriefingReader`, `QuizPlayer`, `RefreshBanner({ documentId })`, `LearningBadge({ documentId })`; hooks `useMyLearning()`, `useDocumentLearning(id)`; keys `keys.learning.my`, `keys.learning.doc(id)` | `apps/web/src/components/learning/*.tsx`, `apps/web/src/api/hooks/learning.ts` |
| V4b | `LearningManagePage`, `LearningItemEditor`, `AssignDialog`, `CompletionDashboard`, `GapsPage`, `WorkflowSettingsSection`; hooks `useWorkflowSettings()`, `useGaps()`, `useChangePreview(id)` (if V2 ships the route) | `apps/web/src/components/learning/manage/*.tsx`, `apps/web/src/components/gaps/*.tsx`, `apps/web/src/api/hooks/{learningManage,gaps,workflow}.ts` |
| wave 3 | `DocumentSyncStateSchema` (`stage45.ts:732`), `ConnectorsRepo.linksForDocument` (`connectors/repo.ts:133`) | for E-1 |

---

### Task 1: Inventory and merge playbook

**Files:**
- Create: `docs/wave5-merge-log.md`
- Modify: `.superpowers/sdd/program/progress.md` (git-ignored ledger; append, never commit)

**Interfaces:**
- Consumes: lane branches V1–V4b (`git branch -a --list 'worktree-agent-*' --list 'fix/*' --list 'wave5/*'`), `main` (with 0037 once the cleanup lane lands).
- Produces: `wave5/integration` with every lane merged, a verified import table, a green baseline.

- [ ] **Step 1: Create the branch and record the inventory**

```bash
git checkout -b wave5/integration main
git branch -a --format='%(refname:short) %(objectname:short) %(subject)' | grep -E 'worktree-agent|wave5|lane/v' | tee docs/wave5-merge-log.md
```
Identify lanes by their first commit subjects (`feat(learning)`, `feat(learning-tracking)`, `feat(gaps)`/`feat(approver)`, `feat(web): learning …`, `feat(web): learning manage …`). Write the table `Lane | branch | head | report path` (reports live at `.claude/worktrees/agent-<id>/.superpowers/sdd/program/V*-report.md`).

- [ ] **Step 2: Merge in this order, one at a time** — V1 → V2 → V3 → V4a → V4b.

```bash
git merge --no-ff <branch> -m "Merge wave 5 lane <Vn>: <one-line scope>"
```
Conflict rules (keep both sides, wave 4 entries before wave 5, alphabetical within a wave): `apps/api/src/modules/index.ts` (imports + list entries), `apps/web/src/routes.tsx` (route objects, `*` last, lazy `split(...)` form for every wave 5 route), `packages/shared/src/events.ts` + `events.test.ts` order, `packages/shared/src/permissions.ts` + test, `apps/api/src/plugins/boss.ts` `QUEUES`, `apps/web/src/api/keys.ts`, `apps/web/test/msw/handlers.ts` (if two lanes stub the same path keep the one matching `CONTRACTS-wave5.md`). `documents/routes.ts`: V2's publish hunk is the only wave-5 edit there — merge by function and run `apps/api/test/documents.test.ts`. Any other conflict is a seam: resolve for the contract, log it, and if behaviour changed add a test in Task 6.

- [ ] **Step 3: Gate after every merge**

```bash
pnpm install --frozen-lockfile || pnpm install
pnpm -r build && pnpm typecheck
pnpm --filter @wecom/shared test && pnpm --filter @wecom/connectors test && pnpm --filter @wecom/model test
pnpm --filter @wecom/api test && RUN_INTEGRATION=1 pnpm --filter @wecom/api test:int
pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4
pnpm openapi && git diff --exit-code docs/api/openapi.json apps/web/src/api/schema.d.ts || { git add docs/api/openapi.json apps/web/src/api/schema.d.ts && git commit -m "chore(contract): regenerate OpenAPI after merging <Vn>"; }
pnpm lint
echo "V6: merged <Vn> (<sha>) — gate green" >> .superpowers/sdd/program/progress.md
```
Known load flakes (re-run in isolation before calling red): `apps/api/test/boss.test.ts`, `apps/api/test/sources/routes.test.ts`, web `editor/*`, `admin/Identity`. A genuine red blocks the next merge: fix on the branch in the smallest commit `fix(<lane>): …` and log it.

- [ ] **Step 4: Verify the import table**

```bash
for f in apps/api/src/modules/learning/index.ts apps/api/src/modules/learning/repo.ts apps/api/src/modules/learning/tracking/itemsPort.ts apps/api/src/modules/learning/tracking/significantChange.ts apps/api/src/modules/gaps/index.ts apps/api/src/modules/admin/workflow.ts apps/web/src/api/hooks/learning.ts apps/web/src/components/learning/MyLearningPage.tsx apps/web/src/components/learning/BriefingReader.tsx apps/web/src/components/learning/QuizPlayer.tsx apps/web/src/components/learning/RefreshBanner.tsx apps/web/src/components/learning/LearningBadge.tsx apps/web/src/components/learning/manage/LearningManagePage.tsx apps/web/src/components/learning/manage/LearningItemEditor.tsx apps/web/src/components/learning/manage/AssignDialog.tsx apps/web/src/components/learning/manage/CompletionDashboard.tsx apps/web/src/components/gaps/GapsPage.tsx apps/web/src/components/admin/WorkflowSettingsSection.tsx; do [ -f "$f" ] && echo "ok   $f" || echo "MISS $f"; done
grep -rn "export \(function\|const\|class\|interface\) \(detectSignificantChange\|applyChangeFlag\|ItemsPort\|documentSyncState\|useMyLearning\|useDocumentLearning\|useWorkflowSettings\|useGaps\|useChangePreview\|RefreshBanner\|LearningBadge\|WorkflowSettingsSection\)" apps/api/src apps/web/src | sort
grep -rn "APPROVER_REQUIRED" apps/api/src apps/web/src | head
```
Write the real names into `docs/wave5-merge-log.md`; every later task imports from that table. A component that does not exist is a lane defect: implement it in the lane's directory in the smallest form that satisfies its brief, with a unit test, commit `fix(<lane>): add missing <Component>`, log it.

- [ ] **Step 5: Commit the baseline**

```bash
git add docs/wave5-merge-log.md && git commit -m "docs(v6): wave 5 merge log and verified import table"
echo "V6: baseline $(git rev-parse --short HEAD) — V1–V4b merged, green" >> .superpowers/sdd/program/progress.md
```

---

### Task 2: Shell mounts — learning, manage, gaps entries with a badge

**Files:**
- Modify: `apps/web/src/components/shell/Sidebar.tsx`
- Test: `apps/web/test/integration/wave5-mounts.test.tsx` (create; `describe('shell')`)

**Interfaces:**
- Consumes: `useMyLearning()` → `MyLearningResponse` with `open`, `overdue`, `completed` arrays (V4a); `item(label, to, count?, badge?)` at `Sidebar.tsx:126`.
- Produces: entries `למידה` (`/learning`, `learning.read`, badge = open + overdue), `ניהול למידה` (`/learning/manage`, `learning.manage`), `פערי ידע` (`/gaps`, `gaps.read`).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/test/integration/wave5-mounts.test.tsx
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderApp } from '../render.js';
import { server, http, HttpResponse } from '../msw/server.js';
import { API } from '../msw/handlers.js';

describe('wave 5 mounts — shell', () => {
  it('shows learning, manage and gaps entries to a lead with a badge of open assignments', async () => {
    server.use(http.get(`${API}/learning/my`, () => HttpResponse.json({ open: [{ id: 'a1' }, { id: 'a2' }], overdue: [{ id: 'a3' }], completed: [] })));
    renderApp('/library', { permissions: ['docs.read', 'learning.read', 'learning.manage', 'gaps.read'] });
    const nav = await screen.findByRole('navigation', { name: 'למידה' });
    expect(within(nav).getByRole('link', { name: /למידה/ })).toBeInTheDocument();
    expect(await within(nav).findByText('3')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'ניהול למידה' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'פערי ידע' })).toBeInTheDocument();
  });
  it('hides manage and gaps from an agent and shows no badge without assignments', async () => {
    server.use(http.get(`${API}/learning/my`, () => HttpResponse.json({ open: [], overdue: [], completed: [] })));
    renderApp('/library', { permissions: ['docs.read', 'learning.read'] });
    const nav = await screen.findByRole('navigation', { name: 'למידה' });
    expect(within(nav).queryByRole('link', { name: 'ניהול למידה' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'פערי ידע' })).toBeNull();
  });
});
```
Adapt `renderApp`'s options and the `API`/`server` exports to what `apps/web/test/render.tsx` and `apps/web/test/msw/*` actually export (read them; `wave4-mounts.test.tsx` shows the working incantation).

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4 wave5-mounts` → FAIL (no navigation named למידה).

- [ ] **Step 3: Implement** — in `Sidebar.tsx`, next to the feedback query (`:86-90`):
```tsx
  const mayLearn = can('learning.read');
  // Fetched only for its counts; the badge is what the agent still owes, not history.
  const myLearning = useMyLearning({ enabled: mayLearn });
  const dueLearning = mayLearn ? (myLearning.data?.open.length ?? 0) + (myLearning.data?.overdue.length ?? 0) : 0;
```
and after the "נתונים" `</nav>` (`:264`):
```tsx
        {mayLearn || can('learning.manage') || can('gaps.read') ? (
          <>
            <div className="sec-title">למידה</div>
            <nav aria-label="למידה">
              {mayLearn ? item('למידה', '/learning', dueLearning || null, true) : null}
              {can('learning.manage') ? item('ניהול למידה', '/learning/manage') : null}
              {can('gaps.read') ? item('פערי ידע', '/gaps') : null}
            </nav>
          </>
        ) : null}
```
Import `useMyLearning` from V4a's hook file; if its signature has no `{ enabled }` option, add one there (additive) rather than fetching for users without the permission.

- [ ] **Step 4: Run** — the two tests PASS; `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4 shell` still green.
- [ ] **Step 5: Commit** — `feat(web): mount learning, manage and gaps in the sidebar with the due badge`

---

### Task 3: Article mounts — refresh banner, learning badge, learning block in the panel

**Files:**
- Modify: `apps/web/src/components/article/ArticlePage.tsx`, `apps/web/src/components/article/Panel.tsx`
- Test: `apps/web/test/integration/wave5-mounts.test.tsx` (`describe('article')`)

**Interfaces:**
- Consumes: `useDocumentLearning(id)` → `DocumentLearning` (`items: { itemId, kind, title, status }[]`, `refresh: { required: boolean, assignmentId: string | null, dueAt: string | null }` — verify the exact shape in `wave5.ts:269-275`), `RefreshBanner({ documentId })`, `LearningBadge({ documentId })`.
- Produces: banner above the pane body for the signed-in learner when a refresh assignment is open; a chip "בתדריך/בשאלון" in the header meta; a "פריטי למידה" list in the panel.

- [ ] **Step 1: Failing tests**

```tsx
describe('wave 5 mounts — article', () => {
  it('shows the refresh banner and a learning chip when the reader owes a refresh', async () => {
    server.use(http.get(`${API}/documents/:id/learning`, () => HttpResponse.json({
      items: [{ itemId: 'li1', kind: 'quiz', title: 'שאלון גלישה', status: 'published' }],
      refresh: { required: true, assignmentId: 'as1', dueAt: '2026-10-01T00:00:00.000Z' },
    })));
    renderApp(`/doc/${fx.docId}`, { permissions: ['docs.read', 'learning.read'] });
    expect(await screen.findByRole('status', { name: 'רענון ידע נדרש' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /לרענון/ })).toHaveAttribute('href', '/learning/as1');
    expect(screen.getByText('בשאלון')).toBeInTheDocument();
  });
  it('renders nothing extra when no learning item references the document', async () => {
    server.use(http.get(`${API}/documents/:id/learning`, () => HttpResponse.json({ items: [], refresh: { required: false, assignmentId: null, dueAt: null } })));
    renderApp(`/doc/${fx.docId}`, { permissions: ['docs.read', 'learning.read'] });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('status', { name: 'רענון ידע נדרש' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`ArticlePage.tsx` — imports after `:44`:
```tsx
import { RefreshBanner } from '../learning/RefreshBanner.js';
import { LearningBadge } from '../learning/LearningBadge.js';
```
In the `workOrSource` wrapper (`:458-466`), before `{paneBody}`:
```tsx
      {can('learning.read') ? <RefreshBanner documentId={doc.id} /> : null}
```
In the header `meta` (`:397`, after the `TypeBadge`):
```tsx
          {can('learning.read') ? <LearningBadge documentId={doc.id} /> : null}
```
`RefreshBanner` must render `<div role="status" aria-label="רענון ידע נדרש">` with a `<Link to={`/learning/${assignmentId}`}>לרענון</Link>` and nothing when `refresh.required` is false; `LearningBadge` renders one chip `בתדריך` / `בשאלון` / `בתדריך ובשאלון` from `items[].kind`, nothing when empty. If V4a's components differ, adapt the assertions to their real copy and record the copy in the merge log.

`Panel.tsx` — add a block after the connections/related section (read the file for the section markup it uses):
```tsx
{learning.data?.items.length ? (
  <section className="panel-sec" aria-label="פריטי למידה">
    <h4>פריטי למידה</h4>
    <ul>
      {learning.data.items.map((it) => (
        <li key={it.itemId}><Link to={can('learning.manage') ? `/learning/manage/${it.itemId}` : '/learning'}>{it.kind === 'quiz' ? 'שאלון' : 'תדריך'} · {it.title}</Link></li>
      ))}
    </ul>
  </section>
) : null}
```
with `const learning = useDocumentLearning(doc.id, { enabled: can('learning.read') })`.

- [ ] **Step 4: Run** — tests PASS; `apps/web/test/article/*` green.
- [ ] **Step 5: Commit** — `feat(web): article shows the refresh banner, learning chip and learning items`

---

### Task 4: Editor, review queue and identity mounts

**Files:**
- Modify: `apps/web/src/components/editor/EditorPage.tsx`, `apps/web/src/components/review/ReviewsPage.tsx`, `apps/web/src/components/admin/IdentityPage.tsx`, `apps/web/src/api/hooks/collab.ts` (only if the error code is not surfaced)
- Test: `apps/web/test/integration/wave5-mounts.test.tsx` (`describe('editor')`, `describe('reviews')`, `describe('identity')`)

**Interfaces:**
- Consumes: `PublishBody` (`EditorPage.tsx:139-184`), `box` at `:428-440`, publish call `:507-512`; `useReviewDecision` (`collab.ts:156`); `WorkflowSettingsSection` (V4b); `useChangePreview(id)` if V2 exposes `GET /documents/:id/change-preview` — **decision:** if the route exists, pre-tick from it; otherwise pre-tick when the last saved structure differs from the published one in any outcome/branch (compute client-side from `diffSteps` in `apps/web/src/lib/diffSteps.ts`, categories `outcome`/`branch`), and record which path was taken in the merge log.
- Produces: checkbox `שינוי מהותי – דרוש רענון` in the publish dialog wired to `significantChange`; toast from `changeFlag`; APPROVER_REQUIRED message and an "אישור דורש תפקיד מאשר" hint on the review row; a fourth settings card on `/admin/identity`.

- [ ] **Step 1: Failing tests**

```tsx
describe('wave 5 mounts — editor', () => {
  it('sends significantChange from the publish dialog and toasts the change flag', async () => {
    let sent: unknown;
    server.use(http.post(`${API}/documents/:id/publish`, async ({ request }) => {
      sent = await request.json();
      return HttpResponse.json({ document: fx.doc, version: 4, auditId: 'a', changeFlag: { significant: true, reasons: ['outcome'], affectedItems: 2, refreshAssignments: 5 } });
    }));
    const { user } = renderApp(`/edit/${fx.docId}`, { permissions: ['docs.read', 'docs.edit', 'docs.publish', 'docs.read_unpublished'] });
    await user.click(await screen.findByRole('button', { name: /פרסם/ }));
    const dlg = await screen.findByRole('dialog', { name: /פרסום/ });
    await user.click(within(dlg).getByRole('checkbox', { name: 'שינוי מהותי – דרוש רענון' }));
    await user.click(within(dlg).getByRole('button', { name: 'אישור' }));
    await waitFor(() => expect((sent as { significantChange?: boolean }).significantChange).toBe(true));
    expect(await screen.findByText(/5 רענונים נוצרו/)).toBeInTheDocument();
  });
});
describe('wave 5 mounts — reviews', () => {
  it('explains APPROVER_REQUIRED instead of failing silently', async () => {
    server.use(http.post(`${API}/documents/:id/review-decision`, () => HttpResponse.json({ code: 'APPROVER_REQUIRED', message: 'נדרש תפקיד מאשר' }, { status: 403 })));
    const { user } = renderApp('/reviews', { permissions: ['docs.read', 'docs.publish', 'docs.read_unpublished'] });
    await user.click(await screen.findByRole('button', { name: /אשר/ }));
    // the prompt dialog
    await user.click(await screen.findByRole('button', { name: 'אישור' }));
    expect(await screen.findByText(/נדרש תפקיד מאשר/)).toBeInTheDocument();
  });
});
describe('wave 5 mounts — identity', () => {
  it('shows the workflow settings card', async () => {
    renderApp('/admin/identity', { permissions: ['system.admin', 'docs.read'] });
    expect(await screen.findByRole('heading', { name: 'תהליך אישור ולמידה' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'דרוש תפקיד מאשר לפרסום מסקירה' })).toBeInTheDocument();
  });
});
```
(Use the existing MSW fixtures' document id and the reviews fixture; if `/reviews` needs an open row, seed it through the wave-3 handlers.)

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`EditorPage.tsx` — `PublishBody` gains `defaultSignificant: boolean` and `onSignificant: (v: boolean) => void`; state `const [significant, setSignificant] = useState(defaultSignificant)`; effect reporting it; markup after the label input:
```tsx
      <label className="check-row">
        <input type="checkbox" checked={significant} onChange={(e) => setSignificant(e.target.checked)} aria-label="שינוי מהותי – דרוש רענון" />
        שינוי מהותי – דרוש רענון
        <span className="small muted">מבטל השלמות של תדריכים ושאלונים שמבוססים על המסמך ויוצר משימות רענון</span>
      </label>
```
`box` gains `significant: boolean` (default from `useChangePreview(id).data?.significant ?? false`, or the client-side diff fallback); publish call spreads `...(box.significant ? { significantChange: true } : {})`; after publish:
```tsx
    const flag = result.changeFlag;
    toast(flag?.significant ? `פורסם v${result.version} · שינוי מהותי: ${flag.refreshAssignments} רענונים נוצרו` : `פורסם v${result.version} · הכרטיס בספרייה עודכן`, 'ok');
```
(the publish mutation must return the whole `PublishResponse`; read `usePublish` in `hooks/documents.ts` and widen its return if it only returns `{ version }`).

`ReviewsPage.tsx` — wrap both `decide.mutateAsync` calls:
```tsx
    try { … } catch (e) {
      if (e instanceof ApiError && e.code === 'APPROVER_REQUIRED') { toast('נדרש תפקיד מאשר כדי לאשר ולפרסם מסקירה', 'warn'); return; }
      throw e;
    }
```
and in `ReviewRowView`, when `me.roles` lacks `approver` and `useWorkflowSettings().data?.requireApprover` is true, render the approve button `disabled` with `title="אישור דורש תפקיד מאשר"` and a small hint under it. (`useMe` exposes `roles`; check `hooks/me.ts`.)

`IdentityPage.tsx` — after the מושבים section (`:345`):
```tsx
      <WorkflowSettingsSection />
```
(V4b's component owns its own `settings-card`, heading `תהליך אישור ולמידה`, the `requireApprover` checkbox labelled `דרוש תפקיד מאשר לפרסום מסקירה`, and the learning/gaps numeric fields.)

- [ ] **Step 4: Run** — the three describes PASS; `apps/web/test/editor/*`, `review/*`, `admin/Identity*` green.
- [ ] **Step 5: Commit** — `feat(web): publish dialog significant-change checkbox, approver gate messaging, workflow settings card`

---

### Task 5: Web seams — generated client, notifications, SSE invalidation

**Files:**
- Modify: `apps/web/src/api/hooks/learning.ts`, `learningManage.ts`, `gaps.ts`, `workflow.ts` (V4a/V4b names from the merge log), `apps/web/src/components/notifications/NotificationList.tsx`, `apps/web/src/api/events.ts`, `apps/web/src/api/keys.ts` (additive)
- Test: `apps/web/test/api/invalidation.test.tsx` (extend), `apps/web/test/notifications/*` (extend), `apps/web/test/api/hooks.test.tsx`

**Interfaces:**
- Consumes: regenerated `schema.d.ts` (after Task 1 the routes are in `openapi.json`), `keys.learning.*`, `keys.gaps`, `keys.workflow`.
- Produces: no `fetch`/`stageJson` bridge left in the wave-5 hooks; `ICON`/`TABS` for `learning` (🎓) and `gap` (🕳); invalidation for the four events.

- [ ] **Step 1: Failing tests** — in `invalidation.test.tsx` add cases: `learning.assigned` → invalidates `keys.learning.my` and `['learning']`; `learning.completed` → same plus `keys.learning.completion(itemId)`; `learning.refresh_required` → `keys.learning.my`, `keys.learning.doc(documentId)`, `keys.doc(documentId)`; `gap.detected` → `['gaps']`. In the notifications test: a notification of kind `learning` renders with its tab `למידה` and kind `gap` with `פערי ידע`. In `hooks.test.tsx`: `useMyLearning` calls `GET /learning/my` through the generated client (assert via MSW handler hit, and `grep -c "fetch(" apps/web/src/api/hooks/learning.ts` equals 0 — put that as a unit assertion reading the file with `fs` in a node-environment test, as `hooks.test.tsx` does for other bridges if such a check exists; otherwise a plain grep step below).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`events.ts` — add before the final `}`:
```ts
  } else if (ev.name.startsWith('learning.')) {
    void qc.invalidateQueries({ queryKey: ['learning'] });
    const p = ev.payload as { documentId?: string; itemId?: string };
    if (p.documentId) {
      void qc.invalidateQueries({ queryKey: keys.learning.doc(p.documentId) });
      void qc.invalidateQueries({ queryKey: keys.doc(p.documentId) });
    }
    if (p.itemId) void qc.invalidateQueries({ queryKey: keys.learning.completion(p.itemId) });
  } else if (ev.name === 'gap.detected') {
    void qc.invalidateQueries({ queryKey: ['gaps'] });
  }
```
(`keys.learning.*` must all start with `'learning'`; verify in `keys.ts` and fix V4a/V4b's keys if not — that is what makes the prefix invalidation work.)

`NotificationList.tsx` — `TABS` += `['learning', 'למידה'], ['gap', 'פערי ידע']`; `ICON` += `learning: '🎓', gap: '🕳'`.

Hooks: replace every `fetch(`/`stageJson(`/`checkedFetch(` in the four hook files with `api.GET/POST/PUT/PATCH/DELETE('<path>', …)` + `checked(Schema, …)`, keeping the zod schemas as the runtime validators exactly as the wave-4 hooks do (`hooks/feedback.ts` is the model). Then:
```bash
grep -n "fetch(\|stageJson\|stageVoid" apps/web/src/api/hooks/learning*.ts apps/web/src/api/hooks/gaps.ts apps/web/src/api/hooks/workflow.ts && echo "BRIDGE LEFT" || echo "clean"
```
Expected: `clean` (multipart uploads are the only allowed raw fetch and wave 5 has none).

- [ ] **Step 4: Run** — `pnpm --filter @wecom/web typecheck` clean (the exhaustive `ICON` map compiles again), tests PASS.
- [ ] **Step 5: Commit** — `feat(web): wave 5 hooks on the generated client; notifications and SSE for learning/gap events`

---

### Task 6: API seams — items port, publish flag path, E-1

**Files:**
- Modify: `apps/api/src/modules/learning/tracking/itemsPort.ts`, `apps/api/src/modules/documents/repo.ts` (`publishDocument`), `apps/api/src/modules/documents/routes.ts` (only if V2's hunk needs the flag result threaded)
- Create: `apps/api/src/modules/documents/syncState.ts` (only if `GET /documents/:id/sync-state`'s repo function is not on `main` yet), `apps/api/test/int/wave5-seams.test.ts`, `apps/api/migrations/0042_wave5_fixups.js` (only if needed)

**Interfaces:**
- Consumes: V1 `learning/repo.ts` (`getItem`, `itemsReferencing(documentId)` or equivalent), V2 `ItemsPort`, `ConnectorsRepo.linksForDocument(documentId)` (`connectors/repo.ts:133`), `DocumentSyncStateSchema` (`stage45.ts:732`).
- Produces: `documentSyncState(q, documentId): Promise<DocumentSyncState>` (exported; the wave-3 route may later import it instead of its own copy — coordinate through the controller), `publishDocument` keeps the source-review flag with `flagReason` when `overall ∈ {pending_push, conflict}`.

- [ ] **Step 1: Failing integration tests** (`wave5-seams.test.ts`, real Postgres via `test/helpers/db.js`, app via `test/helpers/app.js`):

```ts
describe('wave 5 seams', () => {
  it('E-1: a human publish keeps the source-review flag while a sync link is pending_push or conflict', async () => {
    // fixture: a published document with source_review_needed=true, a connector + sync_links row state='conflict'
    const res = await app.inject({ method: 'POST', url: `/api/v1/documents/${docId}/publish`, headers: lead, payload: { label: 'v' } });
    expect(res.statusCode).toBe(200);
    const row = await pool.query('select source_review_needed, source_review_reason from documents where id=$1', [docId]);
    expect(row.rows[0].source_review_needed).toBe(true);
    expect(row.rows[0].source_review_reason).toBe('קונפליקט בסנכרון');
    await pool.query(`update sync_links set state='synced' where document_id=$1`, [docId]);
    await app.inject({ method: 'POST', url: `/api/v1/documents/${docId}/publish`, headers: lead, payload: { label: 'v2' } });
    const after = await pool.query('select source_review_needed from documents where id=$1', [docId]);
    expect(after.rows[0].source_review_needed).toBe(false);
  });
  it('tracking resolves items through V1 repo (items port is not the stub)', async () => {
    // publish a quiz referencing docId (through V1 routes), then GET /documents/:id/learning lists it
    const r = await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/learning`, headers: agent });
    expect(r.json().items.map((i: { itemId: string }) => i.itemId)).toContain(quizId);
  });
  it('a significant publish invalidates completions and creates refresh assignments', async () => {
    // agent passes the quiz; lead publishes with significantChange: true; agent's GET /learning/my has an open 'refresh' assignment and the old one is invalidated
  });
});
```
Write the fixture helpers from the existing ones (`test/helpers/fixtures.ts`, `test/connectors-sync.int.test.ts` shows how a connector + `sync_links` row is created). Fill the third case fully using V1/V2's routes as merged.

- [ ] **Step 2: Run to verify failure** — `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/int/wave5-seams.test.ts`.

- [ ] **Step 3: Implement**

`syncState.ts` (skip if `grep -rn "sync-state" apps/api/src` finds the wave-3 route; then import its repo function instead):
```ts
import type { Q } from '../../lib/sql.js';
import type { DocumentSyncState } from '@wecom/shared';

const ORDER = ['conflict', 'pending_push', 'pending_import', 'synced'] as const;
/** Worst link state wins; the Hebrew reason is what the article badge and the review flag show. */
export async function documentSyncState(q: Q, documentId: string): Promise<Pick<DocumentSyncState, 'overall' | 'flagReason'>> {
  const r = await q.query(`select state from sync_links where document_id=$1`, [documentId]);
  if (!r.rowCount) return { overall: 'unlinked', flagReason: null };
  const states = new Set(r.rows.map((x) => x.state as string));
  const overall = ORDER.find((s) => states.has(s)) ?? 'synced';
  const flagReason = overall === 'conflict' ? 'קונפליקט בסנכרון' : overall === 'pending_push' ? 'ממתין לדחיפה' : null;
  return { overall, flagReason };
}
```
`documents/repo.ts` `publishDocument` — replace the unconditional clear:
```ts
  const humanPublish = (opts.kind ?? 'published') === 'published' && opts.actorId !== null;
  // E-1: a human publish closes the editorial loop only if nothing is still owed to the remote.
  const sync = humanPublish ? await documentSyncState(tx, id) : { overall: 'unlinked', flagReason: null };
  const keepFlag = humanPublish && sync.flagReason !== null;
  await tx.query(
    `update documents set current_version=$2, status=$3, updated_by=$4, updated_at=now(), etag=gen_random_uuid()::text,
            published_at=now()${humanPublish ? `, approver_id=$4` : ''}${
              humanPublish && !keepFlag ? `, source_review_needed=false, source_review_reason=null, source_review_at=null` : ''
            }${keepFlag ? `, source_review_needed=true, source_review_reason=$5, source_review_at=now()` : ''}
      where id=$1`,
    keepFlag ? [id, version, status, opts.actorId, sync.flagReason] : [id, version, status, opts.actorId],
  );
```
`itemsPort.ts` — replace the stub with V1's repo calls (`getPublished(itemId)` → `learningRepo.getItem` filtered to `status='published'`; `itemsReferencing(documentId)` → V1's query over `briefing_entries`/`quiz_questions`). If V1 named these differently, adapt here only.

- [ ] **Step 4: Run** — the seams file PASS; full `RUN_INTEGRATION=1 pnpm --filter @wecom/api test:int` green; `pnpm openapi` produces no diff (no route changes) — if `documentSyncState` is new, no OpenAPI change either.
- [ ] **Step 5: Commit** — `fix(api): E-1 publish keeps the source-review flag while a sync link is pending or in conflict; wire learning tracking to learning content`

---

### Task 7: Wave-4 follow-ups F-4 and A-4

**Files:**
- Modify: `apps/web/e2e/real/wordpress-source.spec.ts:145-152`, `apps/web/src/components/feedback/FeedbackButton.tsx:73`
- Test: `apps/web/test/feedback/FeedbackButton.test.tsx` (extend)

- [ ] **Step 1: Failing test (A-4)**
```tsx
  it('shows the doc type as letter · label, never the raw letter', async () => {
    renderFeedbackButton({ docType: 'T' });
    await user.click(screen.getByRole('button', { name: 'דיווח על בעיה / משוב' }));
    expect(screen.getByText(/סוג T · תסריט/)).toBeInTheDocument();
  });
```
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement**

`FeedbackButton.tsx:73`:
```tsx
          docType ? `סוג ${docType} · ${DOC_TYPE_LABELS[docType as DocType] ?? docType}` : null,
```
with `import { DOC_TYPE_LABELS, type DocType } from '@wecom/shared'`.

`wordpress-source.spec.ts:145-152` — replace the 10-round loop with a budgeted poll:
```ts
  const sourceHtml = await expect
    .poll(
      async () => {
        const run = await request.post(`/api/v1/connectors/${connectorId}/run`);
        expect(run.ok(), await run.text()).toBeTruthy();
        const r = await request.get(`/api/v1/documents/${docId}/source`);
        return r.status() === 204 ? '' : ((await r.json()) as { html: string }).html;
      },
      { message: 'the WordPress edit became a source version', timeout: 60_000, intervals: [1_500, 2_000, 3_000] },
    )
    .toContain('6 מגה')
    .then(() => request.get(`/api/v1/documents/${docId}/source`).then((r) => r.json()))
    .then((j) => (j as { html: string }).html);
```
(or keep a local variable and a second `GET` after the poll resolves — the point is the 60 s budget and `expect.poll`'s own retry).

- [ ] **Step 4: Run** — unit test PASS; the WordPress spec runs in Task 9's gate.
- [ ] **Step 5: Commit** — `fix(web): F-4 wordpress e2e polls with a 60 s budget; A-4 feedback modal names the doc type`

---

### Task 8: Real e2e — W5-E2E-1 learning loop

**Files:**
- Modify: `apps/web/e2e/real/helpers/users.ts` (`'approver'` in the role union)
- Create: `apps/web/e2e/real/learning-loop.spec.ts`

**Interfaces:**
- Consumes: `adminApi`, `createUser`, `signInAs`; seeded document `איטיות גלישה / חוסר גלישה` (used by W4-E2E-1); V1/V2/V3 routes; V4a/V4b pages.
- Produces: the spec §7 flow as one serial test.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminApi, createUser, signInAs } from './helpers/users.js';

const opened: { pages: Page[]; apis: APIRequestContext[] } = { pages: [], apis: [] };
test.afterEach(async () => {
  for (const p of opened.pages.splice(0)) await p.context().close();
  for (const a of opened.apis.splice(0)) await a.dispose();
});
const DOC_TITLE = 'איטיות גלישה / חוסר גלישה';
const stamp = Date.now().toString(36);
const QUIZ = `שאלון גלישה ${stamp}`;
const ZERO_TERM = `zzz-${stamp}`;

test('W5-E2E-1 a quiz is built, assigned, passed, refreshed after a significant change, and a gap is surfaced', async ({ browser, page, baseURL }) => {
  const api = await adminApi(page, baseURL!); opened.apis.push(api);
  const lead = await createUser(api, 'lead');
  const agent = await createUser(api, 'agent');
  const docs = await api.get(`/api/v1/documents?q=${encodeURIComponent(DOC_TITLE)}&pageSize=5`);
  const docId = ((await docs.json()) as { items: { id: string; title: string; category: string }[] }).items.find((d) => d.title === DOC_TITLE)!;

  /* 1. the lead builds a quiz from the document ---------------------------- */
  const l = await signInAs(browser, lead, baseURL!); opened.pages.push(l);
  await l.goto('/learning/manage/new');
  await l.getByRole('radio', { name: 'שאלון ידע' }).check();
  await l.getByLabel('כותרת').fill(QUIZ);
  await l.getByRole('button', { name: 'הוסף מסמך' }).click();
  await l.getByRole('dialog').getByPlaceholder(/חיפוש/).fill(DOC_TITLE);
  await l.getByRole('dialog').getByText(DOC_TITLE).first().click();
  await l.getByRole('button', { name: 'צור שאלות' }).click();
  await expect(l.getByRole('listitem', { name: /שאלה/ }).first()).toBeVisible({ timeout: 30_000 });
  await l.getByRole('button', { name: 'פרסם שאלון' }).click();
  await l.getByRole('dialog').getByLabel(/מה השתנה/).fill('v1');
  await l.getByRole('dialog').getByRole('button', { name: 'אישור' }).click();
  await expect(l.getByText(/פורסם/)).toBeVisible();

  /* 2. assign to agents in the document's world ---------------------------- */
  await l.getByRole('button', { name: 'שייך' }).click();
  const assign = l.getByRole('dialog', { name: /שיוך/ });
  await assign.getByRole('checkbox', { name: 'agent' }).check();
  await assign.getByRole('checkbox', { name: new RegExp(docId.category) }).check();
  await assign.getByRole('button', { name: 'שייך' }).click();
  await expect(l.getByText(/שויך ל-\d+ משתמשים/)).toBeVisible();

  /* 3. the agent passes it ------------------------------------------------- */
  const a = await signInAs(browser, agent, baseURL!); opened.pages.push(a);
  await a.goto('/learning');
  await a.getByRole('link', { name: QUIZ }).click();
  await a.getByRole('button', { name: 'התחל' }).click();
  // answer every question with the option marked correct in the player's data-testid (the player exposes `data-correct` only in preview for managers; for the agent, pick the first option and rely on the "retake" path if it fails)
  for (;;) {
    const options = a.getByRole('radio');
    if ((await options.count()) === 0) break;
    await options.first().check();
    const next = a.getByRole('button', { name: /הבא|סיים/ });
    await next.click();
    if (await a.getByRole('heading', { name: /תוצאה/ }).isVisible().catch(() => false)) break;
  }
  // unlimited retakes: if failed, the review screen offers "נסה שוב"; the API path below proves completion regardless of luck
  const my = await (await adminApi(a, baseURL!)).get('/api/v1/learning/my');
  const mine = (await my.json()) as { open: { id: string; itemTitle: string }[]; completed: { id: string; itemTitle: string }[] };
  if (!mine.completed.some((x) => x.itemTitle === QUIZ)) {
    // submit a correct attempt through the API using the manager preview to learn the correct options
    const item = await api.get(`/api/v1/learning/items?q=${encodeURIComponent(QUIZ)}`);
    const itemId = ((await item.json()) as { items: { id: string }[] }).items[0].id;
    const preview = await api.get(`/api/v1/learning/items/${itemId}/preview`);
    const questions = ((await preview.json()) as { questions: { id: string; options: { id: string; correct: boolean }[] }[] }).questions;
    const asg = mine.open.find((x) => x.itemTitle === QUIZ)!;
    const agentApi = await adminApi(a, baseURL!); opened.apis.push(agentApi);
    const started = await agentApi.post(`/api/v1/learning/my/${asg.id}/attempts`);
    const attemptId = ((await started.json()) as { id: string }).id;
    const answers = Object.fromEntries(questions.map((q) => [q.id, q.options.filter((o) => o.correct).map((o) => o.id)]));
    const res = await agentApi.put(`/api/v1/learning/attempts/${attemptId}`, { data: { answers } });
    expect(((await res.json()) as { passed: boolean }).passed).toBe(true);
  }
  await a.goto('/learning');
  await expect(a.getByRole('tab', { name: /הושלמו/ })).toBeVisible();

  /* 4. the dashboard shows the completion ----------------------------------- */
  await l.goto('/learning/manage');
  await l.getByRole('link', { name: QUIZ }).click();
  await l.getByRole('tab', { name: 'השלמה' }).click();
  await expect(l.getByText(agent.displayName)).toBeVisible();
  await expect(l.getByText(/100%|1\/1/)).toBeVisible();

  /* 5. a significant publish creates a refresh assignment ------------------ */
  await l.goto(`/edit/${docId.id}`);
  // change an outcome text so the detector fires (or tick the checkbox explicitly)
  await l.getByRole('button', { name: /פרסם/ }).click();
  const pub = l.getByRole('dialog', { name: /פרסום/ });
  await pub.getByRole('checkbox', { name: 'שינוי מהותי – דרוש רענון' }).check();
  await pub.getByLabel(/מה השתנה/).fill('שינוי סף');
  await pub.getByRole('button', { name: 'אישור' }).click();
  await expect(l.getByText(/רענונים נוצרו/)).toBeVisible();
  await a.goto(`/doc/${docId.id}`);
  await expect(a.getByRole('status', { name: 'רענון ידע נדרש' })).toBeVisible({ timeout: 20_000 });

  /* 6. a zero-result search becomes a gap with "צור פריט" ------------------- */
  const agentApi2 = await adminApi(a, baseURL!); opened.apis.push(agentApi2);
  for (let i = 0; i < 3; i++) await agentApi2.get(`/api/v1/search?q=${ZERO_TERM}`);
  const detect = await api.post('/api/v1/gaps/detect');
  expect(detect.ok(), await detect.text()).toBeTruthy();
  await l.goto('/gaps');
  const row = l.getByRole('row', { name: new RegExp(ZERO_TERM) });
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: 'צור פריט' }).click();
  await expect(l).toHaveURL(/\/edit\/new\?title=/);
  await expect(l.getByLabel('שם פריט הידע')).toHaveValue(new RegExp(ZERO_TERM));
});
```
Adapt every label/role to the real copy in V4a/V4b (record adjustments in the merge log); keep the six numbered stages — they are the acceptance evidence.

- [ ] **Step 2: Run** — `E2E_PG_PORT=55532 E2E_API_PORT=3201 E2E_WEB_PORT=4274 pnpm e2e:real -- --grep W5-E2E-1` (check `scripts/e2e-real.mjs` for how extra args pass through; if they do not, run the whole suite). Expected: PASS.
- [ ] **Step 3: Commit** — `test(e2e): W5-E2E-1 learning loop against the real stack`

---

### Task 9: Real e2e — W5-E2E-2 approver gate, and the full real suite

**Files:**
- Create: `apps/web/e2e/real/approver-gate.spec.ts`

- [ ] **Step 1: Write the spec**
```ts
test('W5-E2E-2 requireApprover blocks a lead and admits an approver', async ({ browser, page, baseURL }) => {
  const api = await adminApi(page, baseURL!); opened.apis.push(api);
  const editor = await createUser(api, 'editor');
  const lead = await createUser(api, 'lead');
  const approver = await createUser(api, 'approver');
  // editor requests review on a draft copy of a seeded document
  const created = await api.post('/api/v1/documents', { data: { title: `סקירה ${stamp}`, description: '', category: 'tech', wave: 1, priority: 'm', kind: 'steps' } });
  const docId = ((await created.json()) as { id: string }).id;
  const e = await signInAs(browser, editor, baseURL!); opened.pages.push(e);
  const eApi = await adminApi(e, baseURL!); opened.apis.push(eApi);
  expect((await eApi.post(`/api/v1/documents/${docId}/request-review`, { data: { note: 'לבדיקה' } })).ok()).toBeTruthy();
  // switch the setting on
  expect((await api.put('/api/v1/admin/workflow', { data: { requireApprover: true } })).ok()).toBeTruthy();
  // lead: refused with a message
  const l = await signInAs(browser, lead, baseURL!); opened.pages.push(l);
  await l.goto('/reviews');
  const row = l.getByRole('row', { name: new RegExp(`סקירה ${stamp}`) });
  await expect(row.getByRole('button', { name: /אשר/ })).toBeDisabled();
  await expect(row.getByText('אישור דורש תפקיד מאשר')).toBeVisible();
  const lApi = await adminApi(l, baseURL!); opened.apis.push(lApi);
  const refused = await lApi.post(`/api/v1/documents/${docId}/review-decision`, { data: { decision: 'approve', label: 'x' } });
  expect(refused.status()).toBe(403);
  expect(((await refused.json()) as { code: string }).code).toBe('APPROVER_REQUIRED');
  // approver: allowed
  const p = await signInAs(browser, approver, baseURL!); opened.pages.push(p);
  await p.goto('/reviews');
  await p.getByRole('row', { name: new RegExp(`סקירה ${stamp}`) }).getByRole('button', { name: /אשר/ }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'אישור' }).click();
  await expect(p.getByText('אושר ופורסם')).toBeVisible();
  // switch it off again so later specs are unaffected
  await api.put('/api/v1/admin/workflow', { data: { requireApprover: false } });
});
```
`helpers/users.ts`: `roleName: 'agent' | 'editor' | 'lead' | 'approver'`.

- [ ] **Step 2: Run the whole real suite** — `E2E_PG_PORT=55532 E2E_API_PORT=3201 E2E_WEB_PORT=4274 pnpm e2e:real`. Expected: all previous specs (incl. the F-4 fix in `wordpress-source.spec.ts`) plus W5-E2E-1/2 pass.
- [ ] **Step 3: Commit** — `test(e2e): W5-E2E-2 approver gate; full real suite green`

---

### Task 10: Merge main (0037), final gate, acceptance matrix, ledger

**Files:**
- Create: `docs/wave5-acceptance.md`
- Modify: `docs/superpowers/plans/README.md`, `.superpowers/sdd/program/progress.md`

- [ ] **Step 1: Bring in the wave-3 cleanup lane** — when the controller confirms 0037 is on `main`:
```bash
git merge main -m "Merge main (wave-3 cleanup lane 0037) into wave5/integration"
ls apps/api/migrations | grep -E '^00(3[7-9]|4[0-9])'   # expect 0037, 0038, 0039, 0040, 0041 (+0042 if created) and nothing above
```
If the cleanup lane shipped `GET /documents/:id/sync-state` with its own repo function, switch `publishDocument` to import it and delete `syncState.ts` (one commit).

- [ ] **Step 2: Full gate** — the Task 1 Step 3 gate plus `E2E_PG_PORT=55532 E2E_API_PORT=3201 E2E_WEB_PORT=4274 pnpm e2e:real`, and `E2E_OIDC=1` variant if the harness supports it. Record counts.

- [ ] **Step 3: Acceptance matrix** — `docs/wave5-acceptance.md`, same shape as `docs/wave4-acceptance.md`:
```md
# Wave 5 acceptance — PRD future phase → evidence

| PRD bullet | Lanes | Evidence |
|---|---|---|
| ליצור תדריך | V1, V4b | `apps/api/test/learning.test.ts` (briefing entries, publish pins document versions), `apps/web/test/learning/manage/*`, W5-E2E-1 stage 1 (quiz) + `wave5-mounts.test.tsx` |
| ליצור שאלון ידע | V1, V4a, V4b | `apps/api/test/learning.test.ts` (generate fallback + model, questions, publish), `apps/api/test/unit/questionGen.test.ts`, `apps/web/test/learning/QuizPlayer.test.tsx`, W5-E2E-1 stages 1–3 |
| לעקוב אחר השלמה | V2, V4a, V4b | `apps/api/test/learning-tracking.test.ts` (audiences, assignments, attempts, unlimited retakes, completion), dashboard tests, W5-E2E-1 stage 4 |
| לזהות שינוי משמעותי בידע ולדרוש רענון ידע | V2, V6 | `apps/api/test/unit/significantChange.test.ts`, `wave5-seams.test.ts` (invalidation + refresh assignments), W5-E2E-1 stage 5 |
| §11 approver role activation | V0, V3, V6 | `migrations.test.ts` (0038 role), `apps/api/test/approver-gate.test.ts`, W5-E2E-2 |
| §13 gap detection from usage data | V3, V4b, V6 | `apps/api/test/gaps.test.ts` (five heuristics, idempotence, dismiss/resolve), `apps/web/test/gaps/*`, W5-E2E-1 stage 6 |
| Wave-4 follow-ups F-4 / A-4 / E-1 | V6 | `wordpress-source.spec.ts` (60 s poll), `FeedbackButton.test.tsx`, `wave5-seams.test.ts` E-1 |

## Parked
| Item | Ruling | Cost if wrong |
| … every deliberate deviation recorded in `docs/wave5-merge-log.md`, in the wave-4 shape … |
```
Fill file names from `ls apps/api/test apps/web/test` after the merges; every row must name a test that ran green in Step 2.

- [ ] **Step 4: Plan index and ledger**
```bash
git add docs/wave5-acceptance.md docs/superpowers/plans/README.md && git commit -m "docs(v6): wave 5 acceptance matrix"
echo "Wave 5 V6 complete on wave5/integration $(git rev-parse --short HEAD): <gate counts>" >> .superpowers/sdd/program/progress.md
```
Reply to the controller with the head SHA, the gate counts, and the parked list; the controller merges into `main`.

---

## Self-review

- Spec coverage: §2 V6 row (mounts, e2e, review, follow-ups F-4/A-4/E-1) → Tasks 2–7; §5 behaviours that cross lanes (refresh banner, publish checkbox, approver hint, notifications) → Tasks 3–5; §6 merge rules and the 0037 dependency → Tasks 1 and 10; §7 real e2e → Tasks 8–9.
- Placeholders: none; where a lane's real name may differ, Task 1 Step 4 verifies it and the merge log becomes the source for later tasks (same mechanism W6 used).
- Type consistency: `documentSyncState` returns the `overall`/`flagReason` half of `DocumentSyncStateSchema`; `keys.learning.*` prefix `'learning'` is what Task 5's invalidation relies on; `significantChange`/`changeFlag` match V0's `PublishBodySchema`/`PublishResponseSchema`.
