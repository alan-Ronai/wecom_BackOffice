# W6 — Wave 4 Integration Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After lanes W1–W5 (and the wave 3 frontend lanes) have merged, mount every wave 4 component into the shell, article, library and editor that the lanes were forbidden to touch, close the cross-lane seams the lanes coded against interfaces for, and prove the whole PRD v1 scope with three real-stack Playwright flows.

**Architecture:** W6 is the only lane allowed to edit the shared UI files (`Sidebar.tsx`, `Shell.tsx`, `ArticlePage.tsx`, `StepView.tsx`, `LibraryPage.tsx`, `DocCard.tsx`, `EditorPage.tsx`, `SidePane.tsx`), `apps/api/src/app.ts`, and `packages/shared/src/schemas/stage45.ts`. It changes no lane's internal behaviour: it imports the lane components/hooks by the names in the lane briefs and wires them where the spec (§5) says they appear. Every mount ships with an msw unit test; every seam with an integration test; every PRD v1 bullet with an e2e id.

**Tech Stack:** React 18 + TanStack Query + react-router 6, vitest + msw + Testing Library, Fastify 5 + pg, Playwright (`playwright.real.config.ts`, real Postgres via `scripts/e2e-real.mjs`), `packages/connectors/test/helpers/wpStub.ts`.

**Spec:** `docs/superpowers/specs/2026-09-14-kb-wave4-prd-gaps-design.md` §5 (behaviour), §6 (isolation and merge playbook), §7 (testing), §9 (acceptance); contract `docs/api/CONTRACTS-wave4.md` (route table, "Web routes" mount list, migration numbers).

## Global Constraints

- Node `>=22`, pnpm `>=9`, TypeScript `strict: true`. Commands run from the repo root unless a step says `cd apps/api`.
- Migration for this lane: `apps/api/migrations/0035_wave4_fixups.js` — create it only if Task 6 needs it (it does: the `notifications.kind` check constraint); wave 3 owns `0010`, `0011`, `0020`, `0021`; W1–W5 own `0030`–`0034`.
- Shared files: W6 may edit any file, but every edit to a lane-owned module must be a one-line import/mount or a seam named in Task 6 — never a behavioural rewrite. If a lane component is missing or named differently, adapt the import in W6 (Task 1 inventory), do not re-implement it.
- Every mount ships a vitest + msw test in `apps/web/test/**`; msw handlers for wave 4 routes live in `apps/web/test/msw/handlers.ts` (each lane appended its own; W6 reconciles duplicates, keeping the contract shapes).
- Hebrew for user-facing labels, English for identifiers and logs. Role-based Playwright locators with Hebrew names.
- Commit after every task; append the attribution lines from the session to every commit message.
- After each merge in Task 1 and after Task 10: `pnpm -r build && pnpm -r test`, `cd apps/api && RUN_INTEGRATION=1 pnpm test:int`, `pnpm openapi && git diff --exit-code docs/api/openapi.json apps/web/src/api/schema.d.ts`, and a ledger line in `.superpowers/sdd/program/progress.md`.

## Facts about `main` at planning time (2026-09-14, HEAD 7cf8c4a)

- Wave 3 **backend** lanes A and B are already merged (`a392097`, `73a3b3d`): `apps/api/src/modules/{graph,dashboards,collab}`, migrations `0010`, `0011`, `0020`, `0021`, `GET /documents/:id/backlinks` at `apps/api/src/modules/documents/routes.ts:495`, `POST /telemetry` at `apps/api/src/modules/dashboards/routes.ts:29`, `notify(tx, events, n, actorId)` at `apps/api/src/modules/collab/repo.ts:37`, review decision at `apps/api/src/modules/collab/reviews.ts:150-195`.
- Wave 3 **frontend lane D** merged at `4a62274` (data explorer, graph, field/block pages, dashboards): `Sidebar.tsx` now has a "נתונים" nav (`/sources`, `/data`, `/graph`, `/dashboards`) at lines 197-203 and the "קטגוריות" block at lines 245-259; `Shell.tsx:20` `RAIL_ROUTES = /^\/(doc|edit|history|sources|data|graph)\b/`; the telemetry sender exists as `postTelemetry(body)` in `apps/web/src/api/stage4.ts:118`. Lanes C (core QOL) and E (admin/connectors, notifications, reviews) are **not** merged yet: `apps/web/src/components/{notifications,reviews}` do not exist; `routes.tsx` has no `/notifications`, `/reviews`. Task 1 re-checks all of this.
- `notifications.kind` check constraint (`0020_collab.js:89-93`) allows only `suggestion, sync, mention, review, publish, system` — **not** `feedback`/`source`. Task 6 widens it.
- `apps/api/src/modules/collab/repo.ts` exports a local `NotifyInput` (single `userId`) that shadows the shared `NotifyInput` (array `userIds`) from W0 when both are imported in one file. Task 6 aliases the import.
- The web still calls `GET /scripts` once (`apps/web/src/api/hooks/content.ts:81`, `useScripts`), used by `Sidebar.tsx:41`, `LibraryPage.tsx:50` (export bundle) and `Palette.tsx`. W1 turns `/scripts*` into adapters over `doc_type='T'`; W6 keeps them `deprecated: true` (Task 6, step 7) because of these callers.

## File structure

```
apps/web/src/components/shell/Sidebar.tsx              (modify: worlds/topics nav, feedback/analytics/taxonomy entries)
apps/web/src/components/shell/Shell.tsx                (modify: RAIL_ROUTES gains topic|feedback|analytics)
apps/web/src/lib/constants.ts                          (modify: CATS becomes a fallback used only until useWorlds resolves)
apps/web/src/components/article/ArticlePage.tsx        (modify: badge, feedback, pane mode, status chips, unavailable page, prev/next)
apps/web/src/components/article/StepView.tsx           (modify: per-step FeedbackButton next to "הערת נציג")
apps/web/src/components/library/LibraryPage.tsx        (modify: taxonomy facets in URL, StatusMenu, read-only gating)
apps/web/src/components/library/DocCard.tsx            (modify: TypeBadge + tags + status chips)
apps/web/src/components/editor/EditorPage.tsx          (modify: MetadataPanel, ImportExport, source link, feedback picker, text-kind editor)
apps/web/src/components/editor/SidePane.tsx            (modify: "מקור" tab hosting SourcePane read-only)
apps/web/src/api/events.ts                             (modify: invalidate feedback/source/taxonomy keys on the four wave-4 events)
apps/web/src/lib/telemetry.ts                          (new: sendTelemetry batch over lane D's postTelemetry — view_topic, search_click)
apps/web/test/integration/wave4-mounts.test.tsx        (new: one describe per mount task)
packages/shared/src/schemas/stage45.ts                 (modify: TelemetryEventSchema kinds + view_topic, search_click)
apps/api/src/modules/documents/repo.ts                 (modify: PublishOptions.sourceVersion → document_versions.source_version)
apps/api/src/modules/collab/reviews.ts                 (modify: approve sets approver_id)
apps/api/src/modules/documents/routes.ts               (modify: backlinks uses visibilityWhere)
apps/api/src/modules/feedback/notifier.ts              (modify: drop to_regclass guard; map kinds)
apps/api/migrations/0035_wave4_fixups.js               (new: widen notifications.kind check)
apps/api/test/int/wave4-seams.test.ts                  (new)
scripts/e2e-real.mjs                                   (modify: start the WordPress stub, pass CONNECTOR_HOST_ALLOWLIST, E2E_WP_URL)
scripts/wp-stub.mjs                                    (new: runs startWpStub as a process, prints its URL)
apps/web/e2e/real/helpers/users.ts                     (new: createUser(request, role) → { email, password }, signInAs(browser, creds))
apps/web/e2e/real/feedback-loop.spec.ts                (new)
apps/web/e2e/real/taxonomy-visibility.spec.ts          (new)
apps/web/e2e/real/wordpress-source.spec.ts             (new)
docs/superpowers/plans/README.md                       (modify: acceptance matrix link)
docs/wave4-acceptance.md                               (new: PRD bullet → test id matrix)
```

## Names consumed from other lanes (verified in Task 1; adapt imports there, never re-implement)

