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

> **Superseded by the fix wave below.** The 0.000 rows above were a grammar defect, not a model
> one, and they are resolved. They are left in place because the ruling that followed from them —
> and the reasoning behind keeping `MODEL_TIER=1` — is part of the record.

## Fix wave — generation quality

`review/wave6-ai-quality` reproduced both 0.000 runs exactly and found that neither model was
failing the task. The shipped `RESPONSE_FORMAT` left `targetDocumentId`/`targetStepKey`/
`targetBlockId` out of `required` (in a JSON-schema grammar, *skippable* — and a 3B always takes
the short branch) and gave `payload` no properties at all, so the six-arm discriminated union was
described only in Hebrew prose and then enforced by zod. The models were answering correctly and
being rejected for a grammar nobody had written.

**What changed** (`fix/wave6-ai`, findings C-C1…C-C5, C-I1…C-I8, C-M1/C-M3/C-M4):

- `packages/model/src/flat.ts` is the default response format — flat, fully `required`, every
  identifier an `enum` of the ids in *this* context — re-inflated into the discriminated union in
  code. `PROMPT_VERSION` is `propose-v4`; the nested envelope survives behind
  `OllamaOptions.legacyEnvelope` as the control arm of the A/B.
- `temperature: 0`, no `num_predict`, `num_ctx` sized from a **token** budget (2.6 chars/token,
  measured on this Hebrew+JSON mix) rather than a char budget compared against a token window.
- Per-suggestion tolerant parse, an anchor back-fill for ids the context already holds, and the
  deterministic guards (`guard.ts`) run even when the model's answer was unusable.
- Model confidence goes through `confidenceFor`; editors were being shown `0.95` on everything.
- The rule engine tells a change from noise (`material.ts`) and gained the two branches it never
  had: `new-step`, and `field-alert` for an *unknown* field.
- The harness gained a **precision** score, a **language check**, `mustContainAny` with Hebrew
  prefix-clitic normalisation, and 14 new cases (8 → 22), six of them negative.

**Machine: the same dev laptop, not the VM.** 22 committed Hebrew cases, prompt `propose-v4`, flat
schema, guards on, `temperature: 0`, one pass per tier, no fallback.

| Run | suggest model | embedder | cases | hit-target | hit-type | overlap | precision | language failures | schema failures | median s/case | Ollama RSS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| rules floor | `RuleBasedModel` | — | 22 | **1.000** | **1.000** | 0.932 | **1.000** | 0 | 0 | <0.01 | — |
| tier 0 | `qwen2.5:3b-instruct-q4_K_M` | `nomic-embed-text` (768) | 22 | **1.000** | **1.000** | 0.909 | 0.962 | **8** | 0 | 5.2 | ~2.4 GB |
| tier 1 | `aya-expanse:8b-q4_K_M` | `bge-m3` (1024) | 22 | **1.000** | **1.000** | **0.977** | **1.000** | **0** | 0 | 12.2 | ~5.8 GB |

Reproducible: `temperature: 0`, and three consecutive runs of each tier gave identical scores.

Both tiers went from **0.000/0.000/0.000 with 8/8 schema failures** to **1.000/1.000** with none.
The rules floor also rose (0.875/0.750/0.438 → 1.000/1.000/0.932) because the same wave fixed two
real gaps in the deterministic engine, so the model is being measured against a harder floor than
before, not an easier one.

**Reading the three columns that still separate them:**

- **Content overlap** is where the model earns its place: 0.977 (tier 1) against the rule engine's
  0.932, and the two cases the engine cannot win are the ones that ask the rationale to name the
  impact — the thing §1.6 is for. Tier 0 is *below* the rules floor here (0.909).
- **Precision** is the counterweight the harness never had. Before it, a shotgun client emitting
  one suggestion per (type × candidate) with a keyword-stuffed title scored a perfect
  1.000/1.000/1.000 on all eight old cases. Tier 0's 0.962 is one over-proposal; tier 1 has none.
