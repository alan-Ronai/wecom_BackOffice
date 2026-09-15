# Wave 5 merge log — `wave5/integration`

Five lanes, merged in the plan's order on top of `main`, then every mount, seam and follow-up the
lanes were forbidden to make. This file is the record of what was merged, what the real names
turned out to be, and every deliberate deviation from `docs/superpowers/plans/2026-09-15-V6-integration.md`.

## Lanes merged

| Lane | Branch | Head | Scope | Report |
|---|---|---|---|---|
| V1 | `worktree-agent-aae33f36b9ad37211` | `c77b12c` | learning content: items, briefings, quizzes, generation, publish (0039) | `.superpowers/sdd/program/V1-report.md` |
| V4a | `worktree-agent-a2ffed0b25de876bc` | `9924ecb` | the learner's web surface: my learning, briefing reader, quiz player, refresh banner, badge | `V4a-report.md` |
| V3 | `worktree-agent-aadcb4b261a2b42b1` | `32d171d` | knowledge gaps, approver gate, `GET/PUT /admin/workflow` (0041) | `V3-report.md` |
| V2 | `worktree-agent-a9b5cd118d2534681` | `8cb306f` | tracking: audiences, assignments, attempts, completion, significant change (0040) | `V2-report.md` |
| V4b | `worktree-agent-aedc99a9b77b7c3b3` | `5082c3b` | the manager's web surface: builder, assign, dashboard, gaps page, workflow settings | `V4b-report.md` |

`main` was merged four times as it moved under us (pilot-readiness app lane, hardening lane 0045,
the pipeline fan-out, the proxy-trust lane). Migrations on this branch are exactly 0037 (wave 3),
0038–0041 (V0–V3), **0042 (V6)** and main's own 0043–0045.

## Conflicts and how they were resolved