| Lane | Import | Path assumed |
|---|---|---|
| W1 | `useWorlds()`, `useTopics(worldSlug)`, `useTopicView(topicId)`, `useTags(q)` | `apps/web/src/api/hooks/taxonomy.ts` |
| W1 | `TopicPage`, `TypeBadge({ docType })`, `TaxonomyFacets({ value: TaxonomyFacetValue, onChange })` | `apps/web/src/components/taxonomy/*.tsx` |
| W1 | `MetadataPanel({ value: MetadataValue, onChange })` (docType, primary world, extra worlds, topics, tags, bodyHtml for text-kind items) | `apps/web/src/components/editor/MetadataPanel.tsx` |
| W1 | `TaxonomyPage` (admin) | `apps/web/src/components/admin/TaxonomyPage.tsx` |
| W1 | `keys.worlds`, `keys.topics(world)`, `keys.topic(id)`, `keys.tags(q)` | `apps/web/src/api/keys.ts` |
| W2 | `StatusChip({ status })`, `StatusMenu({ doc, onDone })`, `SourceReviewBadge({ doc })`, `OwnerFields({ doc, onChange })`, `UnavailablePage()` | `apps/web/src/components/governance/*.tsx` |
| W2 | `useSetStatus(id)`, `useClearSourceReview(id)`, `useReadOnlyReader()`; API `visibilityWhere(user, alias = 'd')`, `canReadUnpublished(user)`, `getVisibleDocument(q, id, user)` | `apps/web/src/api/hooks/governance.ts`; `apps/api/src/lib/visibility.ts`, `apps/api/src/modules/documents/repo.ts` |
| W3 | `FeedbackButton({ documentId, documentVersion, stepKey?, size?: 'xs'|'sm' })` (owns its modal), `PublishFeedbackPicker({ documentId, value, onChange })`, `FeedbackPage` (routes `/feedback`, `/feedback/analytics`, `/feedback/:id` — the detail is a drawer, not a page), `FeedbackDrawer`, `FeedbackAnalyticsTab` | `apps/web/src/components/feedback/*.tsx` |
| W3 | `useOpenFeedbackCount()`, `useDocumentFeedback(id)`; API `PgNotifier` | `apps/web/src/api/hooks/feedback.ts`; `apps/api/src/modules/feedback/notifier.ts` |
| W4 | `PaneModeToggle({ value: PaneMode, onChange, hasSource })`, `SourcePane({ documentId, canEdit, sourceId?, latestRevisionId? })`, `SourceHistory({ documentId, canEdit })`, `SourceEditor({ documentId, onSaved? })` (no compact mode — text-kind `bodyHtml` is edited through W1's `MetadataPanel`), `ImportExportButtons({ documentId, canEdit, hasSource })`; route `/edit/:id/source` | `apps/web/src/components/source/*.tsx` |
| W4 | `useSourceDocument(id)`, `useSourceDraft`, `exportDocxUrl`, `rawRevisionUrl`; API `currentSourceVersion(q, documentId)` (W6 passes it as `PublishOptions.sourceVersion` in the publish route) | `apps/web/src/api/hooks/sourcedocs.ts`; `apps/api/src/modules/sourcedocs/*` |
| W5 | `AnalyticsPage`, `useUsageAnalytics(q)`; API `PgUsage` | `apps/web/src/components/analytics/*.tsx`; `apps/api/src/modules/usage/*` |
| Wave 3 C/D/E | `NotificationsPage`, `ReviewsPage`, `DashboardsPage`, `sendTelemetry` (if C shipped one) | `apps/web/src/components/{notifications,reviews,dashboards}` |

---

### Task 1: Inventory and merge playbook

**Files:**
- Modify: `.superpowers/sdd/program/progress.md` (ledger lines)
- Create: `docs/wave4-merge-log.md`

**Interfaces:**
- Consumes: the W1–W5 lane branches (`worktree-agent-*` or `lane/w1-taxonomy`… — find them with `git branch -a`) and the wave 3 frontend branches.
- Produces: `main` with every lane merged, the verified import table above (rewritten in `docs/wave4-merge-log.md` with the *actual* paths), and a green baseline.

- [ ] **Step 1: Record the branch inventory**

```bash
git fetch --all --prune
git branch -a --list 'worktree-agent-*' --list 'lane/*' --format='%(refname:short) %(objectname:short) %(subject)' | tee docs/wave4-merge-log.md
git worktree list >> docs/wave4-merge-log.md
```
Identify which branch is which lane from the first commit subject (`feat(taxonomy)`, `feat(governance)`, `feat(feedback)`, `feat(source)`, `feat(usage)`, `feat(web): stage 4/5 …`). Write a table `Lane | branch | head | report path` into `docs/wave4-merge-log.md`.

- [ ] **Step 2: Merge in this order, one at a time**

Order: wave 3 frontend lanes (C, D, E) first if they are ready, then **W1 → W2 → W4 → W3 → W5**. For each branch `<b>`:
```bash
git checkout main && git pull --ff-only
git merge --no-ff <b> -m "Merge wave 4 lane <Wn>: <one-line scope>"
```
Conflict rules for the append-only files — keep **both** sides, wave 3 entries before wave 4 entries, alphabetical within a wave:
- `apps/api/src/modules/index.ts`: both imports; both entries in the `for (const m of [...])` list.
- `apps/web/src/routes.tsx`: both route objects; keep `{ path: '*' … }` last.
- `packages/shared/src/events.ts`: both name lists and both payload blocks; the `EVENTS` order must equal the order in `packages/shared/test/events.test.ts` — update the test to the merged order.
- `packages/shared/src/permissions.ts`: both permission names; both role additions; same for `permissions.test.ts`.
- `apps/api/src/plugins/boss.ts`: both `QUEUES` entries.
- `apps/web/src/api/keys.ts`: both key factories.
- `packages/shared/src/schemas/api.ts`: W1 and W2 both extend `PatchDocumentBodySchema` (W1: `docType, tags, worlds, topics, bodyHtml`; W2: `ownerId, editorId`) — keep both field sets in one `.extend({...})`; same for the test that parses the body.
- `apps/api/src/modules/documents/repo.ts` / `routes.ts`: W1 (taxonomy columns), W2 (visibility, ownership, status) and W3 (`resolveFeedback` in publish) all touch these; merge by function, run `apps/api/test/documents.test.ts` after each.
- `apps/web/test/msw/handlers.ts`: both handler groups; if two lanes stub the same path, keep the one whose shape matches `docs/api/CONTRACTS-wave4.md` and delete the other.
- Any other conflict is a real seam: resolve it in favour of the contract, note it in `docs/wave4-merge-log.md`, and if it changes behaviour add a test in Task 6.

- [ ] **Step 3: Verify after every merge**

```bash
pnpm install --frozen-lockfile || pnpm install
pnpm -r build && pnpm -r test
cd apps/api && RUN_INTEGRATION=1 pnpm test:int && cd ../..
pnpm openapi && git diff --exit-code docs/api/openapi.json apps/web/src/api/schema.d.ts || { git add docs/api/openapi.json apps/web/src/api/schema.d.ts && git commit -m "chore(contract): regenerate OpenAPI after merging <Wn>"; }
echo "W6: merged <Wn> (<sha>) — build/test/int/contract green" >> .superpowers/sdd/program/progress.md
git add .superpowers/sdd/program/progress.md docs/wave4-merge-log.md && git commit -m "chore(ledger): W6 merged <Wn>"
```
A red step blocks the next merge: fix it on `main` in the smallest commit that restores green (`fix(<lane>): …`) and log it.

- [ ] **Step 4: Verify the import table**

```bash
for f in apps/web/src/api/hooks/taxonomy.ts apps/web/src/components/taxonomy/TopicPage.tsx apps/web/src/components/taxonomy/TypeBadge.tsx apps/web/src/components/taxonomy/TaxonomyFacets.tsx apps/web/src/components/editor/MetadataPanel.tsx apps/web/src/components/admin/TaxonomyPage.tsx apps/web/src/components/governance/StatusChip.tsx apps/web/src/components/governance/StatusMenu.tsx apps/web/src/components/governance/SourceReviewBadge.tsx apps/web/src/components/governance/OwnerFields.tsx apps/web/src/components/governance/UnavailablePage.tsx apps/web/src/components/feedback/FeedbackButton.tsx apps/web/src/components/feedback/PublishFeedbackPicker.tsx apps/web/src/api/hooks/feedback.ts apps/web/src/components/source/PaneModeToggle.tsx apps/web/src/components/source/SourcePane.tsx apps/web/src/components/source/SourceEditor.tsx apps/web/src/components/source/ImportExportButtons.tsx apps/web/src/components/analytics/AnalyticsPage.tsx apps/api/src/lib/visibility.ts apps/api/src/modules/feedback/notifier.ts apps/web/src/api/hooks/sourcedocs.ts; do [ -f "$f" ] && echo "ok   $f" || echo "MISS $f"; done
grep -rn "export function \(TopicPage\|TypeBadge\|TaxonomyFacets\|MetadataPanel\|TaxonomyPage\|StatusChip\|StatusMenu\|SourceReviewBadge\|OwnerFields\|UnavailablePage\|FeedbackButton\|PublishFeedbackPicker\|PaneModeToggle\|SourcePane\|SourceEditor\|ImportExportButtons\|AnalyticsPage\)" apps/web/src | sort
grep -rn "export \(function\|const\) \(useWorlds\|useTopics\|useTopicView\|useTags\|useSetStatus\|useOpenFeedbackCount\|useDocumentFeedback\|useSourceDocument\|useUsageAnalytics\|visibilityWhere\)" apps/web/src apps/api/src | sort
```
For every `MISS` or renamed export, write the real path/name into the table in `docs/wave4-merge-log.md`; the tasks below import from that table. A component that genuinely does not exist is a lane defect: implement it in the lane's directory in the smallest form that satisfies its brief (props as listed above), with a unit test, commit `fix(<lane>): add missing <Component>` and log it.

- [ ] **Step 5: Commit the baseline**

```bash
git add docs/wave4-merge-log.md && git commit -m "docs(w6): merge log and verified lane import table"
echo "W6: baseline on main $(git rev-parse --short HEAD) — all lanes merged, green" >> .superpowers/sdd/program/progress.md
git add .superpowers/sdd/program/progress.md && git commit -m "chore(ledger): W6 baseline"
```

---

### Task 2: Shell mounts — worlds/topics navigation and new nav entries

**Files:**
- Modify: `apps/web/src/components/shell/Sidebar.tsx:10,43-49,188-203,245-259` (line numbers as of `4a62274`; anchor on the content quoted below), `apps/web/src/components/shell/Shell.tsx:20`, `apps/web/src/lib/constants.ts:4-12`
- Test: `apps/web/test/integration/wave4-mounts.test.tsx` (new), `apps/web/test/shell/Shell.test.tsx:9-15` (adapt)

**Interfaces:**
- Consumes: `useWorlds()` → `UseQueryResult<{ items: World[] }>`; `useTopics(worldSlug)` → `UseQueryResult<{ items: Topic[] }>`; `useOpenFeedbackCount()` → `UseQueryResult<number>`; `useCan()` from `apps/web/src/api/hooks/me.ts`.
- Produces: sidebar section "עולמות תוכן" driven by the API; nav rows "משוב" (`feedback.manage`, badge = open count), "אנליטיקה" (`analytics.read`), "טקסונומיה" under an "ניהול" divider (`taxonomy.manage`); rail routes include `/topic`, `/feedback`, `/analytics`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/integration/wave4-mounts.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { fx } from '../msw/fixtures.js';

const B = '/api/v1';
const U = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;
const worlds = {
  items: [
    { id: U(1), slug: 'sim', name: 'SIM / eSIM', description: '', position: 0, active: true, topicCount: 1, itemCount: 12, createdAt: fx.T, updatedAt: fx.T },
    { id: U(2), slug: 'field', name: 'שטח', description: '', position: 1, active: true, topicCount: 0, itemCount: 0, createdAt: fx.T, updatedAt: fx.T },
  ],
};
const topics = { items: [{ id: U(3), worldSlug: 'sim', slug: 'esim', name: 'הפעלת eSIM', description: '', position: 0, active: true, itemCount: 2 }] };

describe('W6 shell mounts', () => {
  it('lists worlds and topics from the API instead of the hard-coded categories', async () => {
    server.use(
      http.get(`${B}/worlds`, () => HttpResponse.json(worlds)),
      http.get(`${B}/worlds/sim/topics`, () => HttpResponse.json(topics)),
    );
    renderWithProviders(<App />, { route: '/library' });
    const side = within(await screen.findByRole('complementary', { name: 'ניווט ראשי' }));
    expect(await side.findByText('שטח')).toBeInTheDocument(); // not in CATS → proves API-driven
    await userEvent.click(side.getByText('SIM / eSIM'));
    expect(await side.findByText('הפעלת eSIM')).toBeInTheDocument();
  });

  it('shows feedback and analytics entries only with the permissions, with the open count', async () => {
    server.use(
      http.get(`${B}/auth/me`, () =>
        HttpResponse.json({ ...fx.me, permissions: [...fx.me.permissions, 'feedback.manage', 'analytics.read'] }),
      ),
      http.get(`${B}/feedback`, () =>
        HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 1, counts: { new: 4, in_review: 1, needs_update: 0, no_change: 0, done: 0 } }),
      ),
    );
    renderWithProviders(<App />, { route: '/library' });
    const side = within(await screen.findByRole('complementary', { name: 'ניווט ראשי' }));
    expect(await side.findByText('משוב')).toBeInTheDocument();
    expect(await side.findByText('5')).toBeInTheDocument(); // new + in_review
    expect(side.getByText('אנליטיקה')).toBeInTheDocument();
    expect(side.queryByText('טקסונומיה')).toBeNull(); // no taxonomy.manage in this fixture
  });

  it('hides them without the permissions', async () => {
    server.use(http.get(`${B}/auth/me`, () => HttpResponse.json({ ...fx.me, permissions: ['docs.read'] })));
    renderWithProviders(<App />, { route: '/library' });
    const side = within(await screen.findByRole('complementary', { name: 'ניווט ראשי' }));
    await side.findByText('ספריית ידע');
    expect(side.queryByText('משוב')).toBeNull();
    expect(side.queryByText('אנליטיקה')).toBeNull();
  });
});
```
If `fx.T` does not exist, use the `T` constant exported from `fixtures.ts` (it is `export const T = …` near the top; adjust the import).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wecom/web test -- wave4-mounts`
Expected: FAIL — "שטח" not found (sidebar still renders `CAT_KEYS`).

- [ ] **Step 3: Implement the sidebar**