- **Language failures** are the strongest argument in the evidence and were invisible until now.
  `qwen2.5:3b` code-switches out of Hebrew in **8 of 22** cases and `aya-expanse:8b` in **none**.
  The offending words are recorded per case in the `--out` file; qwen's are dominated by the
  Indonesian `ubah` ("change"), which appears in seven of the eight, alongside bare English
  (`string`, `proposal`) and truncated fragments (`ffects`, `zd`, `la`). This is `title` and
  `rationale` text — what a content owner reads in the review queue — and no score saw it before.

The six negative cases are worth naming separately: **both** models proposed on noise —
`aya-expanse:8b` on all six, `qwen2.5:3b` on one — until the pipeline stopped showing them noise
(`materialDiffs`) and started dropping answers anchored outside it (`dropUnanchored`). Asking the
prompt more firmly fixed five of qwen's six and none of aya's. This is the failure mode that would
have buried the pilot's review queue, and nothing in the wave-6 harness could see it.

### Ruling

`MODEL_TIER=1` **stays the default**, now on evidence rather than in spite of it: tier 1 beats
tier 0 on overlap (0.977 vs 0.909), on precision (1.000 vs 0.962) and on language (0 code-switched
cases against 8), and the plan's condition (tier 1's hit-target ≥ tier 0's) is met at 1.000 each.
The cost is 12.2 s/case against 5.2 on this laptop.

**Remaining sign-off item: the VM re-run.** These numbers are from a dev laptop; the VM is 4 vCPU
and should be expected at roughly 3× the latency, which the queued pipeline absorbs. Run:

```
pnpm --filter @wecom/model eval --rules
pnpm --filter @wecom/model eval --model qwen2.5:3b-instruct-q4_K_M --embed nomic-embed-text --out /tmp/tier0.json
pnpm --filter @wecom/model eval --model aya-expanse:8b-q4_K_M      --embed bge-m3           --out /tmp/tier1.json
```

If tier 1 exceeds ~60 s/case there, fall back to `MODEL_TIER=0` while keeping `EMBED_MODEL=bge-m3`
and `EMBED_DIMENSION=1024` explicitly — tier 0 with this fix is above the old rules floor on every
metric, and its weaknesses (overlap, code-switching) are quality rather than correctness. The
`--out` file records the offending words per case, so the language column is actionable on the VM
without re-reading raw output by hand.

## Merged gate

Run on `wave6/gate`, cut from `wave6/integration` with `main` already an ancestor. The numbers in
the fix-wave tables above are per-lane; these are the whole wave on one tree.

### Prompt provenance now tracks the prompt

`currentPromptVersion` stamped the literal `v3.<brief>.<style>` onto every suggestion and every
chat message, and had done so since the fix wave shipped `propose-v4`: the one field whose job is
to answer "which prompt produced this row" was naming a prompt that no longer runs. The prefix is
now derived from `PROMPT_VERSION` in `@wecom/model` (`propose-v4` → `v4`), exported as
`PROMPT_FAMILY`, so a future `propose-v5` restamps without anyone remembering a literal.

Three places moved with it: the unit test's expectation, the two integration assertions
(`ai-admin`, `suggestions-affects`, both of which matched `/^v3\./` and now match the derived
family), and `apps/web/src/lib/promptPreview.ts` — the admin preview's mirror of the same string,
which the web bundle has to spell out because it does not depend on `@wecom/model`. Without the
last one the settings screen would show an admin a version that appears in no row they can look
up. Rows written before this change keep their `v3.*` stamp; nothing rewrites history, and the
analytics breakdown by prompt version is the place the cutover is visible.

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

The table above is the gate on the integration branch *before* the AI residual (e21471d) merged.

### Gate after the AI residual (`1858816` → `15d452f`, 2026-09-29)

Run on the same dev laptop (10 cores, 34 GB). It was **stopped before the end** at the owner's
request, because the machine was needed. Load average ran 4–67 during the run: other sessions'
stacks, and at 11:15–11:18 Docker Desktop was restarted under the run. What is below was verified
green. Whatever is marked *superseded* is carried by the combined-branch gate that runs next.

