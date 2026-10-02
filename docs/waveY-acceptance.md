# Wave Y — acceptance

Closing the parked items of waves 4–6 (plan: `docs/superpowers/plans/2026-09-29-Y-open-items.md`).
Lanes Y1–Y5 branched from `wave6/gate` @ 1858816 and merged into `waveY/integration`; each
section below is the lane's own record. Evidence is test names; "int" means `RUN_INTEGRATION=1`.

## Y1

Scope & governance (API) — branch `waveY/Y1`, migration `0055`.

| Item | What changed | Evidence |
| --- | --- | --- |
| ~~**A-M6** (w5) — writes need every world~~ | `lib/user.ts` gains `hasAllScopes` (write rule) next to `hasScope` (read rule, any overlap); the auth plugin's duplicate `checkScope` is gone, and route config has `scope: 'document:write'` for PATCH/structure/publish/status/source-review clear/restore/DELETE, draft PUT/DELETE, request-review/review-decision and the source-document writes. Handler guards through `hasAllScopes`: documents, bulk (pin/unpin stay reads), trash restore/purge (restore-all and the trash empty skip partial-world documents), blocks and CRM fields (worlds = the worlds of the documents that use them, `worldsOfDocuments`), learning items (derived `worldsOfItem`) and tracking writes (audiences, assign; completion stays a read), and the AI proposed-edits apply path. Web `can()` mirrors it: `docs.read*` any overlap, every other `docs.*` needs every world. | int `write-scope.test.ts`: "a one-world manager reads a two-world document but cannot edit, publish, re-status or delete it", "bulk skips a two-world document…", "trash: restoring or purging a two-world document needs both worlds…", "a block used in two worlds is readable… but not editable or deletable", "a field referenced in two worlds is readable but not editable, renameable or deletable…", "a briefing citing a billing and a sim document is readable but not writable by a billing manager" (multi-world learning item; 200 read / 403 write), plus the single-world controls. `documents.test.ts` › assertTaxonomyScope "A-M6: an editor holding one of two worlds reads the document but may not patch it"; `scope-leak.test.ts` "I4: a scoped rename of a field used outside the caller worlds is refused and rewrites nothing"; `unit/scope.test.ts` hasScope / hasAllScopes; web `hooks.test.tsx` "A-M6: reads need any world of the document, writes need every one", `invalidation.test.tsx` "reads a document whose secondary world is in scope, but edits it only holding every world". |
| ~~**A-M8** (w5) — lean `canSeeById`~~ | `learning/repo.ts`: one rule `seesItem(status, worlds, viewer)` used by both `canSee` and `canSeeById`; `canSeeById` loads the row + worlds (`ItemHead`) without assembling entries/questions/source versions. Learning `visible()` uses it; only GET item and the manager preview load the full item. | int `write-scope.test.ts` "A-M8: canSeeById and canSee agree for every viewer and item" (5 viewers × 5 items); `learning.test.ts`, `learning-tracking.test.ts` unchanged and green. |
| ~~**A-M11** (w5) — keep, never raise~~ | `documents/repo.ts` publish: the flag is kept (reason restated) only when it was already set and a link is `pending_push`/`conflict`; a clear flag stays clear. | int `wave5-seams.test.ts` "A-M11: a human publish never raises a clear flag while a link is pending_push or conflict" (red on the old code), and the existing "E-1: … keeps the source-review flag while a sync link is in conflict" / "E-1: pending_push keeps it too, and an unlinked document still clears". |
| ~~**A-M14** (w4) — `world_scope` integrity~~ | Most of it was already in `0045_pilot_hardening` (join table `user_role_worlds` with the FK `on update/delete cascade`, rename cascade into the array, delete prune, create re-attach). `0055_world_scope_integrity` closes the gap: prunes unknown slugs still stored and adds a `before insert or update of world_scope` trigger raising 23503 on a slug naming no world. Delete policy unchanged and consistent: scopes are memberships (prune/cascade, like `document_worlds`), and `documents.category` (`no action`) keeps a document's primary world from being deleted. Down drops the trigger. | int `world-scope-integrity.test.ts` (7): prune on migrate, reject update/insert with 23503, null/{} still valid, rename cascade passes the check, delete prune + `documents.category` blocks the delete, down/up. `pilot-hardening.test.ts` H3 case now "refuses a scope naming a world that does not exist yet (0055)…"; `migrations.test.ts` full rollback green. |
| ~~**B-M1** (w4) — dead schema probes~~ | Removed `probeCapabilities`/`Caps` (usage), `hasColumn`/`resetColumnCache` and the `doc_type`, `owner_id`/`editor_id`, `to_regclass('document_topics')` probes (feedback), plus the same kind of dead probe in gaps `failedQuestions` (learning tables) and the AI `read_eval` tool (`ai_eval_runs`). The `body_html` probe had already gone with B-I2. Tests that only kept them alive: feedback-alerts' alter/drop-column case (now "uses owner_id / editor_id when the document has them"), gaps' "tables absent" case, the `ensureLearningTables` stub, the sourcedocs W2 column probe. | `usage.test.ts`, `feedback.test.ts`, `feedback-alerts.test.ts`, `gaps.test.ts`, `learning-tracking.test.ts`, `sourcedocs.test.ts`, `ai-chat.test.ts`, `int/wave4-seams.test.ts` green. |
| ~~**A-M6, follow-up** (coordinator ruling) — the two unguarded document writers~~ | `POST /suggestions/publish`: `worldsWrittenBy(sourceId)` collects every world the publish writes (target documents; a `new-card`'s `category`; an `update-block`'s and a `field-alert`'s using documents) and the route's guard runs it through `hasAllScopes` inside the apply transaction, before anything is applied — one out-of-scope target is a `403 SCOPE_DENIED` for the whole request, nothing half-published. `POST /sync/links/:id/sync` (both directions) and `/resolve`: the linked document's worlds through `hasAllScopes`, `403 SCOPE_DENIED` after the existing permission check. Unscoped roles unaffected (`hasScope`/`hasAllScopes` now also treat an absent `worldScopes` as unscoped, which the L6 test harness relies on). | int `write-scope.test.ts` › suggestions publish: "refuses the whole publish when one target spans a world the caller does not hold" (versions and statuses unchanged; the both-worlds holder then applies 2), "lets a one-world manager publish a source whose targets are all in their world", "counts the world a new-card would be created in"; › sync links: "a one-world manager may not push, import or resolve a two-world linked document", "a manager holding both worlds gets through". The three refusal cases fail on the old code. `sync-ui`, `sync-link-sync`, `sync-parity`, `test/sources/*` green. |
| ~~**A-M6, review (Important)** — learning items pulled into worlds the caller does not hold~~ | `learning/routes.ts`: `PUT /learning/items/:id/entries` and `/questions` run `assertDocumentsInScope` over every cited document (404 for a document the caller cannot read, the A-I5 convention — a cited document is served back in the item and its preview), and then, inside the write's transaction, `assertWritableAfter` recomputes `worldsOfItem` on the item as written and requires `hasAllScopes` — `403 SCOPE_DENIED` and the transaction rolls back. `PATCH` runs the same post-write check whenever the body carries `worldSlug` (so `worldSlug: null` handing a billing item to its cited documents' worlds is refused). `POST` takes no references and already requires the whole of its `worldSlug`; `/generate` saves nothing and already refuses unreadable documents (A-I5). Unscoped roles skip both checks. | int `write-scope.test.ts` › learning items › writes that move an item into other worlds: "entries: a world-less briefing cannot be made to cite a document the caller cannot see" (404, nothing persisted, no title leak), "entries: a billing briefing cannot cite a sim-only document either", "entries: citing a readable two-world document that would make the item two-world is a 403 and rolls back" (+ billing-only 200, both-worlds manager 200, unscoped admin 200), "questions: the same two checks, on a world-less quiz", "PATCH worldSlug:null on a billing item citing a sim document…" (403, world and title unchanged; both-worlds and admin 200), "POST and /generate do not open the same hole". The first five fail on the old code. |
| ~~**A-M6, review (Minor)** — trash restore/purge of blocks and CRM fields unscoped~~ | `trash/repo.ts`: `assertTrashScope` applies the write rule to blocks and fields — worlds of the live documents using them (`catalogueWorlds`: `blockUsage` for a block, whose step references survive until purge; `documentsMentioning` for a field, whose `step_field_refs` `deleteField` drops — the set `restore` re-derives), then `worldsOfDocuments` + `hasAllScopes`, 403 otherwise (never a 404: `GET /trash` lists them to everyone). `writableTrash` skips such items for `restore-all` and the trash empty, as it already did for partial-world documents. | int `write-scope.test.ts` › trash: blocks and fields: "a block used in billing and sim: a billing manager may not restore or purge it; bulk leaves it" (403/403, restore-all and empty leave it; both-worlds restore 200; admin purge 204), "a CRM field mentioned in billing and sim: the same rule", "a block used only in the caller's world is theirs to restore". The first two fail on the old code. Full api suite with `RUN_INTEGRATION=1`: 126 files, 844 tests pass. |

