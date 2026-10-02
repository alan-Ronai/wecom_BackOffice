# The offline evaluation harness

Spec §1.9. A committed board of Hebrew cases, scored the same way every time, so "did the model
get better" is a number rather than an impression. `src/eval.ts` is the scoring; this directory is
the cases and the CLI.

## Running it

```bash
pnpm --filter @wecom/model eval --rules                 # the deterministic floor
pnpm --filter @wecom/model eval --model qwen2.5:3b-instruct-q4_K_M --embed nomic-embed-text --out /tmp/tier0.json
pnpm --filter @wecom/model eval --model aya-expanse:8b-q4_K_M      --embed bge-m3           --out /tmp/tier1.json
```

Without `--rules` it talks to a real Ollama **with no fallback**: a model that cannot answer has
to show up as a failure, not as the rule engine quietly scoring in its place.

Two levers turn *off* halves of the measured default, to reproduce a baseline or isolate one
variable — `--legacy-envelope --prompt propose-v3 --no-guards` is the wave-6-as-merged
configuration, which scores 0.000 across the board. `--temp`, `--num-ctx`, `--num-predict`,
`--url` and `--cases` do what they say.

> **Do not run a tier eval and the API integration suite at the same time.** They contend for the
> single Ollama inference slot, and the losing side reports timeouts that look like real failures.

The probe is the companion for reading what the model actually *said*, which no score tells you:

```bash
pnpm --filter @wecom/model exec tsx eval/probe.ts --model <tag> --out /tmp/probe --cases 01,06
```

## `@wecom/shared` has to be built first

This package resolves `@wecom/shared` through its **built `dist`**, not its source. A schema field
added in `packages/shared/src` is invisible here until `shared` is rebuilt, and the failure is
confusing: TypeScript reports the property missing on `EvalCase`, or a case fails to parse, both
of which read as a bug in *this* package.

`pnpm -r test` and `pnpm -r build` order this correctly. A bare `pnpm --filter @wecom/model test`
did not, so `test`, `typecheck` and `eval` now each carry a `pre*` script that builds `shared`
first. If you invoke `vitest`/`tsx` directly, build it yourself:

```bash
pnpm --filter @wecom/shared build
```

## The scores

| score | what it means |
| --- | --- |
| `hitTarget` | a suggestion pointed at the expected document/step, block, or section anchor |
| `hitType` | …and was also of the expected type. Only a matched target can score here |
| `contentOverlap` | the share of the expectation's `mustContain` facts and `mustContainAny` phrasing groups that appear in the matched suggestion's title, rationale or payload |
| `precision` | the share of the answer that matches an expectation, capped by the case's `maxItems`. The counterweight: without it a shotgun answer scores a perfect run |
| `languageFailures` | suggestions whose `title`/`rationale` carry CJK, Cyrillic, or a latin word outside the allow-list. The `--out` file names the words |

Recall is averaged over every case, so an unanswered one counts against the model. Precision and
the language rate are averaged only over the cases that produced an answer — they grade an
answer's quality, and a crash has no answer to grade.

## Writing a case

One JSON file per case, parsed through `EvalCaseSchema`, named `NN-short-slug.json`.

- **`expected: []` means the correct answer is silence.** Six cases are like this (a typo, a
  reorder, a whitespace edit, a `same` revision, punctuation, a heading rename). They score 1 when
  nothing is emitted and 0 when anything is. They are the only thing that catches a model that
  proposes on noise, which is what buries a review queue.
- **`mustContain` is for facts** — numbers, field names, latin tokens — and is a plain
  case-insensitive substring test. **`mustContainAny` is for phrasings**: one group per row,
  satisfied when any alternative appears, matched with Hebrew prefix clitics (ב/ל/ה/ו/מ/ש/כ)
  normalised off both sides.
- **`maxItems`** caps a correct answer's length. Set it: it is half of what precision measures.
- **`notes`** says what the case is *for* and is never scored. Write it.
- **`latencyBudgetMs`** is recorded and never asserted — a tier that scores well at 90 s/case is
  visibly not shippable, and that judgement belongs in `docs/wave6-acceptance.md`, not in a test
  that would go red on a loaded CI box.
- **`allowLatin`** adds to the language allow-list. Usually unnecessary: every latin word in the
  case's own diffs, steps, blocks and fields is allowed automatically, because an answer quoting
  its input is not code-switching.