| Gate | Result | Tree |
|---|---|---|
| `pnpm install` · `pnpm -r build` (5 projects) · `pnpm typecheck` · `pnpm lint` | clean | `1858816` |
| `pnpm openapi` | regenerates byte-identically (174 paths), no diff | `1858816` |
| `apps/api/test/route-coverage.test.ts` | 4 passed | `1858816` |
| `@wecom/shared` | 123 passed / 17 files | `1858816` |
| `@wecom/model` | 114 passed / 14 files | `1858816` |
| `@wecom/connectors` | 49 passed / 8 files | `1858816` |
| `apps/api` unit | 280 passed, 491 integration-only skipped / 120 files | `15d452f` |
| `apps/web` (`--minWorkers=1 --maxWorkers=4`) | 900 passed / 134 files | `1858816` |
| `RUN_INTEGRATION=1 apps/api`, full run | **769 passed / 119 files**, one run, no retries | `1693498` |
| — the same, after `15d452f` | *superseded by the combined gate.* The re-run straddled the Docker restart (every failure was `Could not find a working container runtime strategy` / `ECONNREFUSED`), and its replacement was stopped on request. `15d452f` is covered by the files it touches: the new `step-embeddings-lock-order` 2/2 (×3), with `ai-reindex`, `mapping-embeddings`, `search-embeddings`, `wave5-seams`, `wave6-seams` and `migrations` at 48/48 | `15d452f` |
| `deploy/compose-check.sh` · `nginx-check.sh` · `smoke-check.sh` · `backup-check.sh` | green | `1858816` |
| `deploy/ollama-pull-check.sh` | **red, then green after `1693498`** (see below) | `1693498` |
| `pnpm e2e:real` (ports 56432/3191/4191; 55432 belonged to another session) | **17 passed** (2.4 m), after `ba9d7b4` | `ba9d7b4` |
| `E2E_OIDC=1 pnpm e2e:real` (issuer on 9411) | **18 passed** (2.4 m) | `ba9d7b4` |
| `pnpm e2e:compose` | **15 passed** (33.7 s) | `ba9d7b4` |
| `pnpm --filter @wecom/api perf:sql` · `perf:check` | *superseded by the combined gate* (not started) | — |
| Migrations | `0050`–`0054`, nothing at `0055`+ | — |

**Model eval, merged tree.** 22 cases, `propose-v4`, flat schema, guards on, one pass per tier:

| Run | hit-target | hit-type | overlap | precision | language failures | schema failures | median s/case |
|---|---|---|---|---|---|---|---|
| rules floor | 1.000 | 1.000 | 0.932 | 1.000 | 0 | 0 | <0.01 |
| tier 0 `qwen2.5:3b-instruct-q4_K_M` + `nomic-embed-text` | 1.000 | 1.000 | 0.909 | 0.962 | 8 | 0 | 7.36 |
| tier 1 `aya-expanse:8b-q4_K_M` + `bge-m3` | 1.000 | 1.000 | 0.977 | 1.000 | 0 | 0 | 12.06 |

The scores match the fix-wave table to the third decimal on every row. The residual's CLI change
(a crashed case scores as a schema failure) did not move them, because no case crashed. Tier 0's
latency is 7.4 s against the fix wave's 5.2 s because it ran beside the integration suite, at load
average 11 → 51. Tier 1 ran alone and matches (12.1 vs 12.2).

### Three defects the gate found, each fixed on `wave6/gate`

- **`1693498` — `deploy/ollama-pull-check.sh` still expected `dictalm` for tiers 1 and 2.** The
  tier-1 substitution moved `MODEL_TIER_PRESETS`, `ollama-pull.sh` and `smoke.sh` but not the
  check's expectations, so the check failed on `MODEL_TIER=1`. It now expects `aya-expanse:8b`.
  The slot-override case now overrides with a tag that differs from the preset, so it still proves
  the override wins. Covered by the script itself, which is green.
- **`ba9d7b4` — W6-E2E-1 failed on three wrong assumptions of its own.** The web fix wave
  (`f3c0cdd`) made required rows ticked-and-locked in the quick picker. The spec's
  `checkbox.first()` on a `new-card` is the required card-meta row, so its tick was a no-op and
  "החל חלקית" stayed disabled until the 7-minute timeout. It reproduced twice, at load 15 and at
  load 67, so it was not a flake. Two more faults surfaced while fixing that:
  - "Any pending suggestion" was already satisfied by the source's first revision, before the chat
    answered.
  - The spec relied on `feedback-loop.spec.ts` having created the source document. Run alone, it
    died on a 204.

  It now targets the pending suggestion on the latest revision carrying its stamp, addresses that
  card by its position in the list the panel renders, ticks an optional row, and creates the source
  document when none exists. It passes alone (2 passed) and in the full run (17 passed).