## Y2

Lane Y2 (data & storage, API) · branch `waveY/Y2` from `wave6/gate` @ 1858816 · migrations 0056, 0057.

| Item | What changed | Evidence |
| --- | --- | --- |
| ~~**B-M15** (w4)~~ — `asset_refs` join table maintained on every HTML save; gc reads it | The table, its triggers on five owners, the backfill and the gc switch had already landed in `0045_pilot_hardening` (commit c7b4422, post-pilot). What was still open: wave 5's `learning_items.description` (sanitized HTML) and its frozen copy `learning_item_versions.snapshot → item → description` carried no trigger (wave-5 acceptance row). `0056_asset_refs_learning.js` generalises `asset_refs_sync` to any `#>>` path depth, adds both owners (trigger + backfill + check constraint) and `down` restores 0045's function and check verbatim. Maintained by triggers, so every write path — route, import, bulk `update` — is covered without the write paths knowing. | `apps/api/test/int/waveY-storage.test.ts` "0056": backfill of a pre-0056 description and version; description save adds then removes the ref; three-key version path; item delete cascades and clears; 0045's owners (document, draft) still tracked through the new function; gc deletes exactly the three unreferenced assets and keeps the referenced ones; down refuses the new kinds and keeps the old owners working, re-up re-backfills. Existing `test/int/pilot-hardening.test.ts` and `test/sourcedocs.test.ts` gc tests still green. |
| ~~**A-M7** (w6)~~ — prune `source_revisions.meta->'diffs'` (owner decision 3) | `src/modules/sources/pruneDiffs.ts` `pruneRevisionDiffs`: a revision keeps full diffs when it is among the newest 20 of its source (`imported_at desc`) **or** any suggestion references it (`suggestions.source_revision_id`); every other revision gets `meta.diffCounts` (per diff kind) + `meta.prunedAt`, rest of `meta` untouched. Idempotent. New queue `sources.prune-diffs`, worker registered in `registerPipelineJobs`, scheduled `15 4 * * *` Asia/Jerusalem (not under test, like the other nightly jobs). `fewShotExamples` only reads diffs of revisions behind accepted/applied suggestions (always kept) and already falls back to the anchor; the acceptance analytics never read `meta`. | `apps/api/test/sources/prune-diffs.test.ts`: 23 revisions + an old accepted-suggestion revision + a second source → exactly 2 pruned with `{changed: 2, added: 1}`; referenced and newest-20 keep full diffs; second run prunes 0; `fewShotExamples` returns the kept diff text, and the anchor fallback for a suggestion on a pruned revision; `suggestionAnalytics` counts both. |
| ~~**A-M4** (w6)~~ — `embeddingMapping` as one lateral query | `sources/mapping.ts`: the per-paragraph `order by embedding <=> $1 limit 1` loop is now one `unnest($1::text[]) with ordinality … cross join lateral (<the same subquery>)`. Same join, same linked-document exclusion, same per-paragraph threshold, and the trigram fall-through still triggers only when *no* paragraph clears it. | `test/sources/mapping-embeddings.test.ts` (new block): exactly **1** `pool.query` for 3 paragraphs (was 3 — test written red first), order kept, sub-threshold paragraph dropped without trigram fallback, already-linked document excluded; the original embedding/trigram/far-vector assertions unchanged and green. Eval CLI rules path before/after identical (below). |
| ~~**A-M5 second half** (w6)~~ — one embed-dimension resolver | `apps/api/common/embedDimension.cjs` (+ `.d.cts`): plain CommonJS, `require`d by migration 0051 and imported by `src/lib/modelSlots.ts` (`resolveModelSlots(...).embedDimension`). Precedence unchanged: explicit `EMBED_DIMENSION` (≠ 768) > `MODEL_TIER` preset (tier ≥ 1 → 1024) > 768. 0051 still exports `resolveEmbedDimension` (now the shared function). | `test/unit/embed-dimension-resolver.test.ts` (16 tests): table mirrors `MODEL_TIER_PRESETS`; precedence cases; env parsing incl. empty-is-unset and rejects; 0051 re-exports the same function; drift matrix — for 12 env shapes, `resolveModelSlots(ConfigSchema.parse(env))` equals the migration's answer. `test/migrations.test.ts` 0051 tests green. Built `dist/lib/modelSlots.js` imports the `.cjs` at runtime (checked). |
| ~~w4 `view_topic` telemetry kind~~ | Removed from `TelemetryEventSchema` (the one deliberate exception to append-only, commented) and from `docs/api/openapi.json`; `0057_drop_view_topic_telemetry.js` deletes any such row and narrows `telemetry_events_kind_check`; `down` widens back to 0043's list. No web, e2e or api code sends it (grep). `CONTRACTS-wave4.md` annotated. | `test/int/waveY-storage.test.ts` "0057": `view_topic` refused, the other six kinds accepted, down accepts it again, re-up deletes it and refuses again. |
| ~~w4 deprecated `POST /sync-links/:id/resolve`~~ | The route itself was already removed (5524c7d). Its orphaned `SyncResolveBodySchema` in `@wecom/shared` had no importer and is removed. Callers: web `api/stage5.ts` and both e2e suites use `POST /sync/links/:id/resolve`. | `test/route-coverage.test.ts` "carries only the one sync-link resolve route": no `/api/v1/sync-links/*` path in the openapi, `/api/v1/sync/links/{id}/resolve` present. |

