# Wave 4 — W6 merge log

Integration branch: `wave4/integration`, cut from `main` `b26a3d7`. Every lane merged with
`--no-ff`; the controller's order was followed exactly, with W1-api first (it landed while W6 was
still reading the lane reports, so nothing had to be re-ordered).

## Lanes merged

| # | Lane | Branch | Head | Report |
|---|---|---|---|---|
| 1 | W1-api — taxonomy backend | `worktree-agent-a3a1bd48b0de97f6e` | `b176638` | `.claude/worktrees/agent-a3a1bd48b0de97f6e/.superpowers/sdd/program/W1-api-report.md` |
| 2 | W1-web — taxonomy web | `worktree-agent-a395902a3ba3a6003` | `e4f94fa` | `…/agent-a395902a3ba3a6003/…/W1-web-report.md` |
| 3 | W2-api — governance backend | `worktree-agent-a238cb5691ebcd944` | `74eb439` | `…/agent-a238cb5691ebcd944/…/W2-api-report.md` |
| 4 | W2-web — governance web | `worktree-agent-ab12390a7379de1f4` | `ba2143b` | `…/agent-ab12390a7379de1f4/…/W2-web-report.md` |
| 5 | W4-api — source documents backend | `worktree-agent-a0d8b6043d6c873f1` | `39e50a5` | `…/agent-a0d8b6043d6c873f1/…/W4-api-report.md` |
| 6 | W4-web — source documents web | `worktree-agent-a2b2e47c89644380b` | `9dd8a72` | `…/agent-a2b2e47c89644380b/…/W4-web-report.md` |
| 7 | W3-api — feedback backend | `worktree-agent-a41ffe9cb83c884e7` | `a2e60bb` | `…/agent-a41ffe9cb83c884e7/…/W3-api-report.md` |
| 8 | W3-web — feedback web | `worktree-agent-a98ec853a0f7d0d6b` | `b5b6c2c` | `…/agent-a98ec853a0f7d0d6b/…/W3-web-report.md` |
| 9 | W5-api — usage analytics backend | `worktree-agent-adb7256f09da7fefe` | `935cea6` | `…/agent-adb7256f09da7fefe/…/W5-api-report.md` |
| 10 | W5-web — usage analytics web | `worktree-agent-af1519a33c02eb11c` | `2d4bfca` | `…/agent-af1519a33c02eb11c/…/W5-web-report.md` |
| — | wave 3 backend fix wave (from `main`) | `main` | `240c37c` | `.superpowers/sdd/program/fix-wave3-backend-report.md` (main checkout) |

W0 (`worktree-agent-aee8208d3d3c5ab63`, `4474311`) was already on `main` as `6259607`.

## Conflicts and how they were resolved

Every "append-only" conflict (module list, routes, keys, msw handlers, migration test cases,
fixtures) was resolved by keeping **both** sides. Only the entries below needed a judgement.