- **`15d452f` — Postgres deadlock (40P01) between `PUT /documents/:id/structure` and the
  background step-embedding writer.** The controller first saw it as a 500 in `wave5-seams`
  "change-preview…". The two paths took the same locks in opposite orders:
  - `saveStructure` locks the `documents` row `for update`, then its `delete from phases`
    cascades into `steps`.
  - The writer's `insert into step_embeddings` fired its FK checks the other way round: key share
    on the step first, then on the document.

  The insert now key-shares the document first (an init-plan) and the step second
  (`for key share of s`). A step deleted meanwhile is skipped instead of tripping the FK. The
  function now returns the rows it actually wrote. The new `step-embeddings-lock-order.test.ts`
  builds the interleaving by hand. It failed with `deadlock detected` before the fix and passes
  after it, on three repeat runs.

**Observed, not changed:** a source that feeds a document but has no step anchored to its
paragraphs takes the new-source path on every revision. Each unaccepted revision also adds its
own pending `new-card` beside the last one: two identical cards for `§p-1` in W6-E2E-1's run,
because the pipeline diffs against the last *accepted* revision and nothing supersedes older
pending rows. This behaviour predates the residual. It is a candidate for the parked list, not a
gate defect.

## Parked

| Item | Ruling | Cost if wrong |
|---|---|---|
| ~~Tier 1 is the default on a dev-machine evaluation that does not support it~~ | **Resolved by the fix wave.** Tier 1 now beats tier 0 on overlap (0.977 vs 0.909), precision (1.000 vs 0.962) and language (0 vs 8 code-switched cases). `MODEL_TIER=1` stays, on evidence. The VM re-run is still owed and is the one remaining sign-off item | — |
| ~~Both local models score **0.000**, every case failing the schema~~ | **Resolved by the fix wave.** It was a grammar defect: the three target fields were optional in `RESPONSE_FORMAT` and mandatory in the parse, and `payload` had no properties at all. Both tiers are now 1.000/1.000 with zero schema failures. See § "Fix wave — generation quality" | — |
| Precision and the language-failure count are recorded in `ai_eval_runs.notes`, not in columns of their own | Accepted (fix wave): adding columns means a migration, an `EvalRunSchema` change and an openapi regeneration, none of which a generation-quality fix should carry. The CLI reports both, `--out` records the offending words, and the admin page shows the note | An admin sorting runs by precision has to read the note; nobody can chart it yet |
| The model is shown only `materialDiffs`, and answers anchored outside that set are dropped | Accepted (fix wave): the pipeline, not the model, decides that a spelling fix is not a procedure change, and both tiers proposed on noise until it did. `material.ts` is conservative — a changed number, latin token or quoted string is always material | A change that is material in a way the token rules miss (a Hebrew-only word swap inside a long sentence) reaches neither the model nor the queue; the six negative cases are what would catch a regression here |
| Chat quality is proven by the scripted client in e2e, by the eval harness otherwise | Real inference in the gate would be slow and non-deterministic; the orchestrator, the tools, the persistence and the apply path are the same code either way | A prompt regression is caught by an eval run, not by CI |
| `ScriptedChatModel` is reachable under `NODE_ENV=production` when `WECOM_E2E_RUNNER=1` | Accepted: `e2e:real` runs the API as production on purpose, and `WECOM_E2E_RUNNER` is the marker `config.ts` already treats as "this is the e2e stack". A deployment sets neither it nor `AI_TEST_SCRIPT` | An install that sets both gets a fake chat that answers plausibly; the boot log warns |
| `streamChat` cancels by closing the response reader rather than passing the `AbortSignal` to `fetch` | Accepted (X4a): under jsdom the app's signal is jsdom's and `fetch` is undici's, which rejects a foreign signal outright | A request cannot be aborted before headers arrive; after that the reader close ends it |
| Per-process chat rate limit (`Map<userId, number[]>`) | Accepted (X2): it guards the single CPU inference slot on this box. **Fix wave (A-M1):** the budget is now consumed *after* the 503 availability check, and the map evicts users whose window has expired | A second API instance gets its own budget |
| ~~The admin transcript `feedback` filter is applied in the browser~~ | **Resolved in the fix wave (B-I3): it was applied nowhere.** The control is removed, the invented msw `?feedback=` parameter is gone, and the tab gained the `isPending` branch the old covering test was really asserting | — |
| `probeToolSupport` caches a successful tool probe for the life of the process | Accepted (X2) | A tag that gains tool support after a pull needs a restart |
| `confidenceFor` clamps `new-card` at 0.75 | Accepted (X1): a whole new card is the proposal an editor should always look at | A genuinely certain new card still asks for a read |
| `adminHook.ts` (`registerAdmin`) is unused | X1 registered its admin routes under `modules/admin/routes.ts` instead; the hook is a no-op left in place. **Fix wave (A-M11):** `ai/index.ts` no longer re-exports `registerAdmin`, and the file says it has no caller; `runAdminRegistrar` stays because it is what lets the chat half boot with the admin half absent | Dead code, ~30 lines; removing the rest is a lane cleanup, not a fix |
| msw fixtures and `packages/shared/test/pipeline.test.ts` still carry `dictalm2.0-instruct:7b-q4_K_M` as a sample tag | Left: they are arbitrary strings in fixtures, and the operational copies are all corrected | A reader of the fixtures could believe the tag exists |