### Eval CLI, rules path (`pnpm --filter @wecom/model eval --rules`)

| | cases | hitTarget | hitType | contentOverlap | precision | languageFailures | schemaFailures |
| --- | --- | --- | --- | --- | --- | --- | --- |
| before (1858816) | 22 | 1 | 1 | 0.932 | 1 | 0 | 0 |
| after (A-M4) | 22 | 1 | 1 | 0.932 | 1 | 0 | 0 |

The two JSON outputs are byte-identical once timing fields are stripped. Note: the rules path of the
CLI scores `proposeChanges` over fixed cases and does not call `MappingService`; the mapping change
is pinned by the integration test above.

### Gates

Run on `waveY/Y2` against a private pgvector 16 (`TEST_DATABASE_URL`) plus testcontainers:

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | pass |
| `pnpm lint` (eslint + prettier) | pass |
| `@wecom/shared` unit | 17 files, 123 tests pass |
| `@wecom/model` unit | 14 files, 114 tests pass |
| `@wecom/api` unit (no DB) | 49 files, 297 tests pass (73 integration files skipped) |
| `@wecom/api` integration, `RUN_INTEGRATION=1` — `test/int` | 33 files, 218 tests pass |
| — `test/sources`, `test/unit`, `test/perf` | 41 files, 239 tests pass |
| — top-level `test/*.test.ts` (incl. `migrations.test.ts`, `route-coverage.test.ts`) | 48 files, 337 tests pass |
| `pnpm openapi` | regenerated; only diff is the removed `view_topic` enum value |
| eval CLI rules path | identical before/after (table above) |

### Notes for the integrator

