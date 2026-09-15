# Wave 5 merge log — `wave5/integration`

Five lanes, merged in the plan's order on top of `main`, then every mount, seam and follow-up the
lanes were forbidden to make. This file is the record of what was merged, what the real names
turned out to be, and every deliberate deviation from `docs/superpowers/plans/2026-09-15-V6-integration.md`.

## Lanes merged

| Lane | Branch | Head | Scope | Report |
|---|---|---|---|---|
| V1 | `worktree-agent-aae33f36b9ad37211` | `c77b12c` | learning content: items, briefings, quizzes, generation, publish (0046) | `.superpowers/sdd/program/V1-report.md` |
| V4a | `worktree-agent-a2ffed0b25de876bc` | `9924ecb` | the learner's web surface: my learning, briefing reader, quiz player, refresh banner, badge | `V4a-report.md` |
| V3 | `worktree-agent-aadcb4b261a2b42b1` | `32d171d` | knowledge gaps, approver gate, `GET/PUT /admin/workflow` (0048) | `V3-report.md` |
| V2 | `worktree-agent-a9b5cd118d2534681` | `8cb306f` | tracking: audiences, assignments, attempts, completion, significant change (0047) | `V2-report.md` |
| V4b | `worktree-agent-aedc99a9b77b7c3b3` | `5082c3b` | the manager's web surface: builder, assign, dashboard, gaps page, workflow settings | `V4b-report.md` |

`main` was merged four times as it moved under us (pilot-readiness app lane, hardening lane 0045,
the pipeline fan-out, the proxy-trust lane). Migrations on this branch are exactly 0037 (wave 3),
0038 (V0), main's own 0043–0045, and then **0046–0048 (V1–V3) and 0049 (V6)**.

> **Renumbered in the fix wave (A-C3).** The lanes authored V1–V3 as 0039–0041 and V6 as 0042,
> which sit *below* main's already-applied 0043–0045. `migrate.ts` passes `checkOrder: true` and
> `server.ts` runs the migration at boot, so on any database that had already applied the pilot
> and hardening lanes the API would have refused to start with "Not run migration
> 0039_learning_content is preceding already run migration 0043_telemetry_client_error".
> `migrations.test.ts` could not catch it: it always builds a fresh database and runs every file
> in filename order. The tables are new, so no deployed database has them and the renumber is a
> pure rename — the check stays on.

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
   migration that drops 0027's Hebrew stopword filter — as soon as wave 5 added 0046+. Reproduced
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
   Fixed in the fix wave (selection persists across refetch).
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
4. **`0049_wave5_seams.js`** adds the `learning_items` foreign keys
   0047 could not declare. It does **not** add an `asset_refs` trigger: `learning_items.description`
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

## Main merged into `wave5/gate`

`wave5/gate` branched from `wave5/integration` at a488fbd and merged `main` twice — at 4aaeb27, and
again at 53e0be1 when main moved while the gate was running. **Both merges were clean.** Every file
the plan flagged as a likely conflict came through untouched, because `wave5/integration` had
already absorbed main past the last commit that edited them:

- `apps/api/migrations/0043_telemetry_client_error.js` — byte-identical to main's amended version
  (nullable `path`/`message`). No wave 5 copy to reconcile.
- `packages/shared/src/events.ts`, `permissions.ts`, `apps/api/src/plugins/boss.ts`,
  `apps/web/src/routes.tsx`, `keys.ts`, `apps/web/test/msw/handlers.ts` — all append-only files,
  none of them touched by the 59 commits main added. Wave 3 entries still precede wave 5 entries;
  `events.test.ts` and `permissions.test.ts` needed no reordering.
- `apps/api/test/migrations.test.ts` — both counting rules intact, wave 5 at 0046–0049 above main's
  0043–0045.

What the 59 commits brought in, and what it meant for wave 5:

| From main | Wave 5 impact |
|---|---|
| CSP with no `unsafe-inline`; the pre-paint theme script moved to `apps/web/public/theme-init.js` | None. `apps/web/index.html` now has only `src=`-based scripts, and the wave 5 UI adds no inline script. |
| Production secret guard rejects placeholder / low-entropy `SESSION_SECRET` and `CONNECTOR_KEY` | None. No wave 5 fixture sets either; the only placeholders left are `DEV_SESSION_SECRET` in `config.ts` and the strings `env-example.test.ts` deliberately feeds the guard. |
| `telemetry_events` carries `path` / `message` (0043 amended in place) | None — additive columns. |
| `ConnectorTypeInfoSchema.configSchema` is strict JSON Schema | None. Wave 5 does not render a connector config. |
| Connector wizard carries a configuration; self-hosted Hebrew fonts; `wordpress-wizard.spec.ts` | The real e2e run grows from 14 specs to 15 (16 with `E2E_OIDC=1`). |
| `scripts/lib/ports.mjs`, e2e secrets generated per run | The gate's own port overrides still apply. |

