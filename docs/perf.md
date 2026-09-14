# Performance: the two gates and the load profile

The non-functional requirement (PRD §11) is:

> library reads under 300 ms and search under 500 ms (p95) with 5,000 documents.

Three commands exist to hold that claim up. They answer different questions, and only the first
one is cheap enough to run routinely.

| command                              | question it answers                                             | cost           | Docker |
| ------------------------------------ | --------------------------------------------------------------- | -------------- | ------ |
| `pnpm --filter @wecom/api perf:check` | Does each endpoint meet its p95 budget with no other load?        | ~2–4 min       | yes    |
| `pnpm --filter @wecom/api perf:load`  | Does **search** meet 500 ms p95 under concurrent load?            | ~5–8 min       | yes    |
| `pnpm --filter @wecom/api perf:sql`   | What would a proposed change to the search SQL be worth?          | ~5 min         | yes    |

All three start a throwaway `pgvector/pgvector:pg16` testcontainer, migrate it, seed it and throw
it away — nothing touches a real database. Set `TEST_DATABASE_URL` to a superuser connection
string on an already-running Postgres to create a fresh database there instead, which is much
faster to iterate against.

None of them run in CI or in `pnpm test`: they are minutes long and need Docker. What *does* run
in `pnpm test` is `apps/api/test/perf/`, which unit-tests the percentile maths, the query mix and
the SQL rewrite with no database at all — because a load report whose arithmetic is wrong is worse
than no load report.

## `perf:check` — the quick gate

One request at a time against `buildApp` via `app.inject`, 40 iterations per endpoint over a
5,000-document fixture, failing if any endpoint's p95 exceeds its §11 budget. It covers the whole
read surface (documents, graph, field/block pages, backlinks, dashboards, search) and is the gate
to run before merging a change to any of them.

```
pnpm --filter @wecom/api perf:check [--docs 5000] [--iterations 40]
```

What it deliberately does not do is queue. Every request has the database, the pool and the CPU to
itself, so it measures the best case. That is the right shape for a regression gate and the wrong
shape for a claim about production.

## `perf:load` — the concurrent search profile

```
pnpm --filter @wecom/api perf:load [options]
```

20 concurrent clients drive `GET /search?q=…` for 60 seconds over a mix of 200 Hebrew queries,
against 5,000 seeded documents (~46,000 steps). Latency is reported as p50/p95/p99/max **per query
class**, because the five classes cost very different things and "search got slower" is not an
actionable sentence:

| class            | shape                                       | why it is in the mix                                        |
| ---------------- | ------------------------------------------- | ----------------------------------------------------------- |
| `single`         | one Hebrew word                             | the common case                                              |
| `two-word`       | verb + noun                                 | every word must match, so the predicate is an `and` of `or`s |
| `prefix`         | 2–4 leading characters of a word            | what the command palette sends on each keystroke             |
| `stopword`       | stopword + word + stopword                  | `kb_tsquery` strips the stopwords, so ranking contributes nothing and the `ilike` arms carry the query |
| `world-filtered` | one word plus `?world=`, as a scoped caller | adds the `document_worlds` intersection to every group       |

Requests go through the real route — auth, the zod querystring parse, `search()`, `labelHits()`,
the usage write, response serialization. The one thing it does not measure is the network hop.

### Options

| flag              | default | meaning                                                                    |
| ----------------- | ------- | -------------------------------------------------------------------------- |
| `--docs`          | 5000    | documents to seed (8 % of them type-T text items with a `body_html`)        |
| `--seconds`       | 60      | load duration                                                              |
| `--clients`       | 20      | concurrent clients                                                         |
| `--pool`          | 20      | `pg.Pool` max — keep it at or above `--clients`, or you measure the pool    |
| `--per-class`     | 40      | queries per class; 40 × 5 classes = the 200-query mix                       |
| `--seed`          | 42      | seeds both the corpus and the mix, so a run is reproducible                 |
| `--explain`       | off     | `EXPLAIN (ANALYZE, BUFFERS)` the three slowest statement shapes             |
| `--out <file>`    | —       | write the full report, plans included, as JSON                              |
| `--gate <ms>`     | 500     | fail if any class's p95 exceeds this                                        |
| `--no-gate`       | off     | report only, always exit 0                                                  |
| `--rewrite-steps` | off     | measure the *proposed* steps predicate instead of the one in `repo.ts`      |

`--explain` does not re-run the load. It replays a few queries per class through `search()` with a
recording wrapper, ranks the statements it issued, and explains the slowest distinct shapes — so
the plans in the report come from the SQL the code actually built, never from SQL copied into a
script by hand.

### Reading the output

```
query class       n       p50 ms    p95 ms    p99 ms    max ms
single            269     790.2     2648.3    3490.3    3761.5
...
ALL               1354    747.7     2577.5    3822.1    8193.6
```

`n` is requests completed, not requests attempted: at 20 clients a slower build completes fewer
requests in the same 60 seconds, so a *drop* in `n` alongside a rise in p95 is the same finding
stated twice. The throughput line above the table (`… req/s`) is the one number that captures both.

### Seeding

`perf-seed.ts` builds on `load-fixture.ts` (documents, phases, steps, actions, CRM field refs,
links) and adds what wave 4 put into the search path and the fixture predates: `document_worlds`
memberships, tags, topics, a spread of `doc_type`, and a slice of type-T/`kind='text'` documents
whose `body_html` is the only thing the `scripts` group ever matches. Without the world
memberships the world-scope `exists` clause matches nothing and the world-filtered class looks
fast for entirely the wrong reason.

## `perf:sql` — benchmarking a proposed query change

```
pnpm --filter @wecom/api perf:sql [--docs 5000] [--iterations 20] [--sample 12]
```

Captures the statement `search()` issues for the `steps` group, applies the candidate rewrite in
`scripts/perf-rewrite.ts`, **checks that both return exactly the same rows** for every sampled
query, then times both and prints both plans. It exists so a proposal to change search SQL can be
argued from measurements rather than from reasoning about plans.

The rewrite lives in its own module, is applied to the SQL text on its way to the driver, and is
unit-tested against the statements `repo.ts` really renders (`test/perf/perf-rewrite.test.ts`), so
it cannot silently stop applying and report a change as free.

## Where the numbers are

`.superpowers/sdd/program/perf-search-report.md` holds the measured before/after, the plans, and
the query change proposed to the owner of `apps/api/src/modules/search/repo.ts`.