| File | Sides | Ruling |
|---|---|---|
| `packages/shared/src/schemas/api.ts` | W1 `.merge(TaxonomyWriteFields)` vs W2 `.extend({ ownerId, editorId })` on `PatchDocumentBodySchema` | both, in that order (`.merge(...).partial().extend(...)`) — the contract lists all seven fields |
| `apps/api/src/modules/documents/repo.ts` (assemble) | W1 `select * from documents` + world/topic rows vs W2 owner/editor/approver name joins | W2's joined query, W1's two membership queries kept alongside; both field blocks in the mapper |
| `apps/api/src/modules/documents/repo.ts` (`listCards`) | W1 `worldScopes` + taxonomy filters vs W2 `categoryScopes` + `readUnpublished` | `worldScopes` (spec: scopes are worlds now) **and** `readUnpublished`; the `d.category = any(...)` scope term is dropped in favour of W1's `document_worlds` exists-clause |
| `apps/api/src/modules/search/repo.ts` | W1 `stepTax`/`docTax` vs W2 `visTerm` | both terms appended to every group's `where`; W6 additionally applied `visTerm` to the W1 `tags` and `scripts` groups, which W2 could not see |
| `apps/api/src/modules/search/routes.ts` | W2 `canReadUnpublished` vs W5 fire-and-forget `recordSearch` | both, on `user.worldScopes` |
| `apps/api/src/modules/trash/repo.ts` | W1 dropped the `scripts` table from the purge list; W2 added the once-published guard | W1's table list, W2's guard |
| `apps/api/src/modules/sources/index.ts` | W2 `onIngested` hook vs W4 `app.decorate('revisions', …)` | both |
| `apps/api/src/modules/documents/routes.ts` (backlinks) | W2 visibility filter vs the wave 3 fix wave's `inboundFor(..., scopes)` | both: `getVisibleDocument` + scoped `inboundFor` + the published-only post-filter for readers |
| `apps/api/src/modules/graph/repo.ts` | W1 reads scripts from type-T documents / `document_links`; the fix wave scoped every documents-joining query | W1's queries with the fix wave's `${inScope}` predicate appended |
| `apps/api/src/modules/search/repo.ts` (rank) | W1 kept `toPrefixTsQuery`; the fix wave replaced it with `kb_tsquery_prefix` (migration 0027) | the fix wave's — 0027 shares one stopword definition between index and query |
| `docs/api/openapi.json` | every api lane | never hand-merged; regenerated with `pnpm openapi` after each api merge |
| `pnpm-lock.yaml` | W4-web's TipTap deps | took the lane's file and re-ran `pnpm install` |

## Lane defects fixed on the integration branch

| What | Why | Where |
|---|---|---|
| Duplicate wave-4 field blocks in `EditorPage.tsx` / `test/msw/fixtures.ts` | four lanes carried the same "droppable" W0 compatibility commit; `main` already had the real fix (`baa988a`), so the merge produced duplicate object keys | `fix(web): drop W1-web's duplicate wave-4 field block …` and the W2-web / W4-web / W3-web merge commits |
| `apps/api/test/migrations.test.ts` and `apps/api/test/search.test.ts` lost a closing `});` | three lanes appended an `it(...)` at the same anchor; the union of the two sides dropped the brace that had been common text | `fix(api): repair merge damage in the shared test files …` |
| `test/usage.test.ts` created its own `worlds`/`topics` tables | W5-api wrote it before W1's migration existed; the tables are real now | same commit |
| `test/search.test.ts` asserted the whole `search_log` | every search in the file is logged now, so the row set is not just this test's | same commit |
| `AnalyticsPage` world filter read `CategorySchema.options` | W1 widened `Category` to a slug string, so the enum has no `.options`; the filter is `useWorlds()` now | W5-web merge commit |
| `stageJson` / `stageVoid` had been deleted from `apps/web/src/api/stage45.ts` by the wave 3 web integration, but four wave-4 web lanes import them | restored as an explicitly temporary wave-4 bridge; see "Parked" in `docs/wave4-acceptance.md` | W2-web merge commit |
| Scope predicates in `graph`/`fields`/`blocks`/`dashboards` matched `documents.category` | W1 made scopes *world* scopes and a document can belong to several worlds; they now test `document_worlds` membership, and the routes pass `user.worldScopes` | main-merge commit |

## Verified lane import table

The paths the W6 plan assumed, corrected to what actually shipped.

