# Wave 5 acceptance — PRD future phase → evidence

Every row points at a test that exists and passed in the final gate on `wave5/integration`. Spec
ids `W5-E2E-1..2` are the real-stack Playwright flows in `apps/web/e2e/real/`; `W4-E2E-1..3` are
wave 4's, which this wave had to keep green. The spec is
`docs/superpowers/specs/2026-09-15-kb-wave5-learning-design.md`, the contract
`docs/api/CONTRACTS-wave5.md`, and every deliberate deviation is in `docs/wave5-merge-log.md`.

| PRD future-phase bullet | Lanes | Evidence |
|---|---|---|
| ליצור תדריך | V1, V4b, V6 | `apps/api/test/learning.test.ts` (briefing entries, per-document notes, publish pins the document versions it taught), `apps/api/test/unit/learning-fallback.test.ts`, `apps/web/test/learning/{Builders,BriefingReader,LearningManage}.test.tsx`, `apps/web/test/learning/hooks.test.tsx`, **W5-E2E-1** stage 1 |
| ליצור שאלון (כולל יצירה אוטומטית של שאלות) | V1, V4b, V6 | `apps/api/test/learning.test.ts` (generation from a document, the rules fallback when no model answers, `PUT …/questions`), `packages/model/test/questions.test.ts` (prompt + parse), `apps/web/test/learning/{Builders,QuizPlayer}.test.tsx`, **W5-E2E-1** stage 1 (generate → save → publish against the real generator) |
| להקצות לנציגים / לקהל יעד | V2, V4b, V6 | `apps/api/test/learning-tracking.test.ts` (audiences as roles × worlds, nightly re-resolution, individual assignment, `DELETE /learning/audiences/:id`), `apps/web/test/learning/AssignCompletion.test.tsx`, `apps/api/test/int/wave5-seams.test.ts` ("GET /learning/audience-options answers a manager who has no roles.manage"), **W5-E2E-1** stage 2 |
| לעקוב אחר השלמה | V2, V4a, V4b, V6 | `apps/api/test/learning-tracking.test.ts` (attempts, unlimited retakes, pass mark, completion, overdue), `apps/web/test/learning/{MyLearning,QuizPlayer,AssignCompletion}.test.tsx`, `apps/web/test/integration/wave5-mounts.test.tsx` (the sidebar badge is what is still owed, never history), **W5-E2E-1** stages 3–4 |
| לזהות שינוי משמעותי בידע ולדרוש רענון ידע | V2, V6 | `apps/api/test/unit/changeDetector.test.ts` (outcome, branch, CRM field, removed step, the 40 % rule), `apps/api/test/learning-tracking.test.ts` (flag recorded on every publish; the editor's override both ways), `apps/api/test/int/wave5-seams.test.ts` ("a significant publish invalidates the completion and creates a refresh assignment", and `GET /documents/:id/change-preview` states the verdict without writing), `apps/web/test/integration/wave5-mounts.test.tsx` (the publish dialog pre-ticks and the toast names the refreshes), `apps/web/test/learning/ArticleLearning.test.tsx`, **W5-E2E-1** stage 5 |
| §11 תפקיד מאשר (approver) | V0, V3, V6 | `apps/api/test/migrations.test.ts` ("seeds wave 5 permissions, the approver role…" — 0038 grants), `apps/api/test/workflow-approver.test.ts` (403 `APPROVER_REQUIRED`, `canApprove` on queue rows, the switch off by default), `apps/api/test/unit/workflowSettings.test.ts`, `apps/web/test/admin/WorkflowSettings.test.tsx`, `apps/web/test/integration/wave5-mounts.test.tsx` (queue disables approve and explains; a 403 reads as a rule), **W5-E2E-2** |
| §13 זיהוי פערי ידע מנתוני שימוש | V3, V4b, V6 | `apps/api/test/gaps.test.ts` (five heuristics, idempotent re-detection, dismiss with a reason, resolve by document, auto-resolve on publish, `lastRunAt`), `apps/api/test/unit/gaps-stem.test.ts`, `apps/web/test/gaps/Gaps.test.tsx`, **W5-E2E-1** stage 6 (four zero-result searches → detect → the row → "צור פריט" pre-fills the draft) |
| §5 the mounts no lane could make | V6 | `apps/web/test/integration/wave5-mounts.test.tsx` (shell section + badge and its three permission gates; the article's refresh banner, learning chip and panel block; the publish checkbox; the review-queue hint; the identity card) |
| Wave-4 follow-ups F-4 / A-4 / E-1 | V6 | F-4 already closed on `main` (`ef91db8`); A-4 closed by main's `TypeBadge` change with `apps/web/test/feedback/FeedbackButton.test.tsx`; **E-1** is V6's — `apps/api/test/int/wave5-seams.test.ts` ("a human publish keeps the source-review flag while a sync link is in conflict", and `pending_push` keeps it while an unlinked document still clears) |
| `docs/perf.md` search seam | V6 | `apps/api/test/perf/perf-rewrite.test.ts` (the emitted predicate is the union form; the baseline round-trips), `apps/api/test/search.test.ts` ("GET /search drops Hebrew stopwords from the ilike conjunction"), `perf:sql` row-identical over every sampled query |

## Gate

Run on `wave5/integration` after the last `main` merge.

| Gate | Result |
|---|---|
| `pnpm -r build`, `pnpm typecheck` | clean |
| `pnpm --filter @wecom/shared test` | 79 tests |
| `pnpm --filter @wecom/model test` | 30 tests |
| `pnpm --filter @wecom/connectors test` | 49 tests |
| `pnpm --filter @wecom/web test` | 101 files, 698 tests |
| `RUN_INTEGRATION=1 pnpm --filter @wecom/api test:int` | 98 files, 581 tests |
| `pnpm openapi` + contract test | no diff after regeneration; `route-coverage.test.ts` green (both new routes are named in `wave5-seams.test.ts`) |
| `pnpm lint` | clean |
| `pnpm e2e:real` | 14/14 (`E2E_PG_PORT=55534 E2E_API_PORT=3211 E2E_WEB_PORT=4281`) |
| `E2E_OIDC=1 pnpm e2e:real` | 15/15 (same ports, `E2E_OIDC_PORT=9411`) |

### Search performance (`docs/perf.md`)

`perf:sql --docs 800`: the landed union predicate returns **row-identical** results to the
reconstructed pre-V6 baseline for every sampled query. `perf:load --compare --docs 5000
--seconds 20 --clients 20`, both passes of each configuration combined:

| Configuration | req/s | p95 (all) | p95 single | p95 two-word | p95 stopword | p95 prefix |
|---|---|---|---|---|---|---|
| legacy (pre-V6 `string_agg` or) | 32 | 1,200 ms | 1,167 ms | 1,341 ms | 1,194 ms | 1,328 ms |
| current (union + stopword drop) | 104 | 453 ms | 322 ms | 368 ms | 398 ms | 557 ms |

Four of the five classes are inside the 500 ms budget; `prefix` is the one `docs/perf.md` says
cannot be fixed in the database (no index type serves `ilike '%חב%'`). Main's `MIN_SEARCH_CHARS`
is that fix, on the client, and the load generator still issues two-character prefixes.

## Parked

Each was a conscious call rather than an omission; the cost of being wrong is stated so the next
wave can reopen it cheaply.

| Item | Ruling | Cost if wrong |
|---|---|---|
| `GET /learning/items/:id/preview` answers `PlayerQuestionSchema`, which omits `correct`, so a manager previewing a quiz cannot see which option is right. | Kept. The preview exists to show the manager *what the agent will see*; the authoring view (`GET /learning/items/:id`) is where the answers live, and it is one click away in the same screen. | A manager checking answers opens the builder instead of the preview. (This omission cost an hour of W5-E2E-1 debugging — it reads as the player ignoring clicks. The spec now says so in a comment.) |
| `learning_items.description` is HTML but carries no `asset_refs` trigger. | `RichText … compact` drops the image extension precisely because the learning surface has no asset pipeline, so nothing can reference `/api/v1/assets/…` from there. `briefing_entries.note` and `quiz_questions.*` are plain text. | If a future editor gains an image button on a briefing intro, the weekly gc could collect an image only that intro references. Adding the owner to 0045's `OWNERS` list is a one-line change. |
| `GET /documents/:id/change-preview` is a second read of the detector rather than a value carried out of the editor's unsaved state. | The dialog opens after the structure is saved, so the server's view and the editor's agree; a preview computed client-side would be a second implementation of §1.5 that could disagree with the one that decides. | One extra request per publish dialog. |
| The audience picker lists every role, including `admin`. | `GET /learning/audience-options` exposes names and labels only, and an audience of admins is a legitimate (if unusual) choice. | A manager can assign learning to administrators. Harmless; a filter is a one-line change. |
| Wave 5 adds no `E2E_OIDC` variant of W5-E2E-1/2. | Both run in the OIDC suite unchanged — `signInAs` already opens the local disclosure under `E2E_OIDC=1` — so the SSO variant exercises them without a second spec. | Nothing: the OIDC gate runs the same two specs. |
| The quiz player can lose a selection mid-quiz when the assignment's own `learning.*` notification arrives over SSE and the player payload refetches (merge log defect 6). This row is the one the merge log forwarded a reader to and the review found missing. | **No longer parked** — fixed in the web fix wave (B-I4): the player keys its selections by question id and holds them across a refetch; only a different assignment or a new `itemVersion` restarts the attempt, and W5-E2E-1 stage 3 re-ticks until the tick sticks rather than assuming it did. | If the identity test is too *narrow*, a learner whose item was republished mid-attempt answers questions that no longer exist and is graded against the new ones; if it is too broad, a quiz restarts on an unrelated notification — the state the defect described. Both are visible in stage 3. |


## Fix wave — web

The wave-5 final review (package B) against `wave5/integration` @ `4f3a319`. Everything Critical and
Important is fixed on `fix/wave5-web`, and the fourteen minors the brief named with it; what is left
is parked here with the cost of being wrong, in the same shape as the table above.

| Finding | Ruling | Cost if wrong |
|---|---|---|
| **B-M5** `DocumentPicker` puts `role="option"` on `<button>` inside a `role="listbox"`, with no `aria-activedescendant`, no combobox wiring on the input and no arrow-key navigation. | Parked. It is a correct four-part rewrite of one component (input → combobox, results → managed listbox, roving active descendant, Enter/Escape), and it is shared by the two builders and the gap resolver — a change worth making on its own, not inside a fix wave whose other half is on another branch. | The picker is reachable and operable by mouse and by Tab; a screen-reader user hears "button" instead of "option" and cannot arrow through the results. One component, three call sites, no data at risk. |
| **B-M6** `role="button" tabIndex={0}` with `onClick` and no `onKeyDown` (`Panel.tsx:135`, `AssignDialog`'s close ✕). | Parked. The review itself grades this consistency rather than regression: `Panel.tsx` has had the same pattern at three other lines since wave 3, and fixing one of five instances makes the shell *less* predictable. It belongs to a pass over all of them. | Enter/Space do nothing on those two controls. Escape closes the assign dialog and the panel link has a keyboard-reachable twin in the article body, so nothing is unreachable by keyboard. |
| **B-M11** `useEffect(() => setEntries(item.entries), [item.entries])` in both builders resets an unsaved draft whenever the server array's identity changes. | Parked. The `dirty` guard landed on the learning-item intro (B-C2), where the review proved a real reset; the two builders are safe today because TanStack's structural sharing preserves the reference across a same-content refetch, and adding the same guard to a list the manager saves explicitly changes when a *legitimately* newer server copy is adopted. | If structural sharing ever stops preserving that reference — a TanStack upgrade, a payload that differs by a timestamp — an unsaved briefing or quiz draft is discarded with no warning. The guard is ~4 lines per builder, and the B-C2 change is the worked example. |
| **B-M17** `helpers/users.ts` can sleep 2 × 61 s inside a 150 s per-test timeout. | Parked. The sleep is the real rate limit on `POST /auth/local` (five sign-ins a minute per IP, shared by the whole gate); shortening it trades a slow pass for a flaky one, and raising the per-test timeout hides a hung stack. | In the worst case a spec has ~28 s left for its own work and times out, reporting a timeout where the real cause was the rate limiter. The retry already logs which it is. |
| **B-I6** `docs/api/CONTRACTS-wave5.md` is stale on three points. | Not this branch. `docs/api/**` is the API half of the fix wave and is being edited there; touching it here would conflict at the merge. | Nothing, provided the API half lands it — worth checking at the merge that the publish response, `change-preview` and `audience-options` rows are in the route table. |
| **Deviation** — the `free` question kind is authorable nowhere in the web app. | Deliberate. It has no player control and the contract's `answers[].text` was never sent, so the builder could author a question that graded as wrong no matter what a learner did; the API now rejects it on save with 400 `UNSUPPORTED_KIND`. The kind stays in `QuestionKindSchema`, the label stays in the editor, and a stray `free` inherited from an older draft still shows in the kind select so it can be changed. The player renders an explicit unsupported state for one rather than a dead end. | An editor who wants a free-text question cannot author one and has no workaround short of a wave-6 change. Adding it later is additive — a text field in the player, `answers[].text` on the wire, and the kind back in `AUTHORABLE_KINDS` — with no migration. |

### Gate (fix wave, web half)

| Gate | Result |
|---|---|
| `pnpm --filter @wecom/web build` (includes `tsc --noEmit`) | clean |
| `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4` | 102 files, 708 tests |
| `eslint apps/web --max-warnings 0` + `prettier --check apps/web` | clean |
| `pnpm e2e:real` | **pending the merged tree** — W5-E2E-1 stage 3 now plays an `order` question and W5-E2E-1/2 assert the new count strings, which need the API half of the fix wave to run against. |