`apps/web/src/components/shell/Sidebar.tsx` — imports (replace the `CATS, CAT_KEYS, SOURCE_FILES` import line, add the three new ones after the `useSettings` import):
```tsx
import { CATS, SOURCE_FILES } from '../../lib/constants.js';
import { useCan } from '../../api/hooks/me.js';
import { useWorlds, useTopics } from '../../api/hooks/taxonomy.js';
import { useOpenFeedbackCount } from '../../api/hooks/feedback.js';
```
After `const scripts = useScripts();`:
```tsx
  const can = useCan();
  const worlds = useWorlds();
  const [openWorld, setOpenWorld] = useState<string | null>(null);
  const topics = useTopics(openWorld ?? undefined);
  const openFeedback = useOpenFeedbackCount();
```
(add `import { useState } from 'react';` at the top). Replace the `const cards = …; const counts = CAT_KEYS.reduce(…)` block with:
```tsx
  const cards = all.data?.items ?? [];
  const worldRows = worlds.data?.items ?? [];
  const counts = worldRows.reduce<Record<string, number>>((acc, w) => {
    acc[w.slug] = w.itemCount;
    return acc;
  }, {});
```
Inside the second `<nav aria-label="נתונים">`, after `{item('לוחות בקרה', '/dashboards')}`:
```tsx
          {can('feedback.manage') ? item('משוב', '/feedback', openFeedback.data || null, true) : null}
          {can('analytics.read') ? item('אנליטיקה', '/analytics') : null}
```
Replace the whole `<div className="sec-title">קטגוריות</div>` block (through its closing `</div>` after the `CAT_KEYS.map`) with:
```tsx
        <div className="sec-title">עולמות תוכן</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 10px' }}>
          {worldRows.map((w) => (
            <div key={w.slug}>
              <div
                className={'cat-row' + (loc.pathname === `/library/${w.slug}` ? ' on' : '')}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setOpenWorld((cur) => (cur === w.slug ? null : w.slug));
                  go(`/library/${w.slug}`);
                }}
              >
                <span>{CATS[w.slug as keyof typeof CATS]?.icon ?? '▸'} {w.name}</span>
                <span>{String(counts[w.slug] ?? 0)}</span>
              </div>
              {openWorld === w.slug
                ? (topics.data?.items ?? []).map((t) => (
                    <div
                      key={t.id}
                      className={'cat-row sub' + (loc.pathname === `/topic/${t.id}` ? ' on' : '')}
                      role="button"
                      tabIndex={0}
                      style={{ paddingInlineStart: 22 }}
                      onClick={() => go(`/topic/${t.id}`)}
                    >
                      <span>{t.name}</span>
                      <span>{String(t.itemCount)}</span>
                    </div>
                  ))
                : null}
            </div>
          ))}
          {can('taxonomy.manage') ? (
            <div className="src-add" role="button" tabIndex={0} onClick={() => go('/admin/taxonomy')}>
              ⚙ ניהול עולמות ונושאים
            </div>
          ) : null}
        </div>
```
`apps/web/src/lib/constants.ts:4` — change the type so unknown slugs compile: `export const CATS: Record<string, { label: string; short: string; icon: string; color: string }> = { …unchanged… };` and keep `CAT_KEYS` (other files still import it; W1 may already have done this — if `CATS` is already `Record<string, …>`, skip).
`apps/web/src/components/shell/Shell.tsx:20`: `const RAIL_ROUTES = /^\/(doc|edit|history|sources|data|graph|topic|feedback\/|analytics)\b/;` and the matching "כווץ" regex in `Sidebar.tsx` (`/^\/(doc|edit|history|sources|data|graph)\b/`) gets the same three additions.

`apps/web/test/shell/Shell.test.tsx:9-15`: the first test asserted `'חו"ל ונדידה'` from `CATS`; add a `GET /worlds` handler returning the six seeded worlds to `apps/web/test/msw/handlers.ts` default set (W1 should have; if not, add it there with the six `CATS` entries as `World` rows) so this test keeps passing unchanged.

- [ ] **Step 4: Run**

Run: `pnpm --filter @wecom/web test -- wave4-mounts Shell`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/shell apps/web/src/lib/constants.ts apps/web/test
git commit -m "feat(web): mount worlds/topics navigation and feedback/analytics/taxonomy entries in the shell"
```

---

### Task 3: Article page mounts

**Files:**
- Modify: `apps/web/src/components/article/ArticlePage.tsx:3-23,196-211,246-258,301-312,385-395`, `apps/web/src/components/article/StepView.tsx:276-287`
- Test: `apps/web/test/integration/wave4-mounts.test.tsx`

**Interfaces:**
- Consumes: `TypeBadge`, `SourceReviewBadge`, `StatusChip`, `UnavailablePage`, `FeedbackButton`, `PaneModeToggle`, `SourcePane`, `useTopicView`, `DOC_TYPE_LABELS` (shared); `ApiError` code `NOT_PUBLISHED` (W2 returns 404 with `code: 'NOT_PUBLISHED'`; `ApiError` exposes `.code` — check `apps/web/src/api/unwrap.ts`; if it exposes only `.status`/`.body`, read `error.body?.code`).
- Produces: `StepCtx.onFeedback?: (key: string) => void` (added to `StepView.tsx:9-26`), pane mode persisted in preferences under `paneMode: 'work' | 'source' | 'split'` (W4 extended `PreferencesSchema`; if not, keep it in `useState`).

- [ ] **Step 1: Write the failing tests** (append to `wave4-mounts.test.tsx`)

```tsx
import { D_BROWSING } from '../msw/fixtures.js';