| File | Conflict | Resolution |
|---|---|---|
| `apps/api/src/modules/index.ts` | three lanes appended a module | all three kept, alphabetical within wave 5: `gaps`, `learning`, `learningTracking` |
| `packages/shared/src/wave4/notifier.ts` | V2 widened `NotifyInput.kind` with `learning \| gap`, V3 with `gap` | kept the union of both |
| `packages/shared/src/schemas/wave5.ts` | V1 and V2 both appended a block at the end | both kept, in lane order |
| `docs/api/openapi.json` | generated | regenerated after every merge (`pnpm openapi`) |
| `apps/api/test/migrations.test.ts` | V2, V3, V6 and main all rewrote the wave-4 rollback count | one copy, main's wording (see the defect below) |
| `apps/web/src/routes.tsx` | V4a and V4b both appended learning routes | merged with every `learning/manage*` **before** `learning/:assignmentId` |
| `apps/web/test/msw/handlers.ts` | both web lanes export `resetLearningState` and both stub `/documents/:id/learning` | V4b's reset imported under an alias; one stub survives (below) |
| `apps/web/src/api/keys.ts` | both web lanes added a `learning` block | merged into one block; `keys.learning.forDocument` dropped as dead |
| `apps/web/src/components/article/Panel.tsx` | V6's learning block against main's `count.ts` import | both kept |
| `apps/web/test/feedback/FeedbackButton.test.tsx` | main landed its own A-4 test while V6 was writing one | main's kept; V6's removed as redundant (main's asserts the `TypeBadge`, which is what A-4 became) |

## Defects found and fixed during integration

1. **`migrations.test.ts` › "a wave-4-only rollback leaves 0027 in force"** failed on every lane
   branch. The guard sized its rollback from `/^003[0-9]_/`, which stopped short of 0030 — the
   migration that drops 0027's Hebrew stopword filter — as soon as wave 5 added 0040+. Reproduced
   against `main` (0030..0038, count 9, still correct there): the regression is the counting
   heuristic, not migration 0037 or its `down`. Now counts every migration numbered ≥ 0030.
2. **Two MSW stubs for `GET /documents/:id/learning`.** msw takes the first match, so V4b's
   manager filter was silently reading V4a's static state. One stub survives, in
   `learning-handlers.ts`: the refresh half comes from `docLearning`, the `items` half is derived
   from the manager state (`itemsReferencing`), which is the only place an item's document anchors
   live.
3. **Two `useDocumentLearning` hooks** keyed differently, so the article badge and the manager list
   could not share a cache entry. V4a's survives; `learningManage.ts` re-exports it and
   `invalidateLearning` moves `['learning','doc']` instead of a key nothing read.
4. **`W4-E2E-1` broke on the new publish dialog.** It ticked `getByRole('checkbox').first()`, which
   became the significant-change flag, so the feedback report was never closed. Both the unit and
   the real spec now pick inside the feedback group. Same class of bug in `wave4-mounts.test.tsx`.
5. **The assign dialog's fieldset legend contains "עולמות תוכן"**, so a substring group match in
   W5-E2E-1 landed on the roles group and ticked a role instead of a world.
6. **The quiz player can lose a selection mid-quiz** when the assignment's own notification arrives
   over SSE and the player payload refetches. W5-E2E-1 re-ticks until the advance button enables.
   Logged for V4a rather than fixed here — see "parked" in `docs/wave5-acceptance.md`.
7. **`POST /auth/local` is five attempts a minute per IP** and the whole real-e2e gate shares that
   budget; wave 5's two specs pushed it over. `signInAs` now waits the window out instead of
   reading a refusal as a failed login, the per-test timeout is 150 s, and the two new specs sign
   in twice between them (the admin of the storage state plays the manager and the requester).

## Verified import table

Every later task imported from this table, not from the plan's assumptions.

| From | Name | Path |
|---|---|---|
| V1 | `getItem`, `listCards`, `assembleCard(q, id)`, `listItemsReferencing`, `needsUpdateFor`, `publishItem` | `apps/api/src/modules/learning/repo.ts` |
| V2 | `applyChangeFlag(tx, deps, input)`, `detectSignificantChange`, `createAssignments`, `resolveAudience` | `apps/api/src/modules/learning/tracking/{refresh,changeDetector,audiences}.ts` |
| V2 | `getPublishedItem`, `itemsReferencing`, `itemSourceVersions`, `assignmentStats`, `needsUpdate` | `apps/api/src/modules/learning/tracking/itemsPort.ts` (real SQL over V1's tables, never a stub) |
| V3 | `APPROVER_ROLE`, `canApprove`, `assertCanApprove`; `runDetection`; `listGaps` | `apps/api/src/modules/{collab/approver,gaps/*}.ts` |
| V3 | `GET/PUT /admin/workflow` (GET at `docs.read`), `canApprove` on review rows | `apps/api/src/modules/admin/workflow.ts`, `collab/reviews.ts` |
| V4a | `MyLearningPage`, `AssignmentPage`, `AssignmentCard`, `BriefingReader`, `QuizPlayer`, `RefreshBanner`, `LearningBadge` | `apps/web/src/components/learning/*` |
| V4a | `useMyLearning(enabled)`, `usePlayerItem`, `useAcknowledge`, `useStartAttempt`, `useSubmitAttempt`, `useDocumentLearning(id, enabled)` | `apps/web/src/api/hooks/learning.ts` |
| V4b | `LearningManagePage`, `LearningItemEditor`, `QuizBuilder`, `BriefingBuilder`, `AssignDialog`, `CompletionDashboard`, `GapsPage`, `WorkflowSettingsSection` | `apps/web/src/components/{learning/manage,gaps,admin}/*` |
| V4b | `useLearningItems`, `useLearningItem`, `usePublishLearningItem`, `useAssignUsers`, `useCompletion`, `useLearningDashboard`, `useGaps`, `useWorkflowSettings` | `apps/web/src/api/hooks/{learningManage,gaps,workflow}.ts` |
| V6 | `useChangePreview`, `useAudienceOptions` | `apps/web/src/api/hooks/{learning,learningManage}.ts` |

Copy that differs from the plan's draft, and what the mounts assert instead:

- `RefreshBanner` says **"רענון ידע נדרש"** in a `role="status"` region (V6 added the matching
  `aria-label` so the region itself is addressable) and links **"למטלת הרענון"**, not "לרענון".
- `LearningBadge` is a manager chip counting items (**"כלול ב-N פריטי למידה"**), gated on
  `learning.manage`, not a "בתדריך/בשאלון" reader chip.
- The sidebar entry is **"הלמידה שלי"**; the section is `nav aria-label="למידה"`.
- The workflow card's heading region is **"תהליך עבודה ולמידה"** and its checkbox is
  **"דרוש מאשר לפרסום"**.
- `DocumentLearning` is `{ items, refreshRequired, refreshAssignmentId, lastSignificantChange }`
  and `items` are `LearningItemCard`s keyed `id`, not `itemId`.

## Deliberate deviations

1. **`POST /learning/items/:id/publish` answers `{ item, version }`** (`LearningPublishResponseSchema`),
   per V1's ruling and the plan's own route table. `docs/api/CONTRACTS-wave5.md`'s row naming
   `LearningVersionSchema` is superseded; the version history is still at
   `GET /learning/items/:id/versions`.
2. **`GET /documents/:id/change-preview` is V6's** (the plan's Task 4 decision, taken because V2 did
   not ship it). `docs.publish`, read-only, returns `ChangePreviewSchema`; the publish dialog
   pre-ticks from it instead of computing a client-side diff.
3. **`GET /learning/audience-options` is new** (controller ruling). The assign dialog read
   `GET /admin/roles`, which needs `roles.manage`; a lead holding only `learning.manage` therefore
   saw an empty audience picker against the real API while the MSW fixture answered happily.
4. **`0042_wave5_fixups.js`** (not `0042_wave5_seams.js`) adds the `learning_items` foreign keys
   0040 could not declare. It does **not** add an `asset_refs` trigger: `learning_items.description`
   is the only wave 5 HTML column, and it is edited by `RichText … compact`, which drops the image
   extension precisely because the learning surface has no asset pipeline. Nothing can reference
   `/api/v1/assets/…` from there. `briefing_entries.note` and `quiz_questions.*` are plain text.
5. **`perf-rewrite.ts` runs in reverse.** `docs/perf.md`'s two search proposals landed in
   `repo.ts`, so the A/B harness cannot be "current → candidate" any more; it reconstructs the
   pre-V6 predicate from the statement the code now emits (`rewriteUnionToLegacy`) and measures
   against that. `perf:sql` still proves row-identical results.
6. **The `w5` bridge and `learningRequest` are gone.** All 23 wave 5 web calls go through the
   generated client; `checked(...)` still validates every response against the shared zod contract.
7. **V4a's stylesheet block was written by V6** (`apps/web/src/styles/app.css`), from the existing
   tokens, because the lane could not touch a shared file. V4b had already written its own.
8. **F-4 was dropped**: already closed on `main` (`ef91db8`). **A-4** is closed by main's own
   `TypeBadge` change and its test; V6's duplicate assertion was removed. **E-1** is V6's, in
   `publishDocument` with an integration test in `wave5-seams.test.ts`.
