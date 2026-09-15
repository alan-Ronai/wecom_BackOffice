# Wave 6 — acceptance

Spec: `docs/superpowers/specs/2026-09-15-kb-wave6-ai-copilot-design.md`.
Contract: `docs/api/CONTRACTS-wave6.md`. Merge log: `docs/wave6-merge-log.md`.
Branch: `wave6/integration`, lanes X0–X4b merged, integrated and gated by X6.

## §1 decisions → evidence

| # | Decision | Lanes | Evidence |
|---|---|---|---|
| 1.1 | Everything local, model choice is a configuration tier | X0, X1 | `apps/api/test/unit/model-slots.test.ts`, `apps/api/test/unit/tier-table-drift.test.ts` (the tier table agrees in `MODEL_TIER_PRESETS`, `deploy/ollama-pull.sh` and `deploy/smoke.sh`), `deploy/ollama-pull-check.sh` |
| 1.2 | Two generation slots; embedder moves to a multilingual one with `EMBED_DIMENSION` held at boot | X0, X1 | `apps/api/test/int/embed-dimension.test.ts`, migration 0051 + `apps/api/test/migrations.test.ts` ("0051 rebuilds documents.embedding…"), `apps/api/test/int/ai-reindex.test.ts` |
| 1.3 | The chat never writes: edits are **proposed**, a person decides | X2, X4a | `apps/api/test/ai-proposed-edits.test.ts` (7), `apps/api/test/unit/ai-proposed-edits.test.ts` (9), `apps/web/test/workspace/ProposedEditsOverlay.test.tsx`, **W6-E2E-1 stages 2–3** (the source version moves through the decision, and the proposal row records who decided it), **W6-E2E-2 stage 2** (an `ai.ask` caller is refused the write tool) |
| 1.4 | Chat in three places, tools by permission | X2, X4a, X4b, X6 | `apps/api/test/ai-chat.test.ts` (tool sets per role), `apps/web/test/integration/wave6-mounts.test.tsx` (the three mounts and their permission gates), **W6-E2E-1** (workspace) and **W6-E2E-2** (article) |
| 1.5 | Every chat persisted and exportable | X2, X4b | `apps/api/test/int/ai-admin.test.ts`, `apps/web/test/admin/AiConversations.test.tsx`, **W6-E2E-2 stages 3–5** (the transcript carries the tool calls, feedback is recorded, the JSONL export contains the conversation) |
| 1.6 | Impact-aware generation; every suggestion carries `affects` | X1, X2, X6 | `apps/api/test/int/suggestions-affects.test.ts`, `apps/api/test/int/wave6-seams.test.ts` ("the chat impact port answers from X1 ImpactService"), `apps/web/test/workspace/SuggestionsPanel.test.tsx`, **W6-E2E-1 stage 4** |
| 1.7 | Prompt v3 = brief + architecture + style + task rules, versioned | X1, X4b | `apps/api/test/unit/ai-prompt.test.ts`, `packages/model/test/prompt.test.ts`, `apps/web/test/lib/promptPreview.test.ts`, `apps/web/test/admin/AiPrompts.test.tsx` |
| 1.8 | Structured suggestion editing with partial apply; original, edited and diff all stored | X3, X4a, X6 | `packages/shared/test/suggestions-structured.test.ts` (18), `apps/api/test/sources/suggestions.test.ts`, `apps/web/test/workspace/suggestionRows.test.ts`, `apps/api/test/int/wave6-seams.test.ts` ("a partial accept copies X1 provenance onto the remainder"), **W6-E2E-1 stage 5** |
| 1.9 | Accuracy measured offline, acceptance measured live | X1, X3, X4b | `packages/model/test/eval.test.ts`, § "Model evaluation" below, `apps/api/src/modules/sources/analytics.ts` + `apps/api/test/sources/routes.test.ts`, `apps/web/test/admin/AiEvalAnalytics.test.tsx`, **W6-E2E-1 stage 6** |
| 1.10 | Paragraph → step mapping scores on embeddings, falling back to trigram | X1 | `apps/api/test/int/search-embeddings.test.ts`, `apps/api/src/modules/sources/embeddings.ts`; X6 mounted `refreshStepEmbeddings` beside `updateEmbedding` at publish and restore, so the mapping does not wait for a reindex |

## Model evaluation — tier 0 vs tier 1

