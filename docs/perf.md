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

`perf:check` **does** run in CI, as its own `perf` job in `.github/workflows/ci.yml` (needs
`build`, ~2–4 min, `TESTCONTAINERS_RYUK_DISABLED=1`) — so the §11 budgets are a merge gate on every
push, not something to remember to run. `perf:load` and `perf:sql` are not in CI: they are five to
eight minutes each and answer questions about a *proposed* change rather than about the branch.

None of the three runs in `pnpm test` — they need Docker and minutes. What *does* run there is
`apps/api/test/perf/`, which unit-tests the percentile maths, the query mix and the SQL rewrite
with no database at all, because a load report whose arithmetic is wrong is worse than no load
report.

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
shape for a claim about production — and the gap is not small. On the same 5,000-document fixture
and with migration 0044 applied, `perf:check` reports `GET /search (hebrew)` at **p95 324 ms,
inside its 500 ms threshold**, while `perf:load` measures the same endpoint at **p95 2,400 ms**
with 20 clients. Both numbers are correct. `perf:check` passing is not evidence for §11's search
claim; that is what `perf:load` is for.

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
| `--drop-stopwords`| off     | also drop `search_hebrew_stopwords` words from the `ilike` conjunction      |
| `--compare`       | off     | measure every configuration in one process, A B C C B A (see below)         |

The rewrite flags exist because `apps/api/src/modules/search/repo.ts` is owned by another lane.
They apply the proposed change to the SQL text on its way to the driver — same route, same
`search()`, same parameters and bindings — so a proposal can be measured end-to-end without
editing the file, and the diff that is actually proposed can be checked against what was measured.
`--drop-stopwords` implies `--rewrite-steps`.

### Do not compare two separate runs

Two invocations of this script minutes apart are **not** comparable. On the machine this was
developed on, six 60-second runs produced throughput between 10 and 110 req/s for configurations
whose difference was at most 5x — the machine's own state (Docker VM page cache, CPU frequency,
whether a run closely followed another) moves the numbers further than the code under test does.
A run started cold is slow; a run started right after another is fast.

`--compare` is the answer: it measures every configuration in one process against one already-warm
database, in the order `current → proposal 1 → proposal 1+2 → proposal 1+2 → proposal 1 → current`,
and reports each configuration as both passes combined. Any monotonic drift in machine speed over
the sequence hits the first and last pass of each configuration symmetrically, so it cancels.
Use it for any before/after claim; use a single run only for an absolute number, and repeat it.

The gate (`--gate`, default 500 ms) and `--out` always describe the **last** configuration
measured, which under `--compare` is `current` — the state of main, which is what a gate is about.
`--out` additionally records every configuration under `phases`.

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

## Findings, 2026-09-15 — search does not meet its §11 budget

The full write-up, with every plan in full, is
`.superpowers/sdd/program/perf-search-report.md` (untracked — `.superpowers` is gitignored). The
part that has to survive in the repository is here.

**Search p95 at 5,000 documents under 20 concurrent clients is 2.4–2.6 s, not under 500 ms**, in
three independent runs of main at `a1e548b` (22 / 16 / 17 req/s). All three slowest statement
shapes were the same one — the `steps` group — at ~235,000 shared buffer hits per query, because

```sql
coalesce((select string_agg(a.text, ' ') from step_actions a where a.step_id=s.id),'') ilike '%word%'
```

is a correlated aggregate evaluated once per candidate step. The plan is explicit: `Seq Scan on
steps` over all 46,002 rows, with `SubPlan 2 … loops=39924` and `SubPlan 3 … loops=18080` between
them accounting for 233,366 of the 237,075 buffers. The query spends 98 % of its work rebuilding a
string per step that it immediately discards.