## Fix wave — API

Package A of the wave 6 review (`findings-A.md`). A-C1, A-I1…A-I8 and the minors A-M1, A-M2,
A-M3, A-M5, A-M6, A-M8, A-M9, A-M10, A-M11 are **fixed** on `fix/wave6-api`. The re-review of that
branch found two rows the new A-I6 predicate made unreachable by *anyone*; both are carve-outs on
`fix/wave6-api-2`, with the pair of states asserted in `int/scope-leak.test.ts` so neither quietly
becomes "visible to everybody, always":

- **a source that feeds no live document yet** is in nobody's world, so its null-target rows stay
  visible to every `suggestions.review` holder — `new-card` is the suggestion that gives a fresh
  import its first document, and scoping it through the empty set meant only an unscoped user
  could bootstrap a source. The scope applies again from the moment the source feeds one;
- **a soft-deleted target** no longer erases the suggestion for an unscoped caller. `deleted_at is
  null` sat outside the scope branch, so deleting a document dropped every suggestion against it
  from the queue *and* from the dashboard counts, admins included, leaving rows that could be
  neither rejected nor restored.

The report is
`.superpowers/sdd/program/fix-wave6-api-report.md` and the contract changes are in
`docs/api/CONTRACTS-wave6.md`. What is left, and what it costs if the ruling is wrong:

| Item | Ruling | Cost if wrong |
|---|---|---|
| **A-M4** — `embeddingMapping` (`sources/mapping.ts`) runs one `order by embedding <=> …` query per paragraph inside the pipeline job | Parked. It is a queued job, not a request path, and the per-paragraph query is what makes the fallback-to-trigram decision readable one paragraph at a time. A `lateral` join would fold N round trips into one but changes the scoring code the eval harness is calibrated against. The file is also the AI lane's in this fix wave | A large first import is slow — N round trips against a local Postgres, tens of ms each. No correctness cost; the job resumes from its watermark |
| **A-M7** — every revision writes the full non-`same` diff set (before *and* after text for every changed paragraph) into `source_revisions.meta->'diffs'`, uncapped and never pruned | Parked. `meta->'diffs'` is what `fewShotExamples` reads to build the few-shot block and what the acceptance analytics join against, so a cap has to decide *which* diffs survive, and that is a product decision about what a revision's record is — not a fix-wave one | A large WordPress source keeps roughly a second copy of the document per revision, forever. Storage, on a LAN VM with a Postgres nobody vacuums aggressively; no read path degrades, because every consumer filters by anchor first |
| **A-M5 (second half)** — migration 0051 reads `process.env` directly while the API reads a zod-parsed `Config` | Parked as documented-only, as before. The `down` half **is** fixed (the width is recorded and restored). A migration runner whose environment differs from the API's still produces a column the boot check then refuses — which is the *correct* failure, loudly, at boot | An operator who runs `pnpm migrate` with a different env than the service gets a boot refusal naming 0051, not a silent wrong-width column |
| **Dashboard pipeline panel** (found while adding the A-I6 scope-leak rows, not in `findings-A.md`) | **Fixed, not parked**: `pipeline.bySource` returned source *titles* to any caller, and a source's title is the document's. It now uses A-I6's `suggestionVisibleSql`, so the panel and the queue it links to agree on one row set. The `sync` panel stays org-wide — `sync_links` are connector plumbing | — |
| ~~`SuggestionAnalyticsTab` is gated on `analytics.read` while `GET /suggestions/analytics` requires `suggestions.review`~~ | **Resolved in the fix wave: taken, not parked.** The tab is gated on `suggestions.review`, the permission the route itself enforces, and a failed read now renders `LoadError` instead of "טוען…" forever | — |