- Shared-file touches (minimal): `packages/shared/src/schemas/stage45.ts` (telemetry enum),
  `packages/shared/src/schemas/api.ts` (removed `SyncResolveBodySchema`), `src/plugins/boss.ts`
  (one queue name), `src/jobs/pipeline.ts` (worker + schedule), `src/lib/modelSlots.ts`,
  `src/modules/sourcedocs/assets.ts` (comment only), `docs/api/openapi.json`,
  `docs/api/CONTRACTS-wave4.md` (one annotation).
- New top-level directory `apps/api/common/` (the shared `.cjs` resolver). The API image copies
  all of `apps/api`, so it ships; the built `dist/lib/modelSlots.js` resolves it at runtime.
- A-M14 (Y1's item): `user_role_worlds` + the slug-rename/delete triggers also already exist in
  0045 — Y1 may find that half done, as B-M15 was here.

## Y3

Full-stack follow-ups (shared → API → web). Branch `waveY/Y3`, from `wave6/gate` @ 1858816. Migration: `0058_waveY_transcript_search_eval_precision.js` (one file, shared by B-M12 and eval precision).

| Item | What changed | Evidence |
| --- | --- | --- |
| ~~**B-M6** (w6) — `ChatPane` fabricated `ProposedEdits.messageId` from the `done` frame~~ | `ChatEventSchema`'s `proposed_edits` frame gains `messageId` (the tool message, `ai_proposed_edits.message_id`); `chat.ts` sets it; the reducer carries it; `ChatPane` hands it on instead of the reply id. Contract table updated | `apps/api/test/ai-proposed-edits.test.ts` ("B-M6: the frame names the tool message…"), `apps/web/test/ai/ChatPane.test.tsx` (hands the host MSG_2, not the `done` frame's MSG_3), `apps/web/test/ai/chatReducer.test.ts`, `packages/shared/test/wave6.test.ts` |
| ~~**B-M12** (w6) — transcript browser had no body search and no paging~~ | `ConversationsQuerySchema.q`: case-insensitive substring over `ai_messages.content`, `%`/`_` escaped (`likeEscape`), bound parameter, narrows only (the admin route keeps its `ai.manage` scope, the own-conversations route stays the caller's). The JSONL export applies the same `q` (unpaged). 0058 adds `ai_messages_content_trgm` (GIN trigram). Web: debounced "חיפוש בתוכן השיחות" box, a pager ("הקודם / הבא", "עמוד N מתוך M · T שיחות"), any filter change returns to page 1, the export drops the page | `apps/api/test/ai-admin.test.ts` ("B-M12: `q` searches message bodies, `page` pages, and neither widens…"), `apps/api/test/migrations.test.ts` ("0058 …"), `apps/web/test/admin/AiConversations.test.tsx` (two wave Y cases) |
| ~~**B-M16 third part** (w6) — contract said the workspace link needs `ai.chat` **and** edit rights~~ | Doc only: `docs/api/CONTRACTS-wave6.md` now states the code's gate — `ai.chat` on the editor toolbar, `ai.chat` + `docs.edit` on the article topbar, `WorkspacePage` refuses without `ai.chat`, the source pane is read-only without `docs.edit` (server save routes + overlay apply buttons). Code unchanged | `docs/api/CONTRACTS-wave6.md` (workspace link paragraph) |
| ~~**A-M4 follow-up** (w5) — `failedQuestionMin` / `topicViewsMin` were constants~~ | `WorkflowSettings.gaps.failedQuestionMin` (default 5) and `.topicViewsMin` (default 3). `failed_question` heuristic binds the floor (it still hardcoded `>= 5` in SQL), `topicsWithoutProcedure` reads the setting, the learning dashboard's failed-question tile reads the same setting via the route. Constants removed. Two inputs on the admin workflow form | `apps/api/test/learning-tracking.test.ts` ("the dashboard tile and the failed-question heuristic read one settings floor"), `apps/api/test/gaps.test.ts` (topicViewsMin 5 hides / 4 shows), `packages/shared/test/wave5.test.ts`, `apps/web/test/admin/WorkflowSettings.test.tsx` |
| ~~**SuggestionsPanel lists the primary source only** (w6)~~ | `GET /suggestions?documentId=` — suggestions of the document's primary source plus every `document_links.to_source_id` (intersects with `sourceId`; still world-scoped). List rows carry additive `sourceId` / `sourceTitle`. `SuggestionsPanel` on a document asks by `documentId` and groups by source (primary first, headed "מקור ראשי") when more than one source is present; the `/sources/:id` mount is unchanged | `apps/api/test/sources/suggestions-document.test.ts`, `apps/web/test/workspace/SuggestionsPanel.test.tsx` ("a multi-source document (wave Y)") |
| ~~**Eval precision stored in `notes`** (w6)~~ | `ai_eval_runs.precision` (real, 0–1) and `.language_failures` (int), nullable; 0058 backfills them from existing notes and strips the phrase, `down` writes it back. `EvalRunSchema` gains both (nullable, default `null`); the worker writes the columns, `notes` keeps only per-case failures. `/admin/ai` → הערכה shows "דיוק" (3 places) and "כשלי שפה", `—` for a run with no measurement | `apps/api/test/unit/ai-eval-run.test.ts`, `apps/api/test/int/ai-admin.test.ts` ("queues an eval…"), `apps/api/test/migrations.test.ts` ("0058 …" backfill + down), `apps/web/test/admin/AiEvalAnalytics.test.tsx` |

`pnpm openapi` regenerated (`docs/api/openapi.json`).

## Y4

Web accessibility & robustness. Branch `waveY/Y4` from `wave6/gate` @ 1858816.

| Item | What changed | Evidence |
|---|---|---|
| **B-M5** (w5) `DocumentPicker` is a real combobox | `apps/web/src/components/learning/manage/DocumentPicker.tsx`: the input is `role="combobox"` with `aria-expanded`, `aria-controls` (always-present listbox id), `aria-autocomplete="list"` and `aria-activedescendant`; results are a managed `<ul role="listbox">` of `<li role="option" aria-selected>` (no buttons, out of the tab order). ArrowDown/ArrowUp move the active option (wrapping), Home/End jump, Enter picks (and never submits an enclosing form), Escape closes without clearing the query and without bubbling to a surrounding dialog; ArrowDown reopens. Mouse: press keeps focus in the input, hover sets the active option, click picks. Styles in `app.css` follow the new markup. The three call sites (briefing builder, quiz builder, gap resolver) are unchanged. | `apps/web/test/learning/DocumentPicker.test.tsx` (8: ARIA wiring, arrow/Home/End roving with focus kept in the input, Enter picks, Enter with no active option, Escape + reopen, mouse pick, hover, exclude); call sites still green in `test/learning/Builders.test.tsx`, `test/gaps/Gaps.test.tsx`; real stack: `e2e/real/learning-loop.spec.ts` (W5-E2E-1) picks through the listbox. |
| **B-M6** (w5) every `role="button" tabIndex={0}` answers Enter/Space | Shared `pressKeys` handler in `apps/web/src/lib/keyboard.ts` (Enter/Space activate; ignores modified keys, `aria-disabled`, keys from nested controls; works on SVG nodes). Added as `onKeyDown` to every non-native `role="button"` element and every `tabIndex={0}`+`onClick` element (role `tab`, `checkbox`, `menuitem` — which the old document bridge never covered) across 38 files — `Panel.tsx`'s seven among them. The assign dialog's close ✕ is now a real `<button type="button">` (same treatment as the modal's L3 fix). `bindRoleButtonKeys` stays as a fallback and now skips events already handled, so nothing fires twice. **Guard:** a `no-restricted-syntax` override for `apps/web/src/**/*.tsx` in `.eslintrc.cjs` (jsx-a11y is not a dependency) refuses `role="button"` on a non-`<button>` without `onKeyDown`, and `tabIndex={0}`+`onClick` on a non-native element without `onKeyDown`. | `apps/web/test/lib/pressKeys.test.tsx` (Enter/Space without the bridge, ignored keys, single fire with the bridge bound, nested control, SVG node, assign-dialog ✕ is a button and Enter closes it); `apps/web/test/lib/a11yGuard.test.ts` (the lint rule fires on both shapes, accepts the fixes, and finds nothing in `apps/web/src`); existing `test/lib/roleButtonKeys.test.tsx`, `test/ui/dialogControls.test.tsx` green; `pnpm lint` green. |
| **B-M11** (w5) `dirty` guard on the briefing and quiz builders | `apps/web/src/lib/useServerDraft.ts` — the B-C2 guard as a hook: a server copy is adopted only while the draft is clean (untouched since taken from the server, or edited back to it); one arriving mid-edit waits. `commit` adopts the server's answer after a save unless the user edited during it. `BriefingBuilder` and `QuizBuilder` use it in place of `useEffect(() => set(item.x), [item.x])`. | `apps/web/test/learning/BuilderDraft.test.tsx` (6: briefing and quiz keep an unsaved draft when a changed server copy arrives — both **fail on the old effect**; a clean draft adopts the newer copy; a draft edited back to base is clean; after a save the next refetch is adopted). |
| **B-M17** (w5) e2e-only raised local sign-in limit | `AUTH_LOCAL_RATE_LIMIT` (default `5`, positive int) in `apps/api/src/config.ts` drives `POST /auth/local`'s limiter (`modules/auth/routes.ts`). Under `NODE_ENV=production` the config guard refuses to boot with a value above 5 unless `WECOM_E2E_RUNNER=1` (the marker the e2e stacks already set; a deployment sets neither). Set to 60 only in `scripts/e2e-real.mjs` and `deploy/e2e.env`; documented (commented out) in `deploy/.env.example`. `apps/web/e2e/real/helpers/users.ts` signs in once — no 61 s sleeps — and fails at once, naming the cause, if the limiter still answers. | `apps/api/test/unit/config.test.ts` (refused in production at 6 and 60, allowed at ≤5, allowed with `WECOM_E2E_RUNNER=1`, plain outside production, nonsense refused); `apps/api/test/int/auth-local-session.test.ts` — the production-default `rate-limits local login` test unchanged and green, plus a new test that a raised limit is honoured; `apps/api/test/env-example.test.ts` green. |

**Y4 gates** (on `waveY/Y4`): `pnpm -r typecheck` green; `pnpm lint` green; web unit 138 files / 924
tests; api unit 281 passed (490 integration skipped); `RUN_INTEGRATION=1` auth-local-session +
trust-proxy 19/19; `pnpm e2e:real` 16/17 in 1.4 min — W5-E2E-1 (picker + builders) and every
`signInAs` spec green with no limiter sleeps. The one failure, W6-E2E-1, stops at its data
precondition (the seeded source's first paragraph, `<p>מגה.</p>`, is shorter than the spec's
6-character quote regex) before any Y4-touched UI; it belongs to the wave 6 gate.

**Y4 review fixes** (on `waveY/integration`, web only):

- *World gate on writes* — `SourceReviewBadge` takes `worlds` and gates `docs.edit` on the full
  set; `ReviewsPage` gates `docs.publish` on the fetched document (`doc.data ?? { category }`);
  `ProposedEditsOverlay` takes the workspace's document; `TrashPage` gates per-row restore (and
  the bulk "restore selected") on a document row's `category`/`worlds` **when the row carries
  them** — `TrashItemSchema` has neither today, so until the API/shared row adds them the web
  falls back to the bare permission and the server rule is what bites. Tests: `Governance`,
  `Review` (2), `ProposedEditsOverlay` (2), `Trash` (2).
- *Draft follows its item* — `BriefingBuilder`/`QuizBuilder` keyed by `it.id`
  (`BuilderDraft.test.tsx`: A→B, edit B, back to A — fails without the key).
- *`useServerDraft` stale base* — a draft equal to the server copy becomes the clean base; a
  copy deferred mid-edit is adopted once the draft is edited back to the old base
  (`test/lib/useServerDraft.test.tsx`, 3 of 4 fail on the old hook).
- *`DocCard`* opens on Enter only from the card itself, not an Enter bubbling from the star/kebab
  or one already handled (`test/library/DocCard.test.tsx`).
- *Conversations* — `keepPreviousData`; page clamped to the last real page; export uses the live
  boxes and flushes the debounce; an unchanged filter no longer resets the page
  (`AiConversations.test.tsx`, +4).
- *Lint guard* also refuses `role={'button'}` and `tabIndex="0"` / `tabIndex={'0'}`
  (`a11yGuard.test.ts`).
- *W6-E2E-1* addresses the target card by `li[data-suggestion-id]` and checks it against
  `GET /suggestions?documentId=` (what the workspace panel renders). Typechecked only — **not
  run** (e2e deferred to the owner's machine).

Gates: `tsc` green; eslint + prettier green on the touched files; web unit 140 files / 954 tests.

## Y5

**Base knowledge refresh from Kira's source documents.** Branch `waveY/Y5`.

The roaming ("NEW ROAMING") and domestic-reception Kira documents and both knowledge-map workbooks
are committed under `apps/api/seed/source/kira/{roaming,domestic}/` (the OLD roaming documents and
the zips are not). `apps/api/seed/convert-kira.mjs` overlays them on the legacy library:

```bash
pnpm --filter @wecom/api convert:kira   # = convert-legacy.mjs, then convert-kira.mjs
```

A superseding document keeps the legacy id and slug; the legacy content becomes its previous
version (label "ייבוא מהספרייה הסטטית") and the Kira content the next one (label "רענון ידע בסיס ·
מקור Kira", author from the .docx properties). New documents get `uuidFrom('doc:' + slug)`, the rule
`convert-legacy.mjs` uses. Legacy documents Kira does not cover are unchanged.

### Kira file → seeded document

| Kira file                                         | Code | Document id                            | Slug        | Title (seeded)                   | New / supersedes                                    | Status    | Version | Steps |
| ------------------------------------------------- | ---- | -------------------------------------- | ----------- | -------------------------------- | --------------------------------------------------- | --------- | ------- | ----- |
| roaming/M-00 תקלות ושירות בחול - אבחון מרכזי      | M-00 | `4f2238c4-3191-4387-8de1-31f9333681ee` | `pdf-011`   | תקלות ושירות בחו"ל - אבחון מרכזי | supersedes "אבחון מרכזי לתקלות ושירות בחו"ל"        | published | 3 → 4   | 12    |
| roaming/R-01 אין קליטה אין רישום לרשת בחול        | R-01 | `de037d38-7d17-4730-8c19-d3aa2704ddaf` | `pdf-012`   | אין קליטה או רישום לרשת בחו"ל    | supersedes "אין קליטה / רישום לרשת בחו"ל"           | partial   | 4 → 5   | 9     |
| roaming/R-02 - אין גלישה בחול                     | R-02 | `68347add-1dd7-43e5-8519-aac95e92dcb1` | `pdf-013`   | אין גלישה בחו"ל                  | supersedes "אין גלישה בחו"ל"                        | published | 4 → 5   | 12    |
| roaming/R-03 - תקלה באפליקציה מסוימת בחול         | R-03 | `234b98bc-fa1c-4c85-8c31-766b7ae81cd6` | `pdf-014`   | תקלה באפליקציה מסוימת בחו"ל      | supersedes "תקלה באפליקציה מסוימת בחו"ל"            | published | 4 → 5   | 9     |
| roaming/R-04 תקלת שיחות בחול                      | R-04 | `b37ca8e1-6950-41c8-8f62-2c0515beabfb` | `pdf-015`   | תקלות שיחות בחו"ל                | supersedes "תקלות שיחות בחו"ל"                      | published | 4 → 5   | 13    |
| roaming/R-05 - תקלות הודעות בחול                  | R-05 | `f956f3d2-323b-4645-83f2-b6b05ae762f9` | `pdf-016`   | תקלות הודעות בחו"ל               | supersedes "תקלות הודעות בחו"ל"                     | published | 2 → 3   | 13    |
| roaming/O-01 - בדיקות שירותי נדידה וחבילת חול     | O-01 | —                                      | —           | —                                | not imported: the delivered file is empty (0 bytes) | —         | —       | —     |
| roaming/O-02 - בדיקה והפעלת נדידת נתונים במכשיר   | O-02 | `e2c50192-2a99-40bc-88d3-d29109342509` | `pdf-017`   | בדיקה והפעלת נדידת נתונים במכשיר | supersedes "הפעלת נדידת נתונים במכשיר"              | published | 3 → 4   | 14    |
| roaming/O-03 - הגדרת APN בחול                     | O-03 | `7377218d-b9b4-4452-8d18-8f0228dea8f9` | `pdf-018`   | בדיקה והגדרת APN בחו"ל           | supersedes "בדיקה והגדרת APN בחו"ל"                 | published | 2 → 3   | 11    |
| roaming/O-04 - תפעול STK ושינוי זהות רשת בחול     | O-04 | `500f1fa7-f70f-4c12-89e4-11d1cfba08a6` | `pdf-019`   | תפעול STK ושינוי זהות רשת בחו"ל  | supersedes "תפעול STK ושינוי זהות רשת בחו"ל"        | partial   | 2 → 3   | 2     |
| roaming/O-05 - בחירת רשת ידנית בחול               | O-05 | `0dcc9d72-bf6b-4124-82e4-96303cb404ae` | `pdf-020`   | בחירת רשת ידנית בחו"ל            | supersedes "בחירת רשת ידנית בחו"ל"                  | published | 2 → 3   | 10    |
| roaming/0-06 תאימות מכשירים בארהב                 | O-06 | `c54e6998-3944-4ab9-8baa-3b6127779327` | `kira-o-06` | תאימות מכשירים בארה"ב            | new                                                 | published | 1       | 4     |
| roaming/E-01 - העברה למומחה בתקלת חול             | E-01 | `8805f83f-191e-47aa-8f94-bf20f3cffd2d` | `pdf-021`   | העברה למומחה בתקלת חו"ל          | supersedes "העברה למומחה בתקלת חו"ל"                | partial   | 2 → 3   | 6     |
| domestic/M10 - בעיות קליטה בארץ - אבחון מרכזי     | M-10 | `ba744440-a357-43b3-83e0-03c2fabe7ebc` | `pdf-002`   | בעיות קליטה בארץ - אבחון מרכזי   | supersedes "בעיות קליטה בארץ – שיחות וגלישה"        | published | 4 → 5   | 7     |
| domestic/R-11 - קליטה חלשה במקום מסוים            | R-11 | `0ff33f50-521a-485e-80a3-683f9d59c4c4` | `kira-r-11` | קליטה חלשה במקום מסוים           | new                                                 | published | 1       | 8     |
| domestic/R-12 - קליטה חלשה או ניתוקים בנסיעה      | R-12 | `cf0fdf75-1fd7-4d33-84a4-661e3e4577d9` | `kira-r-12` | קליטה חלשה או ניתוקים בנסיעה     | new                                                 | published | 1       | 10    |
| domestic/R-13 - הרעה חדשה בקליטה באזור            | R-13 | `59a5565b-da73-4a82-89e8-1153bc5a667f` | `kira-r-13` | הרעה חדשה בקליטה באזור           | new                                                 | published | 1       | 11    |
| domestic/O-10 - בדיקת מפת כיסוי ואנטנות           | O-10 | `145fe6f9-be12-41c2-8b69-7be74b127015` | `kira-o-10` | בדיקת מפת כיסוי ואנטנות          | new                                                 | partial   | 1       | 7     |
| domestic/O-12 - הפעלת שיחות ברשת אלחוטית          | O-12 | `e721043a-e35f-4bad-8965-b40cbf9d228f` | `kira-o-12` | הפעלת שיחות ברשת אלחוטית         | new                                                 | published | 1       | 13    |
| domestic/איפוס הגדרות רשת O-13                    | O-13 | `511a7481-eea1-469b-8c9e-cb5f745202ad` | `pdf-005`   | איפוס הגדרות רשת                 | supersedes "מדריך איפוס הגדרות רשת"                 | published | 2 → 3   | 17    |
| domestic/E-10 הסלמה למומחה – בעיות קליטה בארץ     | E-10 | `be099868-fa30-4f64-8550-604088e0c98f` | `kira-e-10` | הסלמה למומחה – בעיות קליטה בארץ  | new                                                 | published | 1       | 7     |
| domestic/T-10 - תיאום ציפיות רשת סלולארית         | T-10 | `bcade3f2-9855-489a-87c0-7d3c7beec47f` | `kira-t-10` | תיאום ציפיות רשת סלולארית        | new                                                 | published | 1       | 11    |
| roaming/מפת ידע רומינג.xlsx                       | —    | —                                      | —           | —                                | explicit `related` links (M-00 → R/O/E/O-06, …)     | —         | —       | —     |
| domestic/מפת ידע בעיות קליטה בארץ.xlsx            | —    | —                                      | —           | —                                | explicit `related` links (M-10 → R-11..R-13, …)     | —         | —       | —     |

Worlds: roaming → `intl`; domestic → `tech`, all nine domestic documents in the topic "בעיות קליטה
בארץ" (`topic-14`, the legacy topic of the document M-10 supersedes, renamed); O-13 also keeps its
own legacy topic. `partial` = the source carries an explicit "to complete" note (shown as the step
hint "להשלמה: …").

### Evidence

- **Deterministic:** `convert:kira` run twice — the second time with `convert:legacy` under
  `TZ=America/New_York` and the overlay under `TZ=Asia/Tokyo` — gives byte-identical
  `apps/api/seed/*.json` (sha1 compared). `convert:legacy` alone now regenerates the committed legacy
  JSON byte-identically as well (time zone and the bundle's clock pinned, output through Prettier).
- **Contract:** every generated document and version snapshot is parsed with `DocumentSchema` by
  the converter; the ERRATA table fails the run if a correction no longer matches its source text.
- **Empty database, repo seed command:** `pnpm migrate` + `pnpm seed` on a fresh Postgres →
  `seeded { documents: 31, cards: 29, topics: 52, blocks: 4, fields: 14, scripts: 7, versions: 48,
notes: 1 }`. SQL spot checks: all 21 Kira documents present with the doc type of their code, ids
  above, `current_version` = legacy + 1 on the superseded ones with both versions in
  `document_versions`; T-10 steps carry their scripts; M-00 has 22 outgoing document edges.
- **Tests:** `apps/api/test/seed.test.ts` — document count 23 → 31 (the only changed assertion) and
  a new "Kira base knowledge" suite: superseded ids/slugs/versions stable, new documents typed and
  in their world, O-01 absent, the domestic topic membership, map and text links present
  (incl. the R-05 erratum), no dangling `related` or `document_links` targets, R-02 keeps its two
  shared-block references, T-10 scripts and objections, O-04 partial with its hint.
- **Gates:** typecheck (all packages) ✓ · lint (eslint + prettier) ✓ · shared unit 123/123 ✓ ·
  api unit 280 passed (494 integration-only skipped) ✓ · api integration (`RUN_INTEGRATION=1`,
  run in two halves) 119/119 files, 774/774 tests ✓ (`test/int` 32 files / 211 tests; the rest
  87 files / 563 tests).
- **Other seed consumers:** the AI eval harness cases (`packages/model/eval/cases/*.json`) carry
  their own synthetic documents (ids `1111…`/`2222…`/`3333…`) and reference no seed document — none
  is affected. The web e2e specs that name seed titles run against msw fixtures, except the real-stack
  ones, which only use the legacy "איטיות גלישה / חוסר גלישה" (unchanged). `load-fixture`/perf build
  their own data.

### Known gaps carried over from the sources (owner to decide)

- **Not supplied, referenced:** O-01 (empty file), R-10, R-14, O-11, O-14, S-10 (specialist route),
  H-01/H-02 (roaming packages list, operators list), H-11, the separate "אין קליטה / אין שירות
  בארץ" diagnosis, the SMS verification-code document, the CSP-profile operations document, a
  domestic APN document ("O-32"). References stay as plain text; knowledge-map links to them are
  skipped (the converter prints the list).
- **Corrected references (ERRATA in the converter):** M-00 "R-05 שיחות נכנסות" → R-04 and "R-06
  הודעות" → R-05 (the map routes incoming calls to R-04, messages to R-05); R-05 "O-06 בחירת רשת
  ידנית" (×2) → O-05; R-11 "T30" → T-10.
- **Left as written:** M-10 "M30 / R33" and R-12 "M-30" (the slow-browsing diagnosis; the quoted
  title is linked to the legacy browsing procedure T-01); M-10's last option ends mid-sentence in the
  source; drafting notes such as "אין באפשרותי לאשר…" and "במסמך ההשוואה הקיים אצלכם" are in the
  source text and were kept verbatim.
- **Legacy documents built from the OLD roaming set** (`pdf-004` "לקוח לא מוצא רשת בחו"ל",
  `pdf-010` "תקלת גלישה בחו"ל") and the two legacy reception scripts linked from M-10 are untouched.

## Merged gate (waveY/integration, wave 6 gate + wave Y + review fixes)

One run on the final tree, 2026-10-02. Integration tests ran on one Postgres server with per-file
databases cloned from a migrated template (`test/helpers/db.ts`, `TEST_DATABASE_URL`).

| Gate | Result |
|---|---|
| build, typecheck, lint | pass |
| `pnpm openapi` | regenerates with no diff |
| unit: shared / model / connectors / web | 124 / 114 / 49 / 954 |
| api integration (126 files) | 844 / 844 in 81 s |
| `pnpm e2e:real` | 17 / 17 (incl. W6-E2E-1 under the Kira seed) |
| `E2E_OIDC=1 pnpm e2e:real` | 18 / 18 |
| `pnpm e2e:compose` | 15 / 15 |
| model eval | not re-run: nothing in wave Y touches prompts or generation; the wave 6 gate's run on 1693498 matches the fix-wave table to three decimals (rules 1.000/1.000/0.932/1.000; tier 1 1.000/1.000/0.977/1.000) |

Review (two read-only reviewers, API and web): no Critical. Important findings fixed — learning
items re-checked against their derived worlds after a write (cd8669c), trash block/field restore
and purge follow the every-world rule (cd8669c), web write gates pass the document's worlds and
builders are keyed per item (2368e4a), trash rows carry worlds (94d87ec), template build hardening
(6660d99). Known noise: web unit logs MSW warnings for `GET /ai/proposed-edits/:id` (unmocked since
wave 6; no test depends on it).