**Machine: a dev laptop, not the VM** (Apple Silicon, 10 cores, 34 GB, load average ≈ 10 during
the runs). The VM is the reference; these numbers are directional and the VM run is still owed
before the pilot. Harness: `packages/model/eval`, the eight committed Hebrew cases, prompt
`propose-v3`, one pass per tier, no fallback (a model that cannot answer scores as a failure).

| Run | suggest model | embedder | cases | hit-target | hit-type | content overlap | median s/case | schema failures |
|---|---|---|---|---|---|---|---|---|
| rules floor | `RuleBasedModel` (deterministic) | — | 8 | **0.875** | **0.750** | **0.438** | <0.01 | 0 |
| tier 0 | `qwen2.5:3b-instruct-q4_K_M` | `nomic-embed-text` (768) | 8 | 0.000 | 0.000 | 0.000 | 4.3 | 8 |
| tier 1 | `aya-expanse:8b-q4_K_M` | `bge-m3` (1024) | 8 | 0.000 | 0.000 | 0.000 | 12.6 | 8 |

Tier 1's run predates the per-type target rule described below; the rule can only make the parse
stricter, so its 0.000 stands. Tier 0 was re-run after it — its earlier 0.125 came from the one
case that had been scored on a suggestion no editor could ever have applied.

**The headline number is 0.000** (A-M10). A lane report written before the re-run quotes tier 0 at
**0.125**; that figure is superseded and this table is the one to read. Nothing in the repository
still carries it — `X6-report.md` lives outside the tree — but if a copy surfaces, this paragraph
is the reconciliation.

RAM was not isolated per run (a shared laptop with the browser and three Postgres containers up);
Ollama's resident set was ~2 GB for tier 0 and ~6 GB for tier 1, consistent with spec §6.

### Substitution