**Indexes alone cannot fix it, and migration 0044 does not claim to.** Two of the five `or` arms in
that predicate are unindexable in principle rather than for want of an index — a correlated
aggregate has no value to index until the row is read, and `coalesce(b.title,'')` belongs to a
left-joined table — and an `or` is only index-driven when every arm is. Measured with all of
0044's indexes and no query change, the `steps` plan is structurally identical and overall p95 was
2,488 ms against a 2,577 ms baseline: unchanged. 0044 is still right to land, because it makes the
`documents` and `scripts` groups index-driven (they were full scans: only `title` had a trigram
index, from 0007) and because it is the precondition for the fix below.

### Two changes are proposed to `apps/api/src/modules/search/repo.ts`

That file is owned by another lane and was not edited here. Both proposals were measured by
applying them to the SQL text on its way to the driver (`perf:load --rewrite-steps
--drop-stopwords`), which leaves the route, `search()`, the parameters and the bindings untouched;
`scripts/perf-rewrite.ts` holds the transforms and `test/perf/perf-rewrite.test.ts` checks them
against the statements `repo.ts` really emits.

**Proposal 1 — the `steps` predicate as a union of indexable arms.** Replace the five-way `or`
built by `allWords` with one indexable set of step ids per word:

```ts
const stepWordSet = (w: string): string => {
  params.push(w);
  const p = `'%' || ${likeEscape('$' + params.length)} || '%'`;
  return `s.id in (
    select s1.id from steps s1
     where s1.title ilike ${p}${LIKE_ESCAPE}
        or coalesce(s1.description,'') ilike ${p}${LIKE_ESCAPE}
        or coalesce(s1.script,'') ilike ${p}${LIKE_ESCAPE}
    union select a1.step_id from step_actions a1 where a1.text ilike ${p}${LIKE_ESCAPE}
    union select s2.id from steps s2 join blocks b1 on b1.id = s2.block_id
     where b1.title ilike ${p}${LIKE_ESCAPE})`;
};
const cond = ws.map(stepWordSet).join(' and ');
```

Parameter order is unchanged, so `scopeTerm`, `taxTerm` and the `limit` placeholder keep their
numbers; no other group changes. `perf:sql` verified the rewrite returns row-for-row identical
results for every sampled query before timing it. The same two-word statement goes from **229,404
buffers / 201 ms to 18,736 buffers / 41 ms**, on a plan that is bitmap-index scans over 0044's
trigram indexes. End to end, overall p95 676 ms at 78 req/s in the best run, and 1,711 ms at
40 req/s versus 2,376 ms at 17 req/s for main in a controlled same-process comparison.

One disclosed behaviour change: the old form could match a substring spanning the `' '` that joined
two of a step's actions; the new form matches within one action.

**Proposal 2 — stop letting stopwords constrain the `ilike` match.** `pg_trgm` cannot index a
pattern shorter than three characters, and Hebrew function words are two (`של`, `את`, `על`, `אם`,
`לא`). One of them in a query forces a sequential scan of `steps` and `step_actions` that the rest
of the query would have avoided. Migration 0027 already stripped these from the *ranking* side
(`kb_tsquery`) on the grounds that a word appearing in nearly every document constrains nothing;
the `ilike` conjunction never got the same treatment, so `חוב של לקוח` still requires the literal
substring `של` — which matches inside `שלב` and `שלום` anyway, so it filters nothing:

```ts
const stop = new Set(
  (await q.query<{ word: string }>('select word from search_hebrew_stopwords')).rows.map((r) => r.word),
);
const typed = words(text);
const content = typed.filter((w) => !stop.has(w));
const ws = content.length ? content : typed; // an all-stopword query keeps today's behaviour
```

This returns *more* hits for a query containing a stopword — the same change 0027 made to the
vector side. Judged on the ratio between classes inside one run (immune to machine drift, with
`single` as the control since it has no stopword to drop), the stopword class goes from **3.20x the
control's p95 under proposal 1 alone to 1.15x with both**. The best run with both proposals gave
overall p95 **481 ms at 110 req/s**, with four of five classes inside the budget.

### What stays broken

`prefix` at two characters cannot be fixed in the database: no index type serves `ilike '%חב%'`.
The palette should not issue a server search below three characters — a client-side change, in
neither this lane nor the peer's.