describe('W6 article mounts', () => {
  it('renders the type badge, tags and a feedback button in the header and on the active step', async () => {
    server.use(
      http.get(`${B}/documents/${D_BROWSING}`, () =>
        HttpResponse.json({ ...fx.docBrowsing, docType: 'R', tags: ['apn', 'esim'], worlds: ['tech'], topics: [U(3)] }),
      ),
    );
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await screen.findByRole('heading', { level: 1, name: fx.docBrowsing.title });
    expect(screen.getByText('טיפול')).toBeInTheDocument(); // DOC_TYPE_LABELS.R
    expect(screen.getByText('#apn')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: /דיווח על בעיה \/ משוב/ });
    expect(buttons.length).toBeGreaterThanOrEqual(2); // header + active step
  });

  it('shows the unavailable page on NOT_PUBLISHED', async () => {
    server.use(
      http.get(`${B}/documents/${D_BROWSING}`, () =>
        HttpResponse.json({ code: 'NOT_PUBLISHED', message: 'פריט זה אינו זמין כרגע' }, { status: 404 }),
      ),
    );
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    expect(await screen.findByText('פריט זה אינו זמין כרגע')).toBeInTheDocument();
    expect(screen.queryByText('ייתכן שהועבר לסל המיחזור')).toBeNull();
  });

  it('switches to the source pane', async () => {
    server.use(
      http.get(`${B}/documents/${D_BROWSING}/source`, () =>
        HttpResponse.json({ documentId: D_BROWSING, html: '<h2>מקור הידע</h2><p>טקסט מקור</p>', text: 'טקסט מקור', version: 2, etag: 's2', updatedById: null, updatedByName: null, updatedAt: fx.T }),
      ),
    );
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await screen.findByRole('heading', { level: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'מקור' }));
    expect(await screen.findByText('טקסט מקור')).toBeInTheDocument();
  });

  it('offers prev/next inside the topic', async () => {
    server.use(
      http.get(`${B}/documents/${D_BROWSING}`, () => HttpResponse.json({ ...fx.docBrowsing, docType: 'R', topics: [U(3)] })),
      http.get(`${B}/topics/${U(3)}/items`, () =>
        HttpResponse.json({
          topic: topics.items[0],
          world: worlds.items[0],
          groups: [
            { docType: 'M', items: [{ id: U(7), slug: 'm', title: 'אבחון גלישה', docType: 'M', kind: 'steps', status: 'published', worlds: ['tech'], description: '', tags: [], updatedAt: fx.T }] },
            { docType: 'R', items: [{ id: D_BROWSING, slug: 'browsing', title: fx.docBrowsing.title, docType: 'R', kind: 'steps', status: 'published', worlds: ['tech'], description: '', tags: [], updatedAt: fx.T }] },
          ],
        }),
      ),
    );
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await screen.findByRole('heading', { level: 1 });
    expect(await screen.findByRole('button', { name: /הקודם בנושא: אבחון גלישה/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /הבא בנושא/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wecom/web test -- wave4-mounts`
Expected: FAIL on 'טיפול' / the feedback button.

- [ ] **Step 3: Implement ArticlePage**

Imports (after line 23):
```tsx
import { DOC_TYPE_LABELS } from '@wecom/shared';
import { TypeBadge } from '../taxonomy/TypeBadge.js';
import { useTopicView } from '../../api/hooks/taxonomy.js';
import { StatusChip } from '../governance/StatusChip.js';
import { SourceReviewBadge } from '../governance/SourceReviewBadge.js';
import { UnavailablePage } from '../governance/UnavailablePage.js';
import { FeedbackButton } from '../feedback/FeedbackButton.js';
import { PaneModeToggle } from '../source/PaneModeToggle.js';
import { SourcePane } from '../source/SourcePane.js';
```
After line 57 (`const call = useCall(...)`):
```tsx
  const [paneMode, setPaneMode] = useState<'work' | 'source' | 'split'>(
    (prefs.data as { paneMode?: 'work' | 'source' | 'split' } | undefined)?.paneMode ?? 'work',
  );
  const topicView = useTopicView(doc?.topics?.[0]);
  const topicNeighbours = useMemo(() => {
    const flat = (topicView.data?.groups ?? []).flatMap((g) => g.items);
    const i = flat.findIndex((x) => x.id === doc?.id);
    return { prev: i > 0 ? flat[i - 1] : null, next: i >= 0 && i < flat.length - 1 ? flat[i + 1] : null };
  }, [topicView.data, doc?.id]);
```
Replace lines 206-211 (the `!doc` branch) with:
```tsx
  if (docQ.error instanceof ApiError && (docQ.error as { code?: string }).code === 'NOT_PUBLISHED')
    return <UnavailablePage />;
  if (!doc)
    return (
      <div className="empty">
        <b>המסמך לא נמצא</b>ייתכן שהועבר לסל המיחזור
      </div>
    );
```
(if `ApiError` carries the envelope as `.body`, test `(docQ.error.body as { code?: string })?.code`.)
In the topbar `.actions` (before the `הדפסה` button, line 295):
```tsx
          <FeedbackButton documentId={doc.id} stepKey={call.activeKey ?? undefined} />
          <PaneModeToggle
            value={paneMode}
            onChange={(m) => {
              setPaneMode(m);
              savePrefs.mutate({ ...(prefs.data ?? { theme: null, font: 'plex', panel: true, callMode: true, sidebarExpanded: false }), paneMode: m } as never);
            }}
          />
```
(`PaneModeToggle` renders three buttons named "עבודה", "מקור", "מפוצל" — that is what the test clicks.)
In `.doc-head .meta` (replace lines 386-392):
```tsx
                    <div className="meta">
                      {doc.docType ? <TypeBadge docType={doc.docType} /> : null}
                      <span className="chip chip-blue">
                        {doc.kind === 'retention' ? 'שימור לקוחות' : `תפעולי – ${CATS[doc.category]?.short ?? doc.category}`}
                      </span>
                      <span className="chip chip-gray">v{doc.currentVersion}</span>
                      <span className="chip chip-gray">{steps.length} שלבים</span>
                      {can('docs.read_unpublished') ? <StatusChip status={doc.status} /> : null}
                      {can('docs.edit', doc) ? <SourceReviewBadge doc={doc} /> : null}
                      {(doc.tags ?? []).map((t) => (
                        <span key={t} className="chip chip-gray" role="button" tabIndex={0} onClick={() => go(`/library?tag=${encodeURIComponent(t)}`)}>
                          #{t}
                        </span>
                      ))}
                    </div>
```
After `<p>{doc.description}</p>` (line 394) add the topic neighbours:
```tsx
                    {topicNeighbours.prev || topicNeighbours.next ? (
                      <div className="topic-nav" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        {topicNeighbours.prev ? (
                          <button className="btn xs" onClick={() => go(`/doc/${topicNeighbours.prev!.id}`)}>
                            → הקודם בנושא: {topicNeighbours.prev.title} ({DOC_TYPE_LABELS[topicNeighbours.prev.docType]})
                          </button>
                        ) : null}
                        {topicNeighbours.next ? (
                          <button className="btn xs" onClick={() => go(`/doc/${topicNeighbours.next!.id}`)}>
                            הבא בנושא: {topicNeighbours.next.title} ({DOC_TYPE_LABELS[topicNeighbours.next.docType]}) ←
                          </button>
                        ) : null}
                      </div>
                    ) : null}
```
Pane modes — wrap the existing `<article className="doc">…</article>` (lines 384-397) as:
```tsx
                {paneMode === 'source' ? (
                  <SourcePane documentId={doc.id} />
                ) : paneMode === 'split' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
                    <article className="doc">{/* existing head + DocBody unchanged */}</article>
                    <SourcePane documentId={doc.id} />
                  </div>
                ) : (
                  <article className="doc">{/* existing head + DocBody unchanged */}</article>
                )}
```
Extract the `<article>` contents into a local `const workView = (<article className="doc">…</article>);` above the `return` so it is written once.
Add `onFeedback: (k) => void 0` is **not** needed: pass the button instead — `StepView.tsx:9-26` add `onFeedback?: (key: string) => void;` to `StepCtx`, and in `ArticlePage` ctx add `onFeedback: (k) => setFeedbackStep(k)` with `const [feedbackStep, setFeedbackStep] = useState<string | null>(null);` and render `<FeedbackButton documentId={doc.id} stepKey={feedbackStep ?? undefined} openSignal={feedbackStep} />` — **simpler**: in `StepView.tsx:276-287`, next to the note button, render the button directly:
```tsx
                {ctx.callMode && cur && ctx.onFeedback ? (
                  <span
                    className="note-add"
                    role="button"
                    tabIndex={0}
                    aria-label="דיווח על בעיה / משוב לשלב"
                    onClick={(e) => {
                      e.stopPropagation();
                      ctx.onFeedback?.(step.key);
                    }}
                  >
                    ⚑ דיווח על בעיה / משוב
                  </span>
                ) : null}
```
and in `ArticlePage` ctx: `onFeedback: (k) => setFeedbackStep(k)`; render once near the header button: `{feedbackStep ? <FeedbackModal documentId={doc.id} stepKey={feedbackStep} onClose={() => setFeedbackStep(null)} /> : null}` (import `FeedbackModal` from `../feedback/FeedbackModal.js`; its props are `{ documentId, stepKey?, onClose }`).

- [ ] **Step 4: Run**

Run: `pnpm --filter @wecom/web test -- wave4-mounts Article`
Expected: PASS (the existing `Article.test.tsx` still passes; if it asserted the exact chip list in `.meta`, update the assertion to include the badge).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/article apps/web/test
git commit -m "feat(web): article mounts — type badge, tags, feedback, pane modes, status/source-review chips, topic prev/next, unavailable page"
```

---

### Task 4: Library mounts

**Files:**
- Modify: `apps/web/src/components/library/LibraryPage.tsx:3,12,28-62,83-112,243`, `apps/web/src/components/library/DocCard.tsx:1-2,62-71`
- Test: `apps/web/test/integration/wave4-mounts.test.tsx`

**Interfaces:**
- Consumes: `DocTypeFacets({ value: { world?, topic?, docType?, tag? }, onChange })` from W1 (renders world/topic/type selects and a tag input), `TypeBadge`, `StatusMenu({ doc, onDone })` (W2; renders menu items "סמן כלא בתוקף" / "העבר לארכיון" / "החזר לטיוטה" with a reason prompt), `useSearchParams` from react-router.
- Produces: URL-driven filters `?world=&topic=&docType=&tag=` passed straight into `useDocuments(query)`; status controls hidden for users without `docs.read_unpublished`.

- [ ] **Step 1: Write the failing tests**

```tsx
describe('W6 library mounts', () => {
  it('passes taxonomy filters from the URL to GET /documents and shows type badges', async () => {
    let seen: URL | null = null;
    server.use(
      http.get(`${B}/documents`, ({ request }) => {
        seen = new URL(request.url);
        return HttpResponse.json({ items: [{ ...fx.cards[0], docType: 'O', tags: ['apn'] }], total: 1, page: 1, pageSize: 50 });
      }),
    );
    renderWithProviders(<App />, { route: '/library?world=tech&docType=O&tag=apn' });
    await screen.findByTestId('library-grid');
    await waitFor(() => expect(seen?.searchParams.get('docType')).toBe('O'));
    expect(seen?.searchParams.get('world')).toBe('tech');
    expect(seen?.searchParams.getAll('tag')).toEqual(['apn']);
    expect(within(screen.getByTestId('library-grid')).getByText('תפעול')).toBeInTheDocument();
  });

  it('shows status actions to editors and hides them from read-only users', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const grid = await screen.findByTestId('library-grid');
    await userEvent.click(within(grid).getAllByTitle('פעולות')[0]);
    expect(await screen.findByRole('menuitem', { name: /סמן כלא בתוקף/ })).toBeInTheDocument();
  });

  it('read-only: no status menu items', async () => {
    server.use(http.get(`${B}/auth/me`, () => HttpResponse.json({ ...fx.me, permissions: ['docs.read'] })));
    renderWithProviders(<App />, { route: '/library' });
    const grid = await screen.findByTestId('library-grid');
    await userEvent.click(within(grid).getAllByTitle('פעולות')[0]);
    await screen.findByRole('menuitem', { name: /היסטוריית גרסאות/ });
    expect(screen.queryByRole('menuitem', { name: /סמן כלא בתוקף/ })).toBeNull();
  });
});
```
(`fx.cards` — the msw fixture array of `DocumentCard`s; if it is named differently, e.g. `fx.libraryCards`, use that name.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wecom/web test -- wave4-mounts`
Expected: FAIL — `docType` param not sent.

- [ ] **Step 3: Implement**

`LibraryPage.tsx` — imports: add `useSearchParams` to the react-router import (line 2); add
```tsx
import { DocTypeFacets } from '../taxonomy/DocTypeFacets.js';
import { StatusMenu, statusMenuItems } from '../governance/StatusMenu.js';
```
(`statusMenuItems(doc, { modal, toast, mutate }) : MenuItem[]` is the headless form W2 exports for menus; if W2 shipped only the component, render `<StatusMenu doc={menu.card} onDone={() => setMenu(null)} />` inside the `CardMenu` list instead — the test only needs the menuitem text.)
After line 36:
```tsx
  const [params, setParams] = useSearchParams();
  const tax = {
    world: params.get('world') ?? undefined,
    topic: params.get('topic') ?? undefined,
    docType: (params.get('docType') as DocType | null) ?? undefined,
    tag: params.getAll('tag'),
  };
  const setTax = (next: typeof tax) => {
    const p = new URLSearchParams();
    if (next.world) p.set('world', next.world);
    if (next.topic) p.set('topic', next.topic);
    if (next.docType) p.set('docType', next.docType);
    for (const t of next.tag) p.append('tag', t);
    setParams(p, { replace: true });
  };
```
(import `type DocType` from `@wecom/shared`.) Extend `query` (lines 40-46):
```tsx
    ...(tax.world ? { world: tax.world } : {}),
    ...(tax.topic ? { topic: tax.topic } : {}),
    ...(tax.docType ? { docType: tax.docType } : {}),
    ...(tax.tag.length ? { tag: tax.tag } : {}),
```
Line 243: `<Facets value={facets} onChange={setFacets} />` → 
```tsx
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Facets value={facets} onChange={setFacets} />
              <DocTypeFacets value={tax} onChange={setTax} />
            </div>
```
`menuItems` (line 83): after the pin item and before delete:
```tsx
    if (can('docs.publish', c) && can('docs.read_unpublished'))
      list.push(...statusMenuItems(c, { modal, toast, onDone: () => docs.refetch() }));
```
`DocCard.tsx`: import `TypeBadge` and `StatusChip`; in `.chips` (line 62-71) prepend `{card.docType ? <TypeBadge docType={card.docType} /> : null}`, replace the draft/partial chips with `<StatusChip status={card.status} />` when `card.status !== 'published'`, and after `.desc` add
```tsx
      {card.tags?.length ? (
        <div className="tags">{card.tags.slice(0, 4).map((t) => <span key={t} className="chip chip-gray">#{t}</span>)}</div>
      ) : null}
```
`CATS[card.category].short` → `CATS[card.category]?.short ?? card.category` (world slugs beyond the six).

- [ ] **Step 4: Run**

Run: `pnpm --filter @wecom/web test -- wave4-mounts Library`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/library apps/web/test
git commit -m "feat(web): library mounts — taxonomy facets in the URL, type badges, tags, status menu gated by permission"
```

---

### Task 5: Editor mounts

**Files:**
- Modify: `apps/web/src/components/editor/EditorPage.tsx:3-38,147-206,269-281,284-343,459-465`, `apps/web/src/components/editor/SidePane.tsx:8,30-57,58-80`
- Test: `apps/web/test/integration/wave4-mounts.test.tsx`

**Interfaces:**
- Consumes: `MetadataPanel({ doc, onChange(next: Document) })` (W1: docType, primary world, extra worlds, topics, tags), `OwnerFields({ doc, onChange })` (W2), `ImportExportButtons({ documentId })` (W4), `SourceEditor({ documentId, compact, value, onChange })` (W4), `PublishFeedbackPicker({ documentId, value: string[], onChange })` and `useDocumentFeedback(id)` (W3), `usePublish` now accepting `resolveFeedbackIds` (W3 extended the mutation body type — if not, extend `apps/web/src/api/hooks/documents.ts:113` to `{ id: string; label: string; markPartial?: boolean; resolveFeedbackIds?: string[] }`), `usePatchDocument` accepting `docType, tags, worlds, topics, ownerId, editorId, bodyHtml` (W1/W2 extended `PatchDocumentBodySchema`).
- Produces: publish dialog with the feedback checklist; text-kind items edit `bodyHtml` in `SourceEditor` compact mode.

- [ ] **Step 1: Write the failing tests**

```tsx
describe('W6 editor mounts', () => {
  it('shows the metadata panel and the source link', async () => {
    renderWithProviders(<App />, { route: `/edit/${D_BROWSING}` });
    await screen.findByPlaceholderText('שם פריט הידע…');
    expect(screen.getByLabelText('סוג פריט')).toBeInTheDocument(); // MetadataPanel select
    expect(screen.getByLabelText('גורם מקצועי אחראי')).toBeInTheDocument(); // OwnerFields
    expect(screen.getByRole('link', { name: 'ערוך מקור' })).toHaveAttribute('href', `/edit/${D_BROWSING}/source`);
    expect(screen.getByRole('button', { name: /ייצוא ל-Word/ })).toBeInTheDocument();
  });

  it('publish dialog lists open feedback and sends resolveFeedbackIds', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.get(`${B}/documents/${D_BROWSING}/feedback`, () =>
        HttpResponse.json({ items: [{ id: U(9), documentId: D_BROWSING, documentVersion: 7, docType: 'R', worldSlug: 'tech', stepKey: 's1', kind: 'error', text: 'טעות בשלב 1', status: 'new', userId: U(1), userName: 'דנה', createdAt: fx.T, assigneeId: null, decisionNote: null, decidedBy: null, decidedAt: null, resolvedVersion: null, documentTitle: fx.docBrowsing.title, assigneeName: null }] }),
      ),
      http.post(`${B}/documents/${D_BROWSING}/publish`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ document: { ...fx.docBrowsing, currentVersion: 8 }, version: 8, auditId: U(5) });
      }),
    );
    renderWithProviders(<App />, { route: `/edit/${D_BROWSING}` });
    await screen.findByPlaceholderText('שם פריט הידע…');
    await userEvent.click(screen.getByRole('button', { name: /פרסם v/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/מה השתנה/), 'תיקון');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /טעות בשלב 1/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'אישור' }));
    await waitFor(() => expect(body?.resolveFeedbackIds).toEqual([U(9)]));
  });

  it('text-kind items open the compact source editor instead of steps', async () => {
    server.use(
      http.get(`${B}/documents/${D_BROWSING}`, () =>
        HttpResponse.json({ ...fx.docBrowsing, kind: 'text', docType: 'T', phases: [], bodyHtml: '<p>שלום, מדבר/ת נציג/ה</p>' }),
      ),
    );
    renderWithProviders(<App />, { route: `/edit/${D_BROWSING}` });
    await screen.findByPlaceholderText('שם פריט הידע…');
    expect(await screen.findByText('שלום, מדבר/ת נציג/ה')).toBeInTheDocument();
    expect(screen.queryByText('+ קבוצת שלבים')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wecom/web test -- wave4-mounts`
Expected: FAIL — no "סוג פריט" label.

- [ ] **Step 3: Implement**

`EditorPage.tsx` imports (after line 38):
```tsx
import { Link } from 'react-router-dom';
import { MetadataPanel } from '../taxonomy/MetadataPanel.js';
import { OwnerFields } from '../governance/OwnerFields.js';
import { ImportExportButtons } from '../source/ImportExportButtons.js';
import { SourceEditor } from '../source/SourceEditor.js';
import { PublishFeedbackPicker } from '../feedback/PublishFeedbackPicker.js';
import { useDocumentFeedback } from '../../api/hooks/feedback.js';
```
After line 75: `const openFeedback = useDocumentFeedback(isNew ? undefined : id);`

Publish (replace lines 155-161, the `modal.prompt`, with a `modal.open` form so the picker fits):
```tsx
    const nextV = (published.data?.currentVersion ?? 0) + 1;
    let label = isNew ? 'פריט ידע חדש' : '';
    let resolveIds: string[] = [];
    const ok = await new Promise<boolean>((resolve) =>
      modal.open({
        title: `פרסום v${nextV}`,
        body: (
          <div style={{ display: 'grid', gap: 10 }}>
            <label>
              מה השתנה? (מופיע בהיסטוריית הגרסאות)
              <input type="text" defaultValue={label} onChange={(e) => (label = e.target.value)} autoFocus />
            </label>
            {!isNew && (openFeedback.data?.items.length ?? 0) > 0 ? (
              <PublishFeedbackPicker documentId={id} value={resolveIds} onChange={(v) => (resolveIds = v)} />
            ) : null}
          </div>
        ),
        actions: [
          { label: 'ביטול', run: () => resolve(false) },
          { label: 'אישור', primary: true, run: () => resolve(true) },
        ],
      }),
    );
    if (!ok) return;
```
(`modal.open({ title, body, actions })` — check `apps/web/src/components/ui/Modal.tsx` for the exact option names; `modal.prompt` is built on it. If `actions` is named `buttons`, use that.) Then in the publish call (line 199): `resolveFeedbackIds: resolveIds.length ? resolveIds : undefined,`. In the `patch.mutateAsync` (line 183) add `docType: clean.docType, tags: clean.tags, worlds: clean.worlds, topics: clean.topics, ownerId: clean.ownerId ?? undefined, editorId: clean.editorId ?? undefined, ...(clean.kind === 'text' ? { bodyHtml: clean.bodyHtml } : {})`.

Topbar actions (line 269-281), before the JSON export button:
```tsx
            {!isNew ? <ImportExportButtons documentId={id} /> : null}
            {!isNew ? (
              <Link className="btn sm" to={`/edit/${id}/source`}>
                ערוך מקור
              </Link>
            ) : null}
```
Metadata: replace the `ed-fields` block (lines 285-343) with
```tsx
          <div className="ed-fields">
            <MetadataPanel doc={doc} onChange={update} />
            <OwnerFields doc={doc} onChange={update} />
            <label>
              גל כתיבה
              <select aria-label="גל כתיבה" value={doc.wave} onChange={(e) => update({ ...doc, wave: Number(e.target.value) as 1 | 2 | 3 })}>
                {[1, 2, 3].map((w) => (<option key={w} value={w}>גל {w}</option>))}
              </select>
            </label>
            <label>
              שכיחות
              <select aria-label="שכיחות" value={doc.priority} onChange={(e) => update({ ...doc, priority: e.target.value as Document['priority'] })}>
                {Object.entries(PRI).map(([k, v]) => (<option key={k} value={k}>{v.label}</option>))}
              </select>
            </label>
          </div>
```
(`MetadataPanel` owns the world select, so the old "קטגוריה" and disabled "קובץ יעד" selects go; drop the now-unused `CATS, CAT_KEYS, SOURCE_FILES` imports.)
Text kind: wrap the phases map + DropZone + `.perm` block (lines 353-455) in
```tsx
          {doc.kind === 'text' ? (
            <SourceEditor documentId={isNew ? undefined : id} compact value={doc.bodyHtml ?? ''} onChange={(html) => update({ ...doc, bodyHtml: html })} />
          ) : (
            <>{/* existing phases, DropZone, perm block unchanged */}</>
          )}
```
`SidePane.tsx`: add a fourth tab `['source', 'מקור']` rendering `<SourcePane documentId={doc.id} />` when `doc.id !== 'new'` (import from `../source/SourcePane.js`), hint "מקור הידע המלא".

- [ ] **Step 4: Run**

Run: `pnpm --filter @wecom/web test -- wave4-mounts Editor`
Expected: PASS. If `Editor.test.tsx` asserted the "קטגוריה" select, update it to the `MetadataPanel` label "עולם תוכן".

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor apps/web/src/api/hooks apps/web/test
git commit -m "feat(web): editor mounts — metadata/owner panels, import/export, source link, feedback picker on publish, text-kind editor"
```

---

### Task 6: Cross-lane seams (API + shared)

**Files:**
- Create: `apps/api/migrations/0035_wave4_fixups.js`, `apps/api/test/int/wave4-seams.test.ts`, `apps/web/src/lib/telemetry.ts`
- Modify: `apps/api/src/modules/documents/repo.ts:519-561`, `apps/api/src/modules/collab/reviews.ts:165-170`, `apps/api/src/modules/documents/routes.ts:495-510`, `apps/api/src/modules/feedback/notifier.ts`, `packages/shared/src/schemas/stage45.ts:235-241`, `apps/web/src/api/events.ts:36-52`, `apps/api/src/modules/scripts/routes.ts` (OpenAPI `deprecated: true` only), `apps/api/src/openapi.ts` (nothing unless the scripts change needs it)

**Interfaces:**
- Consumes: `publishDocument(tx, doc, opts)` (`documents/repo.ts:531`), `notify(tx, events, n, actorId)` (`collab/repo.ts:37`), `visibilityWhere(user, alias)` (W2; returns a SQL fragment string like `and d.status in ('published','partial')` or `''`), `inboundFor(db, { kind, key })` (`documents/routes.ts:505`), `PgNotifier` (W3), `recordTelemetry(db, userId, events)` (`dashboards/repo.ts:167`).
- Produces: `PublishOptions.sourceVersion?: number | null` written to `document_versions.source_version`; `approver_id` set on review approval; backlinks visibility-filtered; notifications kind check includes `feedback`, `source`; telemetry kinds include `view_topic`, `search_click`; web SSE invalidation for the four wave-4 events; `sendTelemetry(events)`.

- [ ] **Step 1: Write the failing integration test**

`apps/api/test/int/wave4-seams.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb } from '../helpers/db.js';
import { buildTestApp } from '../helpers/app.js';
import { makeUser, authHeader, makeDocument } from '../helpers/fixtures.js';
import { withTransaction } from '../../src/lib/sql.js';
import { publishDocument } from '../../src/modules/documents/repo.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;

run('wave 4 seams', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.ready();
  }, 120_000);
  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  it('publish records the source version it was derived from', async () => {
    const lead = await makeUser(db.pool, { name: 'lead', perms: ['docs.read', 'docs.edit', 'docs.publish'] });
    const doc = await makeDocument(db.pool, { title: 'seam', category: 'tech' });
    await withTransaction(db.pool, (tx) =>
      publishDocument(tx, doc.id, { actorId: lead.id, label: 'v1', sourceVersion: 3 }),
    );
    const r = await db.pool.query('select source_version from document_versions where document_id=$1 order by version desc limit 1', [doc.id]);
    expect(r.rows[0].source_version).toBe(3);
  });

  it('review approval sets approver_id', async () => {
    const editor = await makeUser(db.pool, { name: 'ed', perms: ['docs.read', 'docs.edit', 'docs.read_unpublished'] });
    const lead = await makeUser(db.pool, { name: 'ld', perms: ['docs.read', 'docs.edit', 'docs.publish', 'docs.read_unpublished'] });
    const doc = await makeDocument(db.pool, { title: 'review me', category: 'tech' });
    const rq = await app.inject({ method: 'POST', url: `/api/v1/documents/${doc.id}/request-review`, headers: authHeader(editor), payload: { note: 'בבקשה' } });
    expect(rq.statusCode).toBe(200);
    const dec = await app.inject({ method: 'POST', url: `/api/v1/documents/${doc.id}/review-decision`, headers: authHeader(lead), payload: { decision: 'approve', label: 'אושר' } });
    expect(dec.statusCode).toBe(200);
    const r = await db.pool.query('select approver_id, status from documents where id=$1', [doc.id]);
    expect(r.rows[0].approver_id).toBe(lead.id);
    expect(r.rows[0].status).toBe('published');
  });

  it('backlinks hide unpublished sources from read-only users', async () => {
    const agent = await makeUser(db.pool, { name: 'ag', perms: ['docs.read'] });
    const target = await makeDocument(db.pool, { title: 'target', category: 'tech', status: 'published' });
    const draftSrc = await makeDocument(db.pool, { title: 'draft-src', category: 'tech', status: 'draft' });
    await db.pool.query(
      `insert into document_links(from_document_id, to_document_id, type, origin) values ($1,$2,'related','explicit')`,
      [draftSrc.id, target.id],
    );
    const res = await app.inject({ method: 'GET', url: `/api/v1/documents/${target.id}/backlinks`, headers: authHeader(agent) });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((x: { documentId: string }) => x.documentId)).not.toContain(draftSrc.id);
  });

  it('notifications accept the feedback and source kinds', async () => {
    const u = await makeUser(db.pool, { name: 'n', perms: ['docs.read'] });
    await expect(
      db.pool.query(`insert into notifications(user_id, kind, title) values ($1,'feedback','x'),($1,'source','y')`, [u.id]),
    ).resolves.toBeTruthy();
  });
});
```
`makeDocument` accepts `status` — check `apps/api/test/helpers/fixtures.ts`; if it does not, add `status?: string` to its options and to its insert (it is a test helper; two-line change).

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/int/wave4-seams.test.ts`
Expected: FAIL on `source_version` (TypeScript: `sourceVersion` not in `PublishOptions`) — fix compile first by adding the field, then the test fails on the null column.

- [ ] **Step 3: Implement the API seams**

`documents/repo.ts:519-525`:
```ts
export interface PublishOptions {
  actorId: string | null;
  label: string;
  suggestionId?: string | null;
  markPartial?: boolean;
  kind?: 'published' | 'restore' | 'system' | 'sync';
  /** W4: the source_documents.current_version this working version was derived from. */
  sourceVersion?: number | null;
}
```
`documents/repo.ts:551-561` — the insert:
```ts
  const inserted = await tx.query(
    'insert into document_versions(document_id, version, snapshot, author_id, label, kind, suggestion_id, source_version) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id',
    [id, version, JSON.stringify(published), opts.actorId, opts.label, opts.kind ?? 'published', opts.suggestionId ?? null, opts.sourceVersion ?? null],
  );
```
and in the same function's `update documents set …` add `published_at=now(), approver_id=coalesce(approver_id, $4)` — W2 may already set `published_at` there; keep one assignment each. W4's `PUT /documents/:id/source` path already stores `current_version`; where W4 or W2 call `publishDocument`, pass `sourceVersion: (await tx.query('select current_version from source_documents where document_id=$1', [id])).rows[0]?.current_version ?? null`. Do that **inside** `publishDocument` itself (one query, before the insert) so every caller gets it:
```ts
  const sv = opts.sourceVersion ?? (await tx.query('select current_version from source_documents where document_id=$1', [id])).rows[0]?.current_version ?? null;
```
and use `sv` in the insert.

`collab/reviews.ts:165-170` — after `publishDocument(...)` inside `if (approve)`:
```ts
          await tx.query('update documents set approver_id=$2 where id=$1', [documentId, user.id]);
```

`documents/routes.ts:495-510` — backlinks: import `visibilityWhere` from `./visibility.js` and filter:
```ts
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      if (!(await repo.getDocument(app.db, id))) throw notFound('המסמך');
      const items = await inboundFor(app.db, { kind: 'document', key: id });
      if (!user.permissions.has('docs.read_unpublished')) {
        const ids = items.map((x) => x.documentId);
        const ok = await app.db.query(`select id from documents d where d.id = any($1) ${visibilityWhere(user, 'd')}`, [ids]);
        const allowed = new Set(ok.rows.map((r) => r.id as string));
        return { items: items.filter((x) => allowed.has(x.documentId)) };
      }
      return { items };
```
(`visibilityWhere` returns a fragment beginning with ` and `; if W2's helper takes a params array, adapt the call as its signature says.)

`apps/api/migrations/0035_wave4_fixups.js`:
```js
/** W6: wave 3's notifications.kind check predates the wave 4 alert kinds. */
exports.up = (pgm) => {
  pgm.dropConstraint('notifications', 'notifications_kind_check', { ifExists: true });
  pgm.addConstraint('notifications', 'notifications_kind_check', {
    check: "kind in ('suggestion','sync','mention','review','publish','system','feedback','source')",
  });
};
exports.down = (pgm) => {
  pgm.sql("delete from notifications where kind in ('feedback','source')");
  pgm.dropConstraint('notifications', 'notifications_kind_check', { ifExists: true });
  pgm.addConstraint('notifications', 'notifications_kind_check', {
    check: "kind in ('suggestion','sync','mention','review','publish','system')",
  });
};
```
Verify the constraint name first: `psql … -c "\d notifications"` in the test container, or `select conname from pg_constraint where conrelid='notifications'::regclass and contype='c'`; node-pg-migrate names inline checks `<table>_<column>_check`. If the name differs, use the real one in both `up` and `down`.

`apps/api/src/modules/feedback/notifier.ts` — W3 shipped `PgNotifier` guarded by `to_regclass('notifications')` (falls back to `LogNotifier` when the table is absent) and mapped kinds `feedback|source` → `system`. Remove the guard and the mapping: insert `kind` as given (the constraint now allows it). Keep W3's unit test for the mapping but invert its expectation (`kind === 'feedback'`). Also alias the import to avoid the `NotifyInput` shadow: `import type { NotifyInput as SharedNotifyInput } from '@wecom/shared';`.

`packages/shared/src/schemas/stage45.ts:236`: `kind: z.enum(['outcome', 'call_completed', 'palette', 'jump', 'view_topic', 'search_click']),` and widen the `telemetry_events.kind` check if `0010_telemetry.js` has one (add to `0035_wave4_fixups.js` the same drop/add pattern with the six kinds).

`apps/web/src/lib/telemetry.ts` — a batching wrapper over lane D's `postTelemetry(body)` (`apps/web/src/api/stage4.ts:118`, already typed by `TelemetryBatch`):
```ts
import type { TelemetryBatch } from '@wecom/shared';
import { postTelemetry } from '../api/stage4.js';

type Kind = TelemetryBatch['events'][number]['kind'];
const queue: TelemetryBatch['events'] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** Batches telemetry into one POST /telemetry per second; drops silently on failure. */
export function sendTelemetry(kind: Kind, extra: { documentId?: string; stepKey?: string } = {}): void {
  queue.push({ kind, ...extra, at: new Date().toISOString() });
  if (timer) return;
  timer = setTimeout(async () => {
    const events = queue.splice(0, 200);
    timer = null;
    if (!events.length) return;
    try {
      await postTelemetry({ events });
    } catch {
      /* telemetry is best-effort */
    }
  }, 1000);
}
```
(`Kind` picks up `view_topic` / `search_click` automatically once `stage45.ts` is widened above.) If lane D already batches somewhere (grep `postTelemetry(` call sites), reuse that instead of adding a second queue. Call `sendTelemetry('view_topic', { documentId: topicId })` from `TopicPage` (one line in W1's page) and `sendTelemetry('search_click', { documentId })` where the palette opens a hit (`apps/web/src/components/palette/Palette.tsx`, the click handler on `.ri`).

`apps/web/src/api/events.ts:36-52` — extend `invalidate`:
```ts
  } else if (ev.name.startsWith('feedback.')) {
    void qc.invalidateQueries({ queryKey: ['feedback'] });
    void qc.invalidateQueries({ queryKey: keys.doc((ev.payload as { documentId: string }).documentId) });
  } else if (ev.name === 'source_document.saved') {
    const id = (ev.payload as { documentId: string }).documentId;
    void qc.invalidateQueries({ queryKey: ['source', id] });
    void qc.invalidateQueries({ queryKey: keys.doc(id) });
  } else if (ev.name === 'taxonomy.changed') {
    void qc.invalidateQueries({ queryKey: ['worlds'] });
    void qc.invalidateQueries({ queryKey: ['topics'] });
    void qc.invalidateQueries({ queryKey: ['topic'] });
  }
```
(use the lanes' `keys.*` factories if their key prefixes differ from `'feedback'`, `'source'`, `'worlds'`, `'topics'`, `'topic'` — read `apps/web/src/api/keys.ts` after the merge.)

`/scripts*`: `grep -rn "'/scripts" apps/web/src --include='*.ts' --include='*.tsx' | grep -v schema.d` still returns `content.ts:81` → keep the adapters; ensure each `/scripts*` route in `apps/api/src/modules/scripts/routes.ts` has `schema: { deprecated: true, … }` (W1 added it; verify with `grep -c "deprecated: true" apps/api/src/modules/scripts/routes.ts` = 5).

- [ ] **Step 4: Run**

Run: `pnpm --filter @wecom/shared build && cd apps/api && pnpm tsc --noEmit && RUN_INTEGRATION=1 pnpm vitest run test/int/wave4-seams.test.ts test/migrations.test.ts test/migrate.test.ts && cd ../.. && pnpm --filter @wecom/web test -- events`
Expected: PASS.

- [ ] **Step 5: Regenerate the contract and commit**

```bash
pnpm openapi
git add apps/api apps/web/src packages/shared docs/api/openapi.json apps/web/src/api/schema.d.ts
git commit -m "feat(api,web): wave 4 seams — source_version on publish, approver_id on review approval, visibility on backlinks, notification kinds, telemetry kinds, SSE invalidation"
```

---

### Task 7: Real e2e — user fixtures and the feedback loop

**Files:**
- Create: `apps/web/e2e/real/helpers/users.ts`, `apps/web/e2e/real/feedback-loop.spec.ts`

**Interfaces:**
- Consumes: `POST /admin/users` (`AdminUserCreateSchema`: `{ email, password (≥12), displayName?, roles?: [{ roleId, categoryScope | worldScope }] }` — W1 renamed `categoryScope`→`worldScope`; check `packages/shared/src/schemas/api.ts:181-188` after the merge and use the real key), `GET /admin/roles` → `{ items: Role[] }`, `POST /auth/local` (`{ email, password }`), the admin storage state `e2e/.auth/admin.json`.
- Produces: `createUser(request, roleName)` → `{ email, password, id }`; `signInAs(browser, creds)` → a `Page` in a fresh context; the spec ids `W4-E2E-1` (feedback loop).

- [ ] **Step 1: Write the helper**

`apps/web/e2e/real/helpers/users.ts`:
```ts
import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export interface Creds { id: string; email: string; password: string; displayName: string }

/** Creates a local user with one default role through the real admin API (admin session required). */
export async function createUser(request: APIRequestContext, roleName: 'agent' | 'editor' | 'lead'): Promise<Creds> {
  const roles = await request.get('/api/v1/admin/roles');
  expect(roles.ok()).toBeTruthy();
  const role = ((await roles.json()) as { items: { id: string; name: string }[] }).items.find((r) => r.name === roleName);
  if (!role) throw new Error(`role ${roleName} not seeded`);
  const stamp = Date.now().toString(36);
  const creds = {
    email: `e2e-${roleName}-${stamp}@wecom.co.il`,
    password: `e2e-${roleName}-password-${stamp}`,
    displayName: `E2E ${roleName} ${stamp}`,
  };
  // `worldScope` after W1; the previous key was `categoryScope`. Send both — the schema strips the unknown one.
  const res = await request.post('/api/v1/admin/users', {
    data: { ...creds, roles: [{ roleId: role.id, worldScope: null, categoryScope: null }] },
  });
  expect(res.status(), await res.text()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  return { id, ...creds };
}

/** Signs in through the real local form in a brand-new context (no shared cookies). */
export async function signInAs(browser: Browser, creds: Creds): Promise<Page> {
  const ctx = await browser.newContext({ locale: 'he-IL' });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('דוא״ל').fill(creds.email);
  await page.getByLabel('סיסמה').fill(creds.password);
  await page.getByRole('button', { name: 'כניסה מקומית' }).click();
  await expect(page).toHaveURL(/\/library/);
  return page;
}
```
If `POST /admin/users` returns the user under `user.id` (`UserWithRoles`), read `json.user?.id ?? json.id`.

- [ ] **Step 2: Write the feedback-loop spec**

`apps/web/e2e/real/feedback-loop.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { createUser, signInAs } from './helpers/users.js';

/**
 * W4-E2E-1 — PRD §12 closed loop: agent reports → editor sees the queue → edits the source
 * document → suggestion accepted → publish closes the feedback with the new version → analytics
 * shows it. Runs as three real users against the real stack.
 */
test.describe.configure({ mode: 'serial' });

const DOC_TITLE = 'איטיות גלישה / חוסר גלישה';

test('W4-E2E-1 feedback travels from an agent to a closed status linked to a published version', async ({ browser, request }) => {
  const agent = await createUser(request, 'agent');
  const lead = await createUser(request, 'lead');

  // 1. agent reports from a step
  const a = await signInAs(browser, agent);
  await a.goto('/library');
  await a.getByText(DOC_TITLE).first().click();
  await expect(a.locator('.step.cur')).toBeVisible();
  await a.getByRole('button', { name: /דיווח על בעיה \/ משוב/ }).first().click();
  const dlg = a.getByRole('dialog');
  await dlg.getByRole('radio', { name: 'מצאתי טעות' }).check();
  await dlg.getByLabel(/הסבר/).fill('הסף בשלב 1 לא נכון');
  // auto-captured context is shown read-only: item, type, world, version, step
  await expect(dlg.getByText(DOC_TITLE)).toBeVisible();
  await expect(dlg.getByText(/גרסה v\d+/)).toBeVisible();
  await dlg.getByRole('button', { name: 'שלח' }).click();
  await expect(a.getByText(/המשוב נשלח/)).toBeVisible();
  await a.context().close();

  // 2. lead sees it in the queue and opens the document at the step
  const l = await signInAs(browser, lead);
  await l.goto('/feedback');
  const row = l.getByRole('row', { name: /הסף בשלב 1 לא נכון/ });
  await expect(row).toBeVisible();
  await expect(row.getByText('חדש')).toBeVisible();
  await row.click();
  await l.getByRole('button', { name: 'בבדיקה' }).click();
  await expect(l.getByText('בבדיקה').first()).toBeVisible();
  const docUrl = await l.getByRole('link', { name: 'פתח מסמך' }).getAttribute('href');
  expect(docUrl).toMatch(/\/doc\/[0-9a-f-]+\/s\d+/);

  // 3. lead edits the source document → the working view is flagged for review
  await l.goto(docUrl!.replace('/doc/', '/edit/').replace(/\/s\d+$/, '/source'));
  const editor = l.getByRole('textbox', { name: 'מסמך מקור' });
  await editor.click();
  await l.keyboard.press('End');
  await l.keyboard.type(' סף חדש: 6 מגה.');
  await l.getByRole('button', { name: 'שמור גרסה' }).click();
  await l.getByLabel(/תיאור הגרסה/).fill('עדכון סף');
  await l.getByRole('button', { name: 'אישור' }).click();
  await expect(l.getByText(/נשמרה גרסת מקור/)).toBeVisible();

  await l.goto(docUrl!.replace(/\/s\d+$/, ''));
  await expect(l.getByText('נדרשת בדיקה')).toBeVisible(); // SourceReviewBadge (editor only)

  // 4. publish the working view and close the feedback with this version
  await l.getByRole('button', { name: '✏️ ערוך' }).click();
  await l.getByRole('button', { name: /פרסם v/ }).click();
  const pub = l.getByRole('dialog');
  await pub.getByLabel(/מה השתנה/).fill('תיקון הסף בעקבות משוב');
  await pub.getByRole('checkbox', { name: /הסף בשלב 1 לא נכון/ }).check();
  await pub.getByRole('button', { name: 'אישור' }).click();
  await expect(l.getByText(/פורסם v(\d+)/)).toBeVisible({ timeout: 20_000 });
  const version = Number((await l.getByText(/פורסם v(\d+)/).innerText()).match(/v(\d+)/)![1]);
  await expect(l.getByText('נדרשת בדיקה')).toHaveCount(0); // flag cleared by publish

  // 5. the feedback is done and linked to that version; analytics counts it
  await l.goto('/feedback?status=done');
  const done = l.getByRole('row', { name: /הסף בשלב 1 לא נכון/ });
  await expect(done).toBeVisible();
  await expect(done.getByText(`v${version}`)).toBeVisible();
  await l.getByRole('tab', { name: 'אנליטיקה' }).click();
  await expect(l.getByText(/שיעור משובים שהובילו לשינוי/)).toBeVisible();
  await expect(l.getByText(/100%|1 מתוך 1/)).toBeVisible();
  await l.context().close();
});
```
Locator names come from the lane briefs (`FeedbackModal` radios use `FEEDBACK_KIND_LABELS`, submit "שלח", toast "המשוב נשלח"; queue rows are a `<table>` with `role=row`; detail drawer status buttons use `FEEDBACK_STATUS_LABELS`; `SourceEditor` textbox is labelled "מסמך מקור", save button "שמור גרסה"; `SourceReviewBadge` text "נדרשת בדיקה"). Task 1's inventory confirms them; adjust names here to what shipped, never the other way round.

- [ ] **Step 3: Run it against the real stack**

Run: `pnpm e2e:real -- --grep "W4-E2E-1"`
Expected: PASS. If it fails on a lane behaviour (not a locator), that is a lane defect: fix in the lane's module with a unit/integration test, commit `fix(<lane>): …`, log it in `docs/wave4-merge-log.md`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/real
git commit -m "test(e2e): real feedback loop — agent report → editor queue → source edit → publish closes feedback → analytics"
```

---

### Task 8: Real e2e — taxonomy and visibility

**Files:**
- Create: `apps/web/e2e/real/taxonomy-visibility.spec.ts`

**Interfaces:**
- Consumes: `/admin/taxonomy` (W1 `TaxonomyAdminPage`: "עולם חדש" / "נושא חדש" forms with labels "מזהה (slug)", "שם"), editor `MetadataPanel` (labels "עולם תוכן", "עולמות נוספים", "נושאים", "תגיות", "סוג פריט"), `/topic/:id` page, palette search with tag filter, `UnavailablePage` text.
- Produces: spec id `W4-E2E-2`.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { createUser, signInAs } from './helpers/users.js';

/** W4-E2E-2 — PRD §2/§3/§6/§7/§10: worlds and topics are data, items carry type + tags, read-only users see published only. */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const WORLD = { slug: `w-${stamp}`, name: `עולם בדיקה ${stamp}` };
const TOPIC = { slug: `t-${stamp}`, name: `נושא בדיקה ${stamp}` };
const TAG = `tag${stamp}`;
const PUBLISHED_TITLE = `פריט מפורסם ${stamp}`;
const DRAFT_TITLE = `טיוטה נסתרת ${stamp}`;

test('W4-E2E-2 admin adds a world and topic; editor files items; agent finds the published one only', async ({ page, browser, request }) => {
  // admin (storageState) — /admin/taxonomy
  await page.goto('/admin/taxonomy');
  await page.getByRole('button', { name: 'עולם חדש' }).click();
  await page.getByLabel('מזהה (slug)').fill(WORLD.slug);
  await page.getByLabel('שם').fill(WORLD.name);
  await page.getByRole('button', { name: 'שמור' }).click();
  await expect(page.getByRole('row', { name: new RegExp(WORLD.name) })).toBeVisible();
  await page.getByRole('row', { name: new RegExp(WORLD.name) }).getByRole('button', { name: 'נושאים' }).click();
  await page.getByRole('button', { name: 'נושא חדש' }).click();
  await page.getByLabel('מזהה (slug)').fill(TOPIC.slug);
  await page.getByLabel('שם').fill(TOPIC.name);
  await page.getByRole('button', { name: 'שמור' }).click();
  await expect(page.getByRole('row', { name: new RegExp(TOPIC.name) })).toBeVisible();

  // the sidebar now lists the new world without a deploy
  await page.goto('/library');
  const side = page.getByRole('complementary', { name: 'ניווט ראשי' });
  await expect(side.getByText(WORLD.name)).toBeVisible();

  // editor creates two items in the topic: one published (type O, tagged), one left as draft
  const editor = await createUser(request, 'lead');
  const e = await signInAs(browser, editor);
  for (const [title, publish, docType] of [[PUBLISHED_TITLE, true, 'O'], [DRAFT_TITLE, false, 'I']] as const) {
    await e.goto('/edit/new');
    await e.getByPlaceholder('שם פריט הידע…').fill(title);
    await e.getByLabel('סוג פריט').selectOption(docType);
    await e.getByLabel('עולם תוכן').selectOption(WORLD.slug);
    await e.getByLabel('נושאים').click();
    await e.getByRole('option', { name: TOPIC.name }).click();
    await e.keyboard.press('Escape');
    await e.getByLabel('תגיות').fill(TAG);
    await e.keyboard.press('Enter');
    if (publish) {
      await e.getByRole('button', { name: /פרסם v/ }).click();
      await e.getByRole('dialog').getByLabel(/מה השתנה/).fill('פריט חדש');
      await e.getByRole('dialog').getByRole('button', { name: 'אישור' }).click();
      await expect(e.getByText(/פורסם v1/)).toBeVisible({ timeout: 20_000 });
    } else {
      // autosave keeps the draft; `POST /documents` happens on first publish only, so create it
      // as a draft through the "שמור כטיוטה" action the editor exposes for new items.
      await e.getByRole('button', { name: 'שמור כטיוטה' }).click();
      await expect(e.getByText(/נשמר/)).toBeVisible({ timeout: 20_000 });
    }
  }
  // topic page groups by type; both visible to the editor, the draft with a status chip
  await e.goto('/library');
  await e.getByRole('complementary', { name: 'ניווט ראשי' }).getByText(WORLD.name).click();
  await e.getByRole('complementary', { name: 'ניווט ראשי' }).getByText(TOPIC.name).click();
  await expect(e).toHaveURL(/\/topic\//);
  const topicUrl = e.url();
  await expect(e.getByRole('heading', { name: 'תפעול' })).toBeVisible();
  await expect(e.getByText(PUBLISHED_TITLE)).toBeVisible();
  await expect(e.getByText(DRAFT_TITLE)).toBeVisible();
  await expect(e.getByText('טיוטה').first()).toBeVisible();
  const draftHref = await e.getByRole('link', { name: DRAFT_TITLE }).getAttribute('href');
  await e.context().close();

  // agent: finds the published item by tag and on the topic page; the draft is invisible
  const agent = await createUser(request, 'agent');
  const a = await signInAs(browser, agent);
  await a.goto(`/library?tag=${TAG}`);
  await expect(a.getByText(PUBLISHED_TITLE)).toBeVisible();
  await expect(a.getByText(DRAFT_TITLE)).toHaveCount(0);
  await a.keyboard.press('Control+k');
  await a.getByPlaceholder(/חפש מסמך/).fill(TAG);
  await expect(a.locator('.palette .ri', { hasText: PUBLISHED_TITLE })).toBeVisible();
  await expect(a.locator('.palette .ri', { hasText: DRAFT_TITLE })).toHaveCount(0);
  await a.keyboard.press('Escape');
  await a.goto(topicUrl);
  await expect(a.getByText(PUBLISHED_TITLE)).toBeVisible();
  await expect(a.getByText(DRAFT_TITLE)).toHaveCount(0);
  await expect(a.getByText('טיוטה')).toHaveCount(0); // no status chips for read-only users
  await a.goto(draftHref!);
  await expect(a.getByText('פריט זה אינו זמין כרגע')).toBeVisible();
  await a.context().close();
});
```
"שמור כטיוטה" is the new-item draft action; if the editor has no such button after the merge (W2/W3 briefs did not require one), create the draft through the API inside the test instead: `request.post('/api/v1/documents', { data: { title: DRAFT_TITLE, description: '', category: WORLD.slug, wave: 2, priority: 'm', kind: 'text', phases: [], docType: 'I', tags: [TAG], topics: [topicId] } })` with `topicId` read from `GET /worlds/:slug/topics` — and drop the UI branch for the draft.

- [ ] **Step 2: Run**

Run: `pnpm e2e:real -- --grep "W4-E2E-2"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/real/taxonomy-visibility.spec.ts
git commit -m "test(e2e): real taxonomy + visibility — new world/topic, typed+tagged items, read-only sees published only"
```

---

### Task 9: Real e2e — WordPress source round trip

**Files:**
- Create: `scripts/wp-stub.mjs`, `apps/web/e2e/real/wordpress-source.spec.ts`
- Modify: `scripts/e2e-real.mjs:184-297`

**Interfaces:**
- Consumes: `startWpStub(seed)` from `packages/connectors/test/helpers/wpStub.ts` (compiled via `tsx`), `POST /connectors` (`ConnectorCreateBodySchema`: `{ type: 'wordpress', name, config: WpConfig, schedule?, enabled? }`, `WpConfig = { baseUrl, username, applicationPassword, postTypes, categoryMap, webhookSecret(≥8) }`), `POST /connectors/:id/run` (`SyncRunResultSchema`), `CONNECTOR_HOST_ALLOWLIST` (`apps/api/src/config.ts:47`, comma-separated hosts), suggestions UI at `/sources/:id`.
- Produces: spec id `W4-E2E-3`; the gate starts the stub and exposes `E2E_WP_URL` to Playwright.

- [ ] **Step 1: The stub as a process**

`scripts/wp-stub.mjs`:
```js
#!/usr/bin/env node
/** Runs the connectors test WordPress stub as a standalone server for e2e:real. Prints `WP_STUB_URL=<url>`. */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register('tsx/esm', pathToFileURL('./'));
const { startWpStub } = await import('../packages/connectors/test/helpers/wpStub.ts');
const stub = await startWpStub([
  {
    id: 101,
    title: { rendered: 'נוהל WordPress לבדיקה' },
    content: { rendered: '<h2>מבוא</h2><p>סף מהירות: 5 מגה.</p><ul><li>בדיקת APN</li></ul>' },
    modified_gmt: '2026-09-01T00:00:00',
    link: 'http://wp/101',
    status: 'publish',
  },
]);
console.log(`WP_STUB_URL=${stub.url}`);
process.on('SIGTERM', () => stub.close().then(() => process.exit(0)));
setInterval(() => {}, 1 << 30);
```
(`tsx` is already a devDependency used by `pnpm --filter @wecom/api exec tsx`; run the stub with `pnpm --filter @wecom/api exec node ../../scripts/wp-stub.mjs` so `tsx/esm` resolves from that package.)

`scripts/e2e-real.mjs` — add a step between 2 and 3:
```js
  console.log('\n── 2b. wordpress stub ───────────────────────────────────────');
  const wp = start('wp', 'pnpm', ['--filter', '@wecom/api', 'exec', 'node', '../../scripts/wp-stub.mjs']);
  let WP_URL = '';
  await waitFor('wordpress stub url', async () => {
    return new Promise((resolve) => {
      const onData = (d) => {
        const m = /WP_STUB_URL=(\S+)/.exec(d.toString());
        if (m) {
          WP_URL = m[1];
          wp.stdout.off('data', onData);
          resolve(true);
        } else resolve(false);
      };
      wp.stdout.on('data', onData);
    });
  });
```
(the `start()` helper already pipes stdout; attach the parser **before** the pipe consumes it — move this block's listener registration into `start()` via an optional `onLine` callback: `function start(label, cmd, args, opts = {}, onLine)` and call `onLine?.(l)` in `pipe` next to `to.write`.)
In the API env (step 3) add `CONNECTOR_HOST_ALLOWLIST: '127.0.0.1,localhost'`. In the Playwright env (step 5) add `E2E_WP_URL: WP_URL`.

- [ ] **Step 2: Write the spec**

`apps/web/e2e/real/wordpress-source.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

/** W4-E2E-3 — PRD §8: a WordPress edit lands as a source version + review flag; the editor accepts/publishes; the push renders the source HTML. */
test.describe.configure({ mode: 'serial' });

const WP = process.env.E2E_WP_URL!;
const stamp = Date.now().toString(36);

test('W4-E2E-3 WordPress → source version → review flag → publish → push renders source HTML', async ({ page, request }) => {
  // 1. connector (admin session)
  const created = await request.post('/api/v1/connectors', {
    data: {
      type: 'wordpress',
      name: `wp-e2e-${stamp}`,
      config: { baseUrl: WP, username: 'e2e', applicationPassword: 'e2e-app-pw', postTypes: ['posts'], categoryMap: {}, webhookSecret: 'e2e-webhook-secret' },
      enabled: true,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const connectorId = ((await created.json()) as { id: string }).id;

  // 2. first run links post 101 → new-card suggestion → accept + publish → a document exists
  const run1 = await request.post(`/api/v1/connectors/${connectorId}/run`);
  expect(run1.ok()).toBeTruthy();
  await page.goto('/sources');
  await page.getByText('נוהל WordPress לבדיקה').first().click();
  await page.getByRole('button', { name: /אשר הכל|אשר/ }).first().click();
  await page.getByRole('button', { name: /פרסם/ }).click();
  await expect(page.getByText(/פורסמו|פורסם/)).toBeVisible({ timeout: 20_000 });

  // the source pane shows the WordPress HTML as the source document
  await page.goto('/library');
  await page.getByText('נוהל WordPress לבדיקה').first().click();
  await page.getByRole('button', { name: 'מקור' }).click();
  await expect(page.getByText('סף מהירות: 5 מגה.')).toBeVisible();
  const docUrl = page.url();

  // 3. edit in WordPress (stub) → run → source version 2 + review flag
  const edited = await request.post(`${WP}/wp-json/wp/v2/posts/101`, {
    data: { content: '<h2>מבוא</h2><p>סף מהירות: 6 מגה.</p><ul><li>בדיקת APN</li><li>ניתוק מ-Wi-Fi</li></ul>' },
  });
  expect(edited.ok()).toBeTruthy();
  const run2 = await request.post(`/api/v1/connectors/${connectorId}/run`);
  expect(run2.ok()).toBeTruthy();
  await page.goto(docUrl);
  await expect(page.getByText('נדרשת בדיקה')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'מקור' }).click();
  await expect(page.getByText('סף מהירות: 6 מגה.')).toBeVisible();
  await page.getByRole('button', { name: /גרסאות מקור/ }).click();
  await expect(page.getByRole('listitem', { name: /v2/ })).toBeVisible();

  // 4. editor decides the working view is unaffected → flag cleared
  await page.getByRole('button', { name: 'סמן כנבדק' }).click();
  await page.getByLabel(/הערה/).fill('אין השפעה על מסלול העבודה');
  await page.getByRole('button', { name: 'אישור' }).click();
  await expect(page.getByText('נדרשת בדיקה')).toHaveCount(0);

  // 5. an in-app source edit + publish pushes the *source HTML* to WordPress
  await page.goto(docUrl.replace('/doc/', '/edit/') + '/source');
  const editor = page.getByRole('textbox', { name: 'מסמך מקור' });
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(` נערך במערכת ${stamp}.`);
  await page.getByRole('button', { name: 'שמור גרסה' }).click();
  await page.getByLabel(/תיאור הגרסה/).fill('עריכה במערכת');
  await page.getByRole('button', { name: 'אישור' }).click();
  await expect(page.getByText(/נשמרה גרסת מקור/)).toBeVisible();
  await page.goto(docUrl.replace('/doc/', '/edit/'));
  await page.getByRole('button', { name: /פרסם v/ }).click();
  await page.getByRole('dialog').getByLabel(/מה השתנה/).fill('דחיפה ל-WordPress');
  await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click();
  await expect(page.getByText(/פורסם v/)).toBeVisible({ timeout: 20_000 });

  await expect
    .poll(async () => ((await (await request.get(`${WP}/wp-json/wp/v2/posts/101`)).json()) as { content: { rendered: string } }).content.rendered, { timeout: 20_000 })
    .toContain(`נערך במערכת ${stamp}`);
});
```
The suggestion-review buttons ("אשר", "פרסם") are the existing Sources page controls (`apps/web/src/components/sources/SourcesPage.tsx`, `SuggestionCard.tsx`) — read their labels and use the exact names. "סמן כנבדק" is W2's clear action on `SourceReviewBadge`; "גרסאות מקור" is W4's version list toggle in `SourcePane`.

- [ ] **Step 3: Run**

Run: `pnpm e2e:real -- --grep "W4-E2E-3"`
Expected: PASS. Then the whole gate: `pnpm e2e:real` → all previous specs plus W4-E2E-1..3 green.

- [ ] **Step 4: Commit**

```bash
git add scripts/wp-stub.mjs scripts/e2e-real.mjs apps/web/e2e/real/wordpress-source.spec.ts
git commit -m "test(e2e): real WordPress source round trip — stub in the gate, source version + review flag, push renders source HTML"
```

---

### Task 10: Final gate, acceptance matrix, ledger

**Files:**
- Create: `docs/wave4-acceptance.md`
- Modify: `docs/superpowers/plans/README.md`, `.superpowers/sdd/program/progress.md`

**Interfaces:**
- Produces: the PRD v1 → test-id matrix; the ledger line "Wave 4 complete on main <sha>"; the parked list.

- [ ] **Step 1: Run the full gate**

```bash
pnpm -r build && pnpm -r test
cd apps/api && RUN_INTEGRATION=1 pnpm test:int && cd ../..
pnpm openapi && git diff --exit-code docs/api/openapi.json apps/web/src/api/schema.d.ts
pnpm lint
pnpm e2e:real
```
Expected: everything green. Record the counts (files/tests) for the ledger.

- [ ] **Step 2: Write the acceptance matrix**

`docs/wave4-acceptance.md`:
```md
# Wave 4 acceptance — PRD "גרסה ראשונה תכלול" → evidence

| PRD v1 bullet | Where | Evidence (test id / file) |
|---|---|---|
| ניהול עולמות תוכן ונושאים | W1 | `apps/api/test/taxonomy.test.ts` (CRUD, reorder, deactivate 409), W4-E2E-2 (admin adds world+topic, sidebar updates) |
| יצירה וניהול של פריטי ידע (סוגים M/R/O/E/S/T/I, תגיות, מקור מלא) | W1, W4 | `apps/api/test/taxonomy.test.ts` (docType/tags/text kind, scripts fold up/down), `apps/api/test/source-documents.test.ts` (save/version/import/export/sanitize), W4-E2E-2, W4-E2E-3 |
| קישור בין פריטי ידע | existing L2 + W1 | `apps/api/test/documents.test.ts` (links/related), W4-E2E-2 (topic prev/next), `wave4-mounts.test.tsx` "prev/next inside the topic" |
| תצוגת עבודה לנציג (תצוגת נושא, מעבר בין סוגים) | W1, W6 | `apps/api/test/taxonomy.test.ts` (topic view groups in PRD order), `wave4-mounts.test.tsx` (article/library), W4-E2E-2 |
| חיפוש, תגיות וסינון | W1 | `apps/api/test/search.test.ts` (tag group, world/topic/docType/tag filters), W4-E2E-2 (tag search, tag URL filter) |
| הרשאות צפייה ועריכה (פורסם בלבד לצפייה, בעלים/עורך/מאשר) | W2 | `apps/api/test/governance.test.ts` (visibility on list/get/related/links/search/topic, 404 NOT_PUBLISHED, owner/editor/approver, 409 ONCE_PUBLISHED, purge skip), `wave4-seams.test.ts` (approver_id, backlinks), W4-E2E-2 (agent cannot open a draft) |
| ניהול גרסאות וסטטוסים (לא בתוקף, ארכיון, קשר גרסת מקור↔גרסת עבודה) | W2, W4, W6 | `apps/api/test/governance.test.ts` (status route + audit reason), `wave4-seams.test.ts` (source_version), W4-E2E-3 (source v2 + review flag + clear) |
| מנגנון משוב (7 סוגים, הקשר אוטומטי, תור עורכים, 5 סטטוסים, קשר לגרסה, התראות, אנליטיקה) | W3 | `apps/api/test/feedback.test.ts` (create auto-context, queue filters+counts, patch, resolve, publish resolveFeedbackIds, analytics math, alerts dedupe via Notifier fake), `wave4-seams.test.ts` (notification kinds), W4-E2E-1 |
| נתוני שימוש בסיסיים (כניסות, משתמש, חיפושים, חיפושים ללא תוצאה, הנצפים ביותר, נושאים, תאריכי עדכון) | W5 | `apps/api/test/usage.test.ts` (search_log row per search, zeroOnly, topic_views via UsageRecorder, /analytics/usage shape), W4-E2E-1 (analytics page) |

Deferred (spec §8): briefings, quizzes, learning completion, knowledge-refresh prompts; approver role activation beyond fields + `docs.publish`.
```
Fill the test file names with the real ones from the merged lanes (`ls apps/api/test | grep -E 'taxonomy|governance|feedback|source|usage'`); every row must point at a file that exists and a test that passed in Step 1.

- [ ] **Step 3: Parked items and ledger**

Append to `docs/wave4-acceptance.md` a `## Parked` section listing every item logged in `docs/wave4-merge-log.md` that was consciously left (e.g. the `/scripts*` adapters still consumed by `useScripts`; the frontend I10 pin-state item from wave 2), each with the same "Ruling / cost if wrong" shape the ledger uses.

`docs/superpowers/plans/README.md`: under the Wave 4 table add `Acceptance: docs/wave4-acceptance.md · Merge log: docs/wave4-merge-log.md`.

```bash
git add docs/wave4-acceptance.md docs/superpowers/plans/README.md
git commit -m "docs(w6): wave 4 acceptance matrix and parked items"
echo "Wave 4 complete on main $(git rev-parse --short HEAD): W0–W6 merged; api test:int <N files>/<M tests> green; pnpm e2e:real <K>/<K> green incl. W4-E2E-1..3; acceptance matrix docs/wave4-acceptance.md. Not pushed." >> .superpowers/sdd/program/progress.md
git add .superpowers/sdd/program/progress.md && git commit -m "chore(ledger): wave 4 complete"
```

---

## Self-review

- **Spec coverage.** §6 isolation/merge order → Task 1; §5.3 sidebar/topic nav → Task 2; §5.1 pane modes + source pane, §5.4 feedback button per step/header, §5.5 status chips + unavailable page, §5.3 badge/tags/prev-next → Task 3; §5.3 facets in URL, §5.5 status menu gating → Task 4; §5.3 metadata panel, §5.1 editor entry + import/export, §5.4 publish picker, text-kind items → Task 5; §5.2 `source_version` linkage, review approver, backlinks visibility, alert kinds, telemetry kinds, SSE → Task 6; §7 e2e flows 1–3 → Tasks 7–9; §9 acceptance → Task 10. The `/scripts*` deprecation rule is in Task 6.
- **Placeholders.** None: every mount step shows the JSX, every test shows the code, every command shows the expected result. The two places that say "use the shipped name" (Task 1 table, locator names) are explicit verification steps, not TODOs.
- **Type consistency.** `PublishOptions.sourceVersion` (Task 6) matches the `publishDocument` call in the seams test; `StepCtx.onFeedback` is added in Task 3 and consumed in the same task; `sendTelemetry(kind, extra)` signature is used identically in Task 6's two call sites; `createUser`/`signInAs` signatures match across Tasks 7–8; test ids `W4-E2E-1..3` are identical in the specs and the acceptance matrix.