`dictalm2.0-instruct:7b-q4_K_M`, which tier 1 named, **does not exist in the Ollama library** —
`ollama pull` answers `file does not exist`. Spec §6's first fallback, Aya Expanse 8B, does, so
tier 1 (and tier 2's chat slot) now name `aya-expanse:8b-q4_K_M` and tier 1's own fallback becomes
`qwen2.5:7b-instruct-q4_K_M`. Changed in `MODEL_TIER_PRESETS`, mirrored to `deploy/ollama-pull.sh`,
`deploy/smoke.sh`, `deploy/.env.example`, `docs/operations.md` and `CONTRACTS-wave6.md`; the new
`apps/api/test/unit/tier-table-drift.test.ts` fails if those copies ever disagree again.

### What the run found in the harness, and what the harness was hiding

`RESPONSE_FORMAT`, the JSON schema Ollama is handed, deliberately leaves
`targetDocumentId`/`targetStepKey`/`targetBlockId` out of `required` — a suggestion that targets a
document has no step key, one that targets a block has no document — while the zod parse spelled
all three `.nullable()`, which in zod still demands the key be present. The model was told the
field was optional and then rejected for omitting it, and a 3B does not emit
`"targetBlockId": null`. The parse now reads absent as null.

That first relaxation went one step too far and `pnpm e2e:compose` caught it: the apply path
resolves the targets and 404s when it cannot, so an `update-step` with no step key is not a worse
suggestion but one that can never be accepted — and the WordPress spec's publish answered 404. The
requirement is **per type** (`update-step` and `deprecate-step` need a document and a step,
`update-block` a block, `new-step` a document, `new-card` and `field-alert` none), which
`RESPONSE_FORMAT` cannot express and a `superRefine` can.

With that in place the honest reading of tier 0 is **0.000, with all eight cases failing the
parse**, and the failures say why: the model answers `update-step` and never names the step. The
0.125 in the first corrected run was one case scored on a suggestion the apply path would have
refused. The relaxation is still right — it is what stops a `new-card` being rejected for lacking
a `targetBlockId` — it is simply much smaller than it first looked.

### Ruling

The plan's condition — *tier 1 becomes the default only if its hit-target ≥ tier 0's* — is met
only trivially: **both score 0.000**. Both local generation models are far below the deterministic
rule engine (0.875), which is the floor a tier is supposed to beat, and neither produced a single
applicable suggestion on this machine.

`MODEL_TIER=1` is nevertheless left as `deploy/.env.example`'s default, for three reasons, and
parked for the VM to settle:

1. The numbers are from a loaded dev laptop, not the 4 vCPU VM the tiers are specified against,
   and the plan itself says a non-VM run is directional only. Two of the eight cases fail on the
   payload discriminator rather than the target, which reads more like a prompt problem than a
   model-size one.
2. Half of what tier 1 buys is the **embedder** — `bge-m3`, multilingual, 1024 dims — which this
   harness does not score at all, and which migration 0051, the reindex job and the compose gate
   are all built around. Reverting the tier to 0 to chase a generation number would unwind the
   embedding half of the wave on evidence that does not speak to it.
3. The rule engine is not bypassed in production: `OllamaModel` is constructed with it as the
   fallback (`apps/api/src/plugins/model.ts`), so a model whose answer fails the schema does not
   produce a worse suggestion, it produces the rule-based one. The eval client is the exception —
   it runs without the fallback on purpose, which is why these numbers are so stark.

**Owed before the pilot:** run both tiers on the VM, and if tier 1 still does not beat tier 0 there,
switch the default to `MODEL_TIER=0` (keeping `EMBED_MODEL=bge-m3` and `EMBED_DIMENSION=1024`
explicitly, which `resolveModelSlots`' explicit-env precedence supports) and re-open prompt v3.

## Gates

| Gate | Result |
|---|---|
| `pnpm install` · `pnpm -r build` · `pnpm typecheck` · `pnpm lint` | clean |
| `@wecom/shared` | 123 passed / 17 files |
| `@wecom/connectors` | 49 passed / 8 files |
| `@wecom/model` | 61 passed / 11 files |
| `apps/api` unit | 256 passed (485 integration-only skipped) |
| `RUN_INTEGRATION=1 apps/api` | 741 passed / 117 files |
| `apps/web` (`--minWorkers=1 --maxWorkers=4`) | 884 passed / 134 files |
| OpenAPI regen + contract + route coverage | clean; 174 paths, allowlist free of dead entries |
| `pnpm e2e:real` | **17 passed**, including W6-E2E-1 and W6-E2E-2 |
| `E2E_OIDC=1 pnpm e2e:real` | **18 passed** (the OIDC variant adds one spec) |
| `pnpm e2e:compose` | **15 passed** — the WordPress publish spec, which the per-type target rule repaired |
| `pnpm --filter @wecom/api perf:check` | PASSED, every endpoint inside its §11 p95 threshold |
| Migrations | `0050`–`0054`, nothing at `0055`+ |

The two new specs found five real defects between them, each listed in the merge log: the
scripted model's tool-turn test, its intent matching against the context block, the structured
editor sending display strings, and — in the specs themselves — two wrong assumptions about the
product (that "קבל הכל" leaves the decision to a second click, and that an admin may rate a
message they did not send).

## Parked

| Item | Ruling | Cost if wrong |
|---|---|---|
| Tier 1 is the default on a dev-machine evaluation that does not support it | Keep `MODEL_TIER=1` (the embedder half is what 0051 and the compose gate are built on) and run both tiers on the VM before the pilot | A pilot runs generation on a model that is worse than the rule engine it falls back to — costly in review time, not in correctness, because the fallback catches a schema failure |
| Both local models score **0.000** against `RuleBasedModel`'s 0.875, every case failing the schema | Recorded, not fixed: prompt v3 and the case set are X1's, and one 8-case run on a loaded laptop is not enough to re-open either. Production is not affected in the same way — `OllamaModel` falls back to the rule engine on a parse failure, which is what the compose gate exercises | Prompt v3 may be over-long, or under-specific about naming the target step, for a 3–8B model; the next eval run on the VM is what settles it |
| Chat quality is proven by the scripted client in e2e, by the eval harness otherwise | Real inference in the gate would be slow and non-deterministic; the orchestrator, the tools, the persistence and the apply path are the same code either way | A prompt regression is caught by an eval run, not by CI |
| `ScriptedChatModel` is reachable under `NODE_ENV=production` when `WECOM_E2E_RUNNER=1` | Accepted: `e2e:real` runs the API as production on purpose, and `WECOM_E2E_RUNNER` is the marker `config.ts` already treats as "this is the e2e stack". A deployment sets neither it nor `AI_TEST_SCRIPT` | An install that sets both gets a fake chat that answers plausibly; the boot log warns |
| `streamChat` cancels by closing the response reader rather than passing the `AbortSignal` to `fetch` | Accepted (X4a): under jsdom the app's signal is jsdom's and `fetch` is undici's, which rejects a foreign signal outright | A request cannot be aborted before headers arrive; after that the reader close ends it |
| The admin transcript `feedback` filter is applied in the browser | Accepted: `ConversationsQuerySchema` has no such field, and adding one is an API change no lane owned | A page of transcripts can show fewer rows than the page size when the filter is on |
| Per-process chat rate limit (`Map<userId, number[]>`) | Accepted (X2): it guards the single CPU inference slot on this box. **Fix wave (A-M1):** the budget is now consumed *after* the 503 availability check, and the map evicts users whose window has expired | A second API instance gets its own budget |
| `probeToolSupport` caches a successful tool probe for the life of the process | Accepted (X2) | A tag that gains tool support after a pull needs a restart |
| `confidenceFor` clamps `new-card` at 0.75 | Accepted (X1): a whole new card is the proposal an editor should always look at | A genuinely certain new card still asks for a read |
| `adminHook.ts` (`registerAdmin`) is unused | X1 registered its admin routes under `modules/admin/routes.ts` instead; the hook is a no-op left in place. **Fix wave (A-M11):** `ai/index.ts` no longer re-exports `registerAdmin`, and the file says it has no caller; `runAdminRegistrar` stays because it is what lets the chat half boot with the admin half absent | Dead code, ~30 lines; removing the rest is a lane cleanup, not a fix |
| msw fixtures and `packages/shared/test/pipeline.test.ts` still carry `dictalm2.0-instruct:7b-q4_K_M` as a sample tag | Left: they are arbitrary strings in fixtures, and the operational copies are all corrected | A reader of the fixtures could believe the tag exists |
| `SuggestionAnalyticsTab` is gated on `analytics.read` while `GET /suggestions/analytics` requires `suggestions.review` | **Resolved in the fix wave:** `CONTRACTS-wave6.md` now states `suggestions.review` as the contract for both the route and the tab; the tab change is the web fixer's | An operator with `analytics.read` but not `suggestions.review` sees the tab and gets a 403 inside it |

## Fix wave — API

Package A of the wave 6 review (`findings-A.md`). A-C1, A-I1…A-I8 and the minors A-M1, A-M2,
A-M3, A-M5, A-M6, A-M8, A-M9, A-M10, A-M11 are **fixed** on `fix/wave6-api`; the report is
`.superpowers/sdd/program/fix-wave6-api-report.md` and the contract changes are in
`docs/api/CONTRACTS-wave6.md`. What is left, and what it costs if the ruling is wrong:

| Item | Ruling | Cost if wrong |
|---|---|---|
| **A-M4** — `embeddingMapping` (`sources/mapping.ts`) runs one `order by embedding <=> …` query per paragraph inside the pipeline job | Parked. It is a queued job, not a request path, and the per-paragraph query is what makes the fallback-to-trigram decision readable one paragraph at a time. A `lateral` join would fold N round trips into one but changes the scoring code the eval harness is calibrated against. The file is also the AI lane's in this fix wave | A large first import is slow — N round trips against a local Postgres, tens of ms each. No correctness cost; the job resumes from its watermark |
| **A-M7** — every revision writes the full non-`same` diff set (before *and* after text for every changed paragraph) into `source_revisions.meta->'diffs'`, uncapped and never pruned | Parked. `meta->'diffs'` is what `fewShotExamples` reads to build the few-shot block and what the acceptance analytics join against, so a cap has to decide *which* diffs survive, and that is a product decision about what a revision's record is — not a fix-wave one | A large WordPress source keeps roughly a second copy of the document per revision, forever. Storage, on a LAN VM with a Postgres nobody vacuums aggressively; no read path degrades, because every consumer filters by anchor first |
| **A-M5 (second half)** — migration 0051 reads `process.env` directly while the API reads a zod-parsed `Config` | Parked as documented-only, as before. The `down` half **is** fixed (the width is recorded and restored). A migration runner whose environment differs from the API's still produces a column the boot check then refuses — which is the *correct* failure, loudly, at boot | An operator who runs `pnpm migrate` with a different env than the service gets a boot refusal naming 0051, not a silent wrong-width column |
| **Dashboard pipeline panel** (found while adding the A-I6 scope-leak rows, not in `findings-A.md`) | **Fixed, not parked**: `pipeline.bySource` returned source *titles* to any caller, and a source's title is the document's. It now uses A-I6's `suggestionVisibleSql`, so the panel and the queue it links to agree on one row set. The `sync` panel stays org-wide — `sync_links` are connector plumbing | — |