| Import | Real path | Notes |
|---|---|---|
| `useWorlds`, `useTopics`, `useTopicView`, `useTags` (+ the eight taxonomy mutations) | `apps/web/src/api/hooks/taxonomy.ts` | `useWorlds()` resolves to `World[]`, `useTopics()` to `Topic[]` — arrays, **not** `{ items }` |
| `TypeBadge`, `worldShort`, `worldLabel` | `apps/web/src/components/taxonomy/TypeBadge.tsx` | `{ docType, compact? }` |
| `TaxonomyFacets`, `TaxonomyFacetValue` | `apps/web/src/components/taxonomy/TaxonomyFacets.tsx` | value is `{ docType: DocType \| null; tags: string[] }` — **not** the plan's `{ world, topic, docType, tag }`, and the component is not named `DocTypeFacets` |
| `TopicPage` | `apps/web/src/components/taxonomy/TopicPage.tsx` | route `/topic/:id` already registered by W1-web |
| `MetadataPanel`, `MetadataValue` | `apps/web/src/components/editor/MetadataPanel.tsx` | **not** `components/taxonomy/`; props are `{ value, onChange, disabled? }`, not `{ doc, onChange }` |
| `TaxonomyPage` | `apps/web/src/components/admin/TaxonomyPage.tsx` | route `/admin/taxonomy` already registered |
| `StatusChip` | `apps/web/src/components/governance/StatusChip.tsx` | `{ status }` |
| `useStatusMenuItems`, `StatusActions`, `StatusMenuDoc` | `apps/web/src/components/governance/StatusMenu.tsx` | the headless form is `useStatusMenuItems()` → `(doc) => MenuItem[]`; there is no `StatusMenu` component and no `statusMenuItems` function |
| `SourceReviewBadge`, `SourceReviewDoc` | `apps/web/src/components/governance/SourceReviewBadge.tsx` | `{ doc }` |
| `OwnerFields`, `OwnerFieldsDoc`, `OwnerPatch` | `apps/web/src/components/governance/OwnerFields.tsx` | `{ doc, onChange }` |
| `UnavailablePage` | `apps/web/src/components/governance/UnavailablePage.tsx` | no props |
| `useSetStatus`, `useClearSourceReview`, `useReadOnlyReader` | `apps/web/src/api/hooks/governance.ts` | |
| `FeedbackButton` | `apps/web/src/components/feedback/FeedbackButton.tsx` | `{ documentId, documentVersion, stepKey?, size? }` — `documentVersion` is **required**; the component owns its modal, so there is no separate `FeedbackModal` |
| `PublishFeedbackPicker` | `apps/web/src/components/feedback/PublishFeedbackPicker.tsx` | `{ documentId, value, onChange }`; renders `null` when there is no open feedback |
| `FeedbackPage`, `FeedbackDrawer`, `FeedbackAnalyticsTab` | `apps/web/src/components/feedback/*.tsx` | routes `/feedback`, `/feedback/analytics`, `/feedback/:id` already registered |
| `useDocumentFeedback`, `useFeedbackList`, … | `apps/web/src/api/hooks/feedback.ts` | there is **no** `useOpenFeedbackCount`; the sidebar badge comes from `useFeedbackList({ pageSize: 1 }).data.counts` |
| `PaneModeToggle`, `PaneMode` | `apps/web/src/components/source/PaneModeToggle.tsx` | `{ value, onChange, hasSource }` — `hasSource` is required |
| `SourcePane` | `apps/web/src/components/source/SourcePane.tsx` | `{ documentId, canEdit, sourceId?, latestRevisionId? }` — `canEdit` is required |
| `SourceHistory` | `apps/web/src/components/source/SourceHistory.tsx` | `{ documentId, canEdit }` |
| `SourceEditor`, `SourceEditPage` | `apps/web/src/components/source/*.tsx` | `SourceEditor` is `{ documentId, onSaved? }` — **no** compact mode and no `value`/`onChange`; route `/edit/:id/source` already registered |
| `ImportExportButtons` | `apps/web/src/components/source/ImportExportButtons.tsx` | `{ documentId, canEdit, hasSource }` — a fragment of buttons, no wrapper |
| `useSourceDocument`, `useSourceDraft`, `exportDocxUrl`, `rawRevisionUrl`, … | `apps/web/src/api/hooks/sourcedocs.ts` | |
| `AnalyticsPage`, `useUsageAnalytics`, `useSearchLog` | `apps/web/src/components/analytics/AnalyticsPage.tsx`, `apps/web/src/api/hooks/usage.ts` | route `/analytics` already registered |
| `visibilityWhere`, `canReadUnpublished`, `VISIBLE_TO_READERS` | `apps/api/src/lib/visibility.ts` | |
| `getVisibleDocument`, `setStatus`, `hasPublishedVersion` | `apps/api/src/modules/documents/repo.ts` | |
| `currentSourceVersion` | `apps/api/src/modules/sourcedocs/repo.ts` | |
| `PgNotifier` | `apps/api/src/modules/feedback/notifier.ts` | |
| `PgUsage` | `apps/api/src/modules/usage/recorder.ts` | |
