# Wave Y — acceptance

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