## Fix wave — web

The review's package-B findings, all of `apps/web` plus the two contract-doc lines. Fixed: B-C1,
B-C2, B-I1…B-I6, and the minors B-M1, B-M2, B-M3, B-M4, B-M5, B-M7, B-M8, B-M9, B-M10, B-M11,
B-M13, B-M14, B-M15, B-M16, B-M17. What is left, and what it costs:

| Item | Ruling | Cost if wrong |
|---|---|---|
| **B-M6** — `ChatPane` fabricates `ProposedEdits.messageId` from the `done` frame, while the server sets it to the *tool* message id (`chat.ts:261`) | Parked. Nothing reads the field today: the host takes `id`, `documentId`, `baseSourceVersion` and `ops`, and the apply path sends `If-Match` from `baseSourceVersion`, not from the message. Correcting it means carrying the tool message id through the `proposed_edits` frame, which is an X2 contract change and not a web fix | A future reader who trusts `messageId` to address the message that proposed the hunks addresses the reply instead — a wrong link or a wrong feedback target, never a wrong write |
| **B-M12** — spec §5 asks the transcript browser for "search"; it has user and date filters only, and no paging control despite `AdminConversationsQuery.page` | Parked. The user box is now debounced and matches on name or id, which covers the "find this person's conversations" case the spec's word points at; free-text search over *message bodies* is a route the API does not have (`ConversationsQuerySchema` has no `q`), and paging needs the route to accept `page` as well | An admin investigating a complaint pages through 50 rows at a time by narrowing dates instead of searching. The export (JSONL, unpaged) is the escape hatch |
| **B-M16 (third part)** — `CONTRACTS-wave6.md:184` says the workspace link needs `ai.chat` **and** edit rights; `EditorPage.tsx:807` gates it on `ai.chat` alone | Parked as a doc correction: this lane's remit is the two contract lines the review named (`:176`, `:182`), and this is a third. The code is the safe side of the disagreement either way — `WorkspacePage` refuses a caller without `ai.chat`, and the source pane inside it is read-only without `docs.edit`. The other two parts of B-M16 (the `citations.tsx` regex comment, the empty `<p>` from `fragmentOf('')`) are fixed | The doc over-states the gate: a reader expects the link to be hidden from an `ai.chat` holder who cannot edit, and it is shown |
| `readOnly` on `ChatPane` has no caller | Kept and documented rather than deleted (B-M8): it is the seam for a read-only transcript host, and the tests that exercise it are the only thing keeping it honest | A dead prop, ~4 lines, and one test that proves a path nothing takes |

Gates re-run on the web half after the fix wave: `pnpm --filter @wecom/web build` clean;
`apps/web` vitest **899 passed / 134 files** (`--minWorkers=1 --maxWorkers=4`); `eslint apps/web
--max-warnings 0` and `prettier --check` clean. The two e2e specs were updated —
W6-E2E-2 now asserts `getByRole('link', { name: /שלב 1/ })` rather than the text — and are
**pending the merged-tree gate**; they need the API half of the fix wave in the same tree to run.