### Fixes made on `wave5/gate`

Only one commit beyond the two merges — 2fc984d, the re-review residuals. None of it was merge
fallout; the merged tree was green before it and after it.

1. `QuizBuilder.tsx`'s generation toast hand-rolled its plural. It now reads
   `counted(n, questions, 'נוצרה', 'נוצרו')` from `lib/count.ts`, which is the one place the wording
   lives (A-3). The noun is imported as `questionsCount` because the component already has a
   `questions` state variable.
2. `BriefingBuilder.tsx` kept a local `move`. It imports the shared one from `lib/learning.ts`,
   which the quiz builder and the player already use — and which additionally guards `i` out of
   range, where the local copy only guarded `j`.
3. Defect 6 above said the lost-selection bug was logged for V4a; it was fixed in the fix wave.
4. `publishWithFlag.ts`'s header records a third deliberately-excluded publish path:
   `documents/repo.ts`'s `restoreVersion` (`kind: 'restore'`). A rollback records no change flag
   because the version it restores was already flagged when it was first published. The matching
   row in `docs/wave5-acceptance.md` was widened to match.
5. `setPublishFlagDeps` takes the deps **thunk** rather than a by-value snapshot, so a notifier
   swapped after `learningTrackingModule` registers is honoured. Captured by value, the holder froze
   whatever `app.notifier` was at registration and a swapped test double was silently ignored.
6. `gaps/detect.ts` only calls `pg_advisory_unlock` when `pg_try_advisory_lock` actually returned
   true. Unconditionally unlocking a lock the session never took makes Postgres log "you don't own a
   lock of type ExclusiveLock" on every throttled concurrent click.

### Declined

`CompletionDashboard.tsx`'s `RISKY` CSV guard was asked to drop `-` from its leading-character set,
on the grounds that no exported column can be negative. The set is not about negative numbers: the
first exported column is `displayName`, which a user sets, and a leading `-` is a live formula
trigger in Excel and Sheets (`-1+cmd|'/c calc'!A0`) listed alongside `=`, `+` and `@` in the OWASP
CSV-injection set. Dropping it would reopen exactly the hole the comment above the regex describes,
and the guard costs one regex test per cell. Left as it was; raise it again if the intent was
something other than the injection set.

### `learning_items.description` was never sanitized

Found while verifying the CSP after the second main merge, fixed in 835d8a8. The column is rich
text, `ItemPreview.tsx` renders it with `dangerouslySetInnerHTML`, and its comment already claimed
the value was "Sanitised server-side, like every other rich-text body the app renders" — but neither
`createItem` nor `patchItem` cleaned it. Same class as wave 4's C-C2, and resolved the same way: a
`cleanDescription` at the repo boundary rather than in the routes, so no caller can forget, matching
`documents/repo.ts`'s `cleanBody` and `sourcedocs/repo.ts`'s `saveSourceDocument`. It covers the
publish snapshot for free, because `publishItem` builds its snapshot from `getItem`.

`briefing_entries.note` and the `quiz_questions` columns were checked and deliberately left alone:
they are plain text rendered as text (`{e.note}` in `BriefingReader` and `ItemPreview`, `{q.stem}` in
the players), so React escapes them and an HTML sanitizer would only corrupt a note that mentions
`<` or `&`.

`learning.test.ts` gains a case that sends `<p onclick="x()">a<script>alert(1)</script></p>` through
both the create and the patch route, asserts `<p>a</p>` on both, and then reads the column itself —
the point of the ruling being that whatever reads the row next does not have to remember.

### Known flake seen on this branch

`apps/web/test/integration/wave4-mounts.test.tsx` → "edits a text-kind item as a body, not as steps"
(the TipTap race) failed once in the full web run and passed 21/21 in isolation. The two API flakes
named in the plan did reproduce once each across the gate's runs: integration went 612/612 on its
first two full runs, then `boss.test.ts` → "starts boss and round-trips a job" failed on the run
after the sanitizer commit and passed 1/1 in isolation. `sources/routes.test.ts` never failed.
