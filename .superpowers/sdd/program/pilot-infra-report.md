# Pilot-readiness infrastructure lane — report

- **Subject:** worktree off `main` at `983148e`, 11 commits (`2aff82b` … `83c7999`), not rebased.
- **Scope:** acceptance review §2 (O-1, O-2, O-3, O-6), §5 (headers, allowlist, `TRUST_PROXY`,
  advisories), §6.2 (F-2, E-3, route coverage), §7 items 3, 5 (F-2 only), 6, 7, 18, 19, 20, 22.
- **Environment:** macOS (darwin 25.0.0), Node 24, pnpm 10.27.0, Docker Desktop.
- **Boundaries honoured:** nothing under `apps/api/src/modules/**` or `apps/web/src/components/**`
  was touched.

## Summary

| # | Item | Status |
|---|---|---|
| 1 | O-1 — security headers on every response, asserted live | **done** |
| 2 | O-2 — health/smoke prove the model **tag** is pulled | **done** |
| 3 | O-3/O-6 — restore drill runs as printed; `create-admin` never echoes the password | **done** |
| 4 | F-2 — two consecutive `pg_isready` probes; failing spec names on failure | **done** (+ a blocked-port guard the assigned ports forced out, §4a) |
| 5 | §5/#18 — `CONNECTOR_HOST_ALLOWLIST` + `TRUST_PROXY` required in production | **done** |
| 6 | E-3 — validation failures answer with the Hebrew error envelope | **done** |
| 7 | #19 — route-coverage assertion; 6 of 9 gaps closed, 3 allowlisted with reasons | **done** |
| 8 | #20 — react-router upgraded past the open redirect; the rest written down | **done** |
| 9 | `deploy-smoke.yml` — the compose smoke runs to completion with a real (tiny) model | **done** |

Nothing deferred. Three OpenAPI operations were deliberately allowlisted rather than tested (§7
below), each with a written reason and a stated condition for removing it.

Two things the coordinator should read before merging: the assigned `E2E_WEB_PORT=4190` cannot
work at all (§4a), and `e2e:real` is red on exactly one spec — W4-E2E-3, which is **F-4**, another
lane's item, with evidence below that it is the test's budget and not the product.

### Commits

```
83c7999 test(e2e-real): refuse a port the fetch standard blocks, instead of timing out on it
8d83ed4 ci: the compose smoke runs to completion with a real (tiny) model
25bdef4 style: prettier the files this lane touched
64c093f deps(#20): upgrade react-router past the open redirect, and write the rest down
01de9c3 test(#19): fail when an OpenAPI operation has no integration test, and close 6 of the 9 gaps
f3c9617 api(E-3): validation failures answer with the Hebrew error envelope
8684bee api(§5/#18): CONNECTOR_HOST_ALLOWLIST and TRUST_PROXY are required in production
cfb8f0e test(e2e-real): two consecutive pg_isready probes, and name the failing specs (F-2)
35cb287 deploy+api(O-3/O-6): a restore drill that runs as printed, and a password that is never echoed
181edcf api+deploy(O-2): health proves the configured model tag is pulled, not just that Ollama answers
2aff82b deploy(O-1): put the security headers on every response, and prove it live
```

---

## 1 — O-1: security headers on every response

`deploy/nginx.conf` set the four headers in `server`, but `location /` and `location /assets/`
each declare a `Cache-Control` of their own, and nginx discards **every** inherited `add_header`
in a location that declares one. The two responses the browser actually renders — the app document
and the JS bundle — therefore shipped with no CSP, no HSTS, no nosniff and no X-Frame-Options.

- `deploy/nginx-security-headers.conf` is now the single source, `include`d by `server` and by all
  four location blocks (`/`, `/assets/`, `/api/`, `= /api/v1/events`). The two proxy blocks declare
  no `add_header` today and would inherit — including the snippet there too means adding one cache
  or CORS header to a proxy block can never silently strip the set again.
- Added `Referrer-Policy: strict-origin-when-cross-origin` and `includeSubDomains` on HSTS, and
  aligned `client_max_body_size` with `@fastify/multipart`'s 25 MB (was 50 MB) — item 22.
- `deploy/nginx-check.sh` keeps `nginx -t` and now starts a throwaway nginx on a user-defined
  network (so Docker's embedded resolver exists for the `api` upstream) and asserts all five
  headers with `curl -kI` on `/`, `/assets/x.js` and `/api/v1/system/health`. Nothing answers as
  `api`, so the last one is a 502 — the stronger assertion, since the headers are `always`.
- `deploy/Dockerfile.web` copies the snippet to `/etc/nginx/security-headers.conf`.

```
$ ./deploy/nginx-check.sh
nginx: configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
nginx.conf ok
security headers ok: /
security headers ok: /assets/x.js
security headers ok: /api/v1/system/health
nginx security headers ok (/, /assets/*, /api/*)
```

Negative-tested by deleting the `include` from `location /` — the check fails, so it is a real
assertion and not a tautology:

```
nginx-check FAILED: / is missing header 'strict-transport-security'
nginx-check FAILED: / is missing header 'x-content-type-options'
nginx-check FAILED: / is missing header 'x-frame-options'
nginx-check FAILED: / is missing header 'referrer-policy'
nginx-check FAILED: / is missing header 'content-security-policy'
```

And on the real Compose stack (item 9's run, `https://localhost:8443`):

```
$ curl -ksI https://localhost:8443/
HTTP/2 200
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: SAMEORIGIN
referrer-policy: strict-origin-when-cross-origin
content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; …
cache-control: no-cache
```

**Files:** `deploy/nginx.conf`, `deploy/nginx-security-headers.conf` (new), `deploy/nginx-check.sh`,
`deploy/Dockerfile.web`.

## 2 — O-2: the model **tag**, not just a reachable Ollama

`app.model.available()` is a `GET /api/tags` that only checks the status code, so `/system/health`
answered `model: true` against an Ollama with nothing pulled and `smoke.sh` printed `smoke passed`
on a broken install.

- `HealthResponseSchema` gains `modelStatus: { reachable, tagPresent, name }` **additively**; the
  `model` boolean stays for existing clients and now means "reachable **and** the tag is pulled".
  `MODEL_DISABLED=true` reports `{ true, true, 'rules' }`, as it effectively did before.
- `probeModel` now matches the tag exactly, normalising an untagged name to `:latest` the way
  ollama stores it. The old comparison fell back to the part before the `:`, so a pulled
  `qwen2.5:7b` satisfied a configured `qwen2.5:3b` — precisely the fat-fingered-`MODEL_NAME` case.
- `deploy/smoke.sh` waits on `tagPresent`, names the tag it is waiting for and points at
  `MODEL_NAME` / `ollama-pull.sh`; it also now asserts the five O-1 headers on `GET /`.
- `INSTALL.md` step 6 and the `model:false` troubleshooting row explain both signals.

Caught live on the Compose stack while the pull was still running — the exact state that used to
read as healthy:

```
{"ok":false,"db":true,"model":false,
 "modelStatus":{"reachable":true,"tagPresent":false,"name":"qwen2.5:0.5b-instruct-q4_K_M"},…}
```

and the same stack once the pull finished:

```
model ok: 'qwen2.5:0.5b-instruct-q4_K_M' is pulled
health ok: {"ok":true,"db":true,"model":true,"modelStatus":{"reachable":true,"tagPresent":true,
            "name":"qwen2.5:0.5b-instruct-q4_K_M"},"queue":0,…}
```

**Files:** `packages/shared/src/schemas/api.ts`, `apps/api/src/services/probes.ts`,
`apps/api/src/routes/health.ts`, `deploy/smoke.sh`, `deploy/INSTALL.md`, `docs/api/openapi.json`
(regenerated), `apps/web/test/msw/fixtures.ts`, `apps/api/test/health.test.ts`,
`apps/api/test/probes.test.ts`.

> **Ownership note.** `apps/api/src/routes/health.ts` and `apps/api/src/services/probes.ts` sit
> outside `apps/api/src/modules/**`, so they were in bounds; the health route is not a module
> route. No file under `modules/` or `apps/web/src/components/` was touched.

## 3 — O-3 / O-6: a drill that runs as printed, a password that is never echoed

**O-3.** Both documents printed
`exec -e DATABASE_URL=postgres://kb:$POSTGRES_PASSWORD@db:5432/kb backup restore-drill.sh`.
`$POSTGRES_PASSWORD` is expanded by the **host** shell, where it is unset unless the operator
sourced `deploy/.env` — run literally it became `postgres://kb:@db:5432/kb` and died at
authentication. The `backup` container already has a correct `DATABASE_URL` from compose, so both
documents now pass no override at all, and `restore-drill.sh` refuses an empty-password URL with
that explanation rather than the raw Postgres error.

**O-6.** `create-admin` no longer takes `--password`: `pnpm` echoes the resolved command line (you
can watch it do so in the run below), so the new admin password landed in the terminal transcript
and in shell history. It reads from `--password-stdin`, or prompts twice on a TTY with echo off.
The old flag is still parsed so it can explain itself instead of `parseArgs` throwing
"Unknown option". `INSTALL.md` step 7, `docs/identity.md` and `scripts/e2e-real.mjs` use the new
spelling.

### `deploy/backup-check.sh` — full round trip against a throwaway container

```
$ ./deploy/backup-check.sh
#9 naming to docker.io/library/wecom-kb-backup:test done
backup written: /backups/kb-20260914-2138.dump (4.0K)
restoring /backups/kb-20260914-2138.dump into postgres://kb:kb@db:5432/kb
NOTICE:  schema "pgboss" does not exist, skipping
restore complete: 1 tables
backup written: /backups/kb-20260914-2138.dump (4.0K)
pruned: /backups/kb-20000101-0000.dump
backup/restore ok
```

### `deploy/restore-drill.sh` — both paths, against a throwaway `pgvector/pgvector:pg16`

```
--- 1. good path (the URL compose actually sets) ---
restore drill: using /backups/kb-20260914-2138.dump
restore drill: creating scratch database kb_restore_drill_20260914213831_1
restore drill: restoring dump into kb_restore_drill_20260914213831_1
restore drill OK: /backups/kb-20260914-2138.dump restored, 1 tables, 5 documents
exit=0

--- 2. O-3: $POSTGRES_PASSWORD never expanded on the host ---
restore-drill FAILED: DATABASE_URL has an empty password — $POSTGRES_PASSWORD was not
set in the shell that expanded it. The backup container already has a correct DATABASE_URL, so
run this without any -e override:
  docker compose -f deploy/docker-compose.yml exec backup restore-drill.sh
or, if you really need to pass one, export it first: set -a; . deploy/.env; set +a
exit=1
```

### `create-admin` — the flag is gone, and the echo that caused O-6 is visible in the output

```
$ pnpm --filter @wecom/api create-admin --email admin@wecom.local < /dev/null
> tsx src/cli/create-admin.ts --email admin@wecom.local      ← pnpm echoing the command line: O-6
usage: create-admin --email <email> [--name <display name>] (--password-stdin | interactive prompt)

The password is never taken from the command line: pnpm echoes the resolved command, so
`--password 'S3cret…'` ended up in the terminal transcript and in shell history (acceptance
review O-6). Either pipe it in —

  printf '%s' 'the password' | … create-admin --email admin@wecom.local --password-stdin

— or run the command on a terminal and answer the prompt (the typed characters are not echoed).
exit=2
```

**Files:** `deploy/restore-drill.sh`, `apps/api/src/cli/create-admin.ts`, `deploy/INSTALL.md`,
`docs/operations.md`, `docs/identity.md`, `scripts/e2e-real.mjs`,
`apps/api/test/create-admin-cli.test.ts` (new — 4 tests, one of which asserts the secret never
appears in stdout or stderr).

## 4 — F-2: readiness, and naming the failing specs

- The pgvector image starts Postgres once for its init scripts and restarts it, so the first green
  `pg_isready` is against a server about to disappear — which is how `seed` died with "Connection
  terminated unexpectedly". The gate now requires **two greens at least 500 ms apart**, polling
  every 250 ms, and any failed probe resets the streak, so a pair cannot straddle the restart.
- Playwright runs with `--reporter=list,json`. On a non-zero exit the runner reads the JSON report
  (not the scrollback, so a spec whose own output contains "failed" cannot confuse it) and prints
  `FAILED SPEC: <file>:<line> › [project] › <title path>` per red spec, repeating them in the
  thrown error. A non-zero exit with **no** failing spec in the report says exactly that, so a
  crash before the first test is never reported as "nothing failed".

The report walker was exercised against a synthetic Playwright JSON report (nested suites, a
project name, a passing sibling, and a missing file):

```
real/wordpress-source.spec.ts:152 › [real] wordpress source round trip › the WordPress edit became a source version
real/login.spec.ts:19 › [sso] signs in through the issuer
empty-report: []
```

**Files:** `scripts/e2e-real.mjs`.

## 4a — the assigned `E2E_WEB_PORT=4190` cannot work, and now says so

Running the gate exactly as briefed spent 120 s and then reported the one thing that was *not*
wrong:

```
✗ e2e:real failed: timed out waiting for web serving at http://127.0.0.1:4190
```

`vite preview` had started perfectly — its banner read `http://127.0.0.1:4190/`, and a `curl`
against it returned 200 in about a second. **4190 (sieve) is on the WHATWG fetch standard's
bad-port list**, so `waitFor`'s `fetch()` rejects the URL before opening a socket:

```
fetch NEVER ok after 20080ms; lastErr=fetch failed cause=bad port
```

Playwright's browser would have refused it at the first navigation for the same reason, so no
choice of timeout would have helped. The gate now checks the api, web and (under `E2E_OIDC=1`)
issuer ports against that list before starting anything and names the variable to change; Postgres
is exempt, since `pg` opens a plain socket and nothing ever fetches it.

```
$ E2E_PG_PORT=55450 E2E_API_PORT=3150 E2E_WEB_PORT=4190 pnpm e2e:real
✗ e2e:real failed: port blocked by the WHATWG fetch standard — neither node's fetch nor a browser
  will connect to it, whatever is listening:
  :4190 (web, E2E_WEB_PORT) — pick another
  see https://fetch.spec.whatwg.org/#bad-port
```

One second instead of two minutes, and it names the cause. **`E2E_API_PORT=3150` and
`E2E_PG_PORT=55450` are fine**; only the web port needs changing. The gate below was therefore run
on `E2E_WEB_PORT=4191`.

**Files:** `scripts/e2e-real.mjs` (commit `83c7999`).

## 5 — §5 / item 18: two settings production must state

Both had permissive fallbacks a deployment could reach by omission:

- an empty `CONNECTOR_HOST_ALLOWLIST` means "any public host", so any connector `baseUrl` a
  `connectors.manage` holder supplies is an outbound request to anywhere the VM can see;
- an unset `TRUST_PROXY` defaulted to `trustProxy: true` in production — trust any
  `X-Forwarded-For`, including one forged by a client that bypasses nginx — while `req.ip` gates
  the Palo Alto allowlist, the auth rate-limit buckets and the audit trail.

`ConfigSchema` refuses both in production the way it refuses the dev `SESSION_SECRET`. `*` is the
written-down way to say "any public host", handled once in `@wecom/connectors`'
`assertAllowedHost` so both splitting call sites (which live in `modules/`) inherit it;
link-local/metadata stays refused whatever the list says. `deploy/.env.example`, `deploy/ci.env`,
`INSTALL.md` step 3 / reverse-proxy / WordPress-connector sections and `docs/operations.md` say so
— `INSTALL.md`'s old advice to "widen it rather than leave it empty" is now a requirement rather
than a suggestion.

**Files:** `apps/api/src/config.ts`, `packages/connectors/src/guards.ts`, `deploy/.env.example`,
`deploy/ci.env`, `deploy/INSTALL.md`, `docs/operations.md`, `apps/api/test/unit/config.test.ts`,
`apps/api/test/int/trust-proxy.test.ts`, `packages/connectors/test/guards.test.ts`.

## 6 — E-3: the Hebrew envelope for validation failures

A schema failure fell through as the framework raised it (`FST_ERR_VALIDATION`,
`"body/note Required"`) while every other envelope is `{ code, message (Hebrew), details,
requestId }`. `apps/api/src/app.ts`'s error handler (and only the error handler) now maps any 400
carrying `validation` — or an `FST_ERR_VALIDATION` code — to `code: 'VALIDATION'` with a Hebrew
message, keeping the validation issues in `details` untouched for integrators.
Application-raised errors keep their own code, message and details.

`apps/api/test/validation-envelope.test.ts` (new) drives **real public routes**, so it needs no
session and no database — validation runs before any handler reaches `app.db`: `/auth/local` for a
missing required field and for a wrong type, `/connectors/:id/webhook` for a params failure, and
`/auth/login` to prove an application-raised error is untouched. 4 tests, green. It also asserts
the English framework string (`Required`, `body/`, `FST_ERR_VALIDATION`) appears nowhere in the
response.

**Files:** `apps/api/src/app.ts` (error handler only), `apps/api/test/validation-envelope.test.ts`
(new).

## 7 — #19: a route-coverage assertion, and the gaps it found

`apps/api/test/route-coverage.test.ts` (new) reads `docs/api/openapi.json` and every `.ts` under
`apps/api/test`, extracting the `(method, path)` pairs the suite issues in all three spellings in
use: `inject({ method, url })` (either key order, across lines), the per-file `get(url)` /
`post(url, payload)` helpers, and the positional `inject('POST', url)`. It folds
`'/api/v1/x/' + enc(name) + '/usage'` into one literal so a spliced path parameter is not read as
a false gap. It guards itself four ways: no gaps outside the allowlist, no stale or now-covered
allowlist entry, every entry needs a reason of real length, and the scanner must still find more
than 100 requests (so it cannot silently stop working and pass everything).

**The 9 operations it found that nothing called.** Six are now covered by
`apps/api/test/int/route-coverage-gaps.test.ts` (new):

| Operation | Outcome |
|---|---|
| `GET /api/v1/admin/roles` | test added — lists the seeded roles |
| `GET /api/v1/documents/{id}/comments` | test added — empty thread, then one after a POST |
| `POST /api/v1/trash/restore-all` | test added — delete, see it in trash, restore-all, trash empty |
| `DELETE /api/v1/fields/{name}` | test added — upsert, delete, gone from the list, second delete 404 |
| `GET /api/v1/assets/{id}` | test added — real multipart PNG upload, bytes and content-type compared |
| `GET /api/v1/documents/{id}/source/versions/{v}` | test added — two saves, then version 1 served |

**Allowlisted, with reasons** (`apps/api/test/route-coverage-allowlist.json`):

| Operation | Reason recorded |
|---|---|
| `POST /api/v1/suggestions/{id}/reset` | Reaching it needs a pipeline-produced suggestion in the `accepted` state, which only the stubbed source harness (`test/sources/routes.test.ts`) builds; the accept/reject/apply path it reverses is covered there and in `int/wiring.test.ts`. Cover it when that harness gains a reusable fixture. |
| `PUT /api/v1/suggestions/{id}/edit` | Same fixture cost: it edits a pending suggestion's payload before acceptance, and only the stubbed source harness produces one. The accept path that consumes the edited payload is covered in `int/wiring.test.ts`. |
| `POST /api/v1/sync-links/{id}/resolve` | Deprecated adapter kept for one web caller; §6.1 marks it for removal rather than for new tests. It needs a real connector, a sync link and a conflict, all of which `connectors-sync.int.test.ts` already builds for the replacement route. Delete the route and this entry together. |

```
$ RUN_INTEGRATION=1 vitest run test/int/route-coverage-gaps.test.ts
 ✓ test/int/route-coverage-gaps.test.ts (6 tests) 3825ms
```

One convention this imposes on future tests: **the URL must appear as a literal at the call site**.
A `const url = …` passed by shorthand reads as uncovered; the new test carries a comment saying so
where it would otherwise bite.

**Files:** `apps/api/test/route-coverage.test.ts`, `apps/api/test/route-coverage-allowlist.json`,
`apps/api/test/int/route-coverage-gaps.test.ts` (all new).

## 8 — #20: dependency advisories

`pnpm audit --prod` before: **1 high, 3 moderate**. After: **1 moderate**, accepted in writing.

- **react-router 6 → 7.18.3** (`react-router-dom ^7.18.3`) closes GHSA-wrjc-x8rr-h8h6, the open
  redirect via a backslash in `<Link>`/`useNavigate` — the only reachable finding, since the app
  routes user-supplied values into navigation (`returnTo` on login, `?world=`/`?topic=` on the
  library). It also closes the SSR-hydration `deserializeErrors()` advisory, never reachable here.
  The major bump needed **no source change**: the app uses only the hook/component API v7 keeps
  (`BrowserRouter`, `useRoutes`, `Navigate`, `Link`, `NavLink`, `Outlet`, `useNavigate`,
  `useLocation`, `useParams`, `useSearchParams`, `RouteObject`) and none of the removed
  data-router helpers. Verified: `@wecom/web` typecheck, 565 unit tests, 38 msw e2e specs and the
  production build all green.
- **glob** pinned past GHSA-5j98-mcp5-4vw2 with a root `pnpm.overrides` entry narrowed to the
  vulnerable range (`glob@>=11.0.0 <11.1.0` → `^11.1.0`), so it lapses on its own when
  `node-pg-migrate` widens its dependency. Nothing invokes the `glob` CLI; `migrate.test.ts` and
  `migrations.test.ts` verified green against a real Postgres afterwards.
- **fast-xml-parser** accepted: the vulnerable class is `XMLBuilder` and nothing in the repo builds
  XML — all three call sites import `XMLParser` only, and `grep -rn XMLBuilder apps packages` is
  empty. The fix is a v4 → v5 major that would need the docx and Palo Alto parsers re-verified,
  and both live in `apps/api/src/modules/**`, which this lane does not touch.

`docs/security-advisories.md` (new) records each decision, the review date (2026-09-15), and what
would make it lapse; `README.md` points at it.

## 9 — `deploy-smoke.yml`: a compose smoke that actually proves something

The CI compose stack stubbed out `ollama-pull`, so the job had to run `SMOKE_REQUIRE_MODEL=false` —
the one automated end-to-end check of the deployment proved strictly less than `smoke.sh` does on
the VM, and could never assert what O-2 added.

- `deploy/docker-compose.ci.yml` no longer replaces the `ollama-pull` entrypoint; `deploy/ci.env`
  overrides `MODEL_NAME` to `qwen2.5:0.5b-instruct-q4_K_M` — the smallest tag in the production
  model's own family, ~0.4 GB against ~2 GB. Nothing in the smoke test performs inference, so size
  is all that matters. CI also drops `OLLAMA_KEEP_ALIVE` to 1 m.
- The workflow splits `up + smoke` into `up` → `wait for the model pull` → `smoke`. The pull is a
  one-shot service, so waiting on its exit code means a pull failure reads as "the model pull
  failed, and here is its log" (last 20 lines — `ollama pull` redraws its progress bar thousands of
  times even without a TTY) instead of surfacing minutes later as an unexplained smoke timeout.
- `SMOKE_REQUIRE_MODEL=false` is gone: CI now asserts what an operator's run on the VM asserts.
  **No step in the job is `continue-on-error`.**
- **Expected runtime ~12–16 min** on a standard runner — ~1 min for the config/lint checks, ~2 min
  for `deploy/backup-check.sh`, ~6–9 min to build the three images (the api image runs a full
  `pnpm install` and `tsc`), ~1 min to pull the CI model, and under a minute for the stack to come
  up and answer the smoke test. `timeout-minutes: 30` is a deliberately generous stuck-job cap.

Verified locally by running the job's compose half exactly as the workflow does (build → up →
wait → smoke), against `deploy/ci.env` + `deploy/docker-compose.ci.yml`:

```
ollama-pull-1  | pulling c5396e06af29: 100% ▕███████████▏ 397 MB/397 MB  5.1 MB/s      0s
ollama-pull-1  | verifying sha256 digest
ollama-pull-1  | writing manifest
ollama-pull-1  | success
ollama-pull-1  | model ready
ollama-pull exit=0
=== smoke
model ok: 'qwen2.5:0.5b-instruct-q4_K_M' is pulled
health ok: {"ok":true,"db":true,"model":true,"modelStatus":{"reachable":true,"tagPresent":true,
            "name":"qwen2.5:0.5b-instruct-q4_K_M"},"queue":0,"version":"0.1.0","uptimeSec":191,
            "lastBackupAt":null,"lastBackupOk":false}
request id ok: 35afafdd-6bfd-4ace-b4d5-55819b0071c1
security headers ok
smoke passed
```

The model pull took ~2.5 min here at 5 MB/s; a GitHub runner is normally faster.

**Files:** `.github/workflows/deploy-smoke.yml`, `deploy/docker-compose.ci.yml`, `deploy/ci.env`.

---

## Gates

| Gate | Result |
|---|---|
| `pnpm lint` | **green** — eslint clean, `All matched files use Prettier code style!` |
| `pnpm typecheck` | **green** — shared, model, connectors, web, api all `Done` |
| `pnpm -r build` | **green** — all five workspaces `Done` |
| `pnpm test` | **green** — shared 63, model 12, connectors 37, web 565, api 132 (+307 integration-gated) |
| `RUN_INTEGRATION=1 pnpm --filter @wecom/api test:int` | **green** — 83 files / 439 tests |
| `E2E_PG_PORT=55450 E2E_API_PORT=3150 E2E_WEB_PORT=4191 pnpm e2e:real` | **11 passed / 1 failed** — the failure is W4-E2E-3 (F-4), another lane's item; see below. `4190` is unusable, see §4a. |

```
$ pnpm test
packages/shared test:  Test Files  13 passed (13)   Tests  63 passed (63)
packages/model test:   Test Files   3 passed (3)    Tests  12 passed (12)
packages/connectors:   Test Files   7 passed (7)    Tests  37 passed (37)
apps/web test:         Test Files  71 passed (71)   Tests 565 passed (565)
apps/api test:         Test Files  31 passed | 52 skipped (83)   Tests 132 passed | 307 skipped (439)

$ RUN_INTEGRATION=1 pnpm --filter @wecom/api test:int
Test Files  83 passed (83)
     Tests  439 passed (439)
```

> One flake seen and chased down, not a defect in this work: on an earlier `test:int` run under
> heavy load (a Docker image build in parallel) all 439 tests passed but vitest reported one
> unhandled error — `terminating connection due to administrator command` (Postgres `57P01`) from
> `test/seed.test.ts`, i.e. the testcontainer stopping while a pooled client was still open. It
> passes in isolation and did not recur on the clean re-run recorded above. `seed.test.ts` is
> untouched by this lane. The same load also produced one transient
> `apps/web/test/feedback/FeedbackPage.test.tsx` failure, likewise green on re-run and on the
> clean full run.

### `pnpm e2e:real`

Run as `E2E_PG_PORT=55450 E2E_API_PORT=3150 E2E_WEB_PORT=4191 pnpm e2e:real` — the api and pg
ports are as assigned; the web port had to move off 4190, which no HTTP client in the stack can
reach (§4a). Run twice, with the same result both times.

```
── 1. postgres (pgvector/pgvector:pg16) ──────────────────────
✓ postgres accepting connections on :55450 (two consecutive probes ≥500ms apart)      ← F-2

── 2. migrate, seed, create-admin ───────────────────────────
> tsx src/cli/create-admin.ts --email e2e-admin@wecom.co.il --password-stdin --name 'E2E Admin'
created admin 027bacbd-2a49-4d26-9a4c-e03c65923705                                    ← O-6

── 5. playwright (no mocks) ─────────────────────────────────
Running 12 tests using 1 worker
  ✓   1 [setup] › auth.setup.ts:11:1 › signs in with the break-glass local account
  ✓   2 [real] › edit-publish-restore.spec.ts:14:1 › edit → publish → history diff → restore
  ✓   3 [real] › edit-publish-restore.spec.ts:64:1 › delete → trash → restore
  ✓   4 [real] › feedback-loop.spec.ts:24:1 › W4-E2E-1 feedback → closed status linked to a version
  ✓   5 [real] › library-and-call.spec.ts:11:1 › the library renders the seeded cards, by wave
  ✓   6 [real] › library-and-call.spec.ts:27:1 › opens a seeded document in call mode
  ✓   7 [real] › library-and-call.spec.ts:44:1 › Ctrl-K search returns grouped results
  ✓   8 [real] › library-and-call.spec.ts:65:1 › the sources page loads against the real pipeline
  ✓   9 [real] › library-and-call.spec.ts:76:1 › the admin users page lists the break-glass admin
  ✓  10 [real] › library-and-call.spec.ts:82:1 › the system page renders operator diagnostics
  ✓  11 [real] › taxonomy-visibility.spec.ts:32:1 › W4-E2E-2 world/topic, editor files, reader sees
  ✘  12 [real] › wordpress-source.spec.ts:24:1 › W4-E2E-3 WordPress → source version → … (24.4s)

  1 failed
  11 passed (1.3m)

── failing specs (1) ──────────────                                                   ← F-2
FAILED SPEC: wordpress-source.spec.ts:24 › [real] W4-E2E-3 WordPress → source version → review flag → publish → push renders the source HTML

✗ e2e:real failed: playwright: 1 spec(s) failed:
  wordpress-source.spec.ts:24 › [real] W4-E2E-3 WordPress → source version → review flag → publish → push renders the source HTML
```

Two of the lane's own changes show up in that output: the two-probe Postgres wait, and the
grep-friendly `FAILED SPEC:` block — which is the first time this gate has named what failed
instead of burying it in scrollback.

**The one failure is F-4, not a regression, and not this lane's item.** §7 item 5 assigns F-1, F-3
and F-4 elsewhere and gives this lane F-2 only; `apps/web/e2e/**` is outside the files I own. It is
also the exact failure §6.2 documents ("fails 3/3, and the failure is the test's timeout, not the
import"): the spec polls `GET /documents/:id/source` for 10 rounds × 1.5 s and asserts on what it
has at the end.

```
Error: the WordPress edit became a source version
  Expected substring: "6 מגה"
  Received string:    ""
  > 152 |   expect(sourceHtml, 'the WordPress edit became a source version').toContain('6 מגה');
```

I re-ran with `KEEP_STACK=1` and queried the surviving stack directly. The import **had**
completed — it simply landed after the spec's budget:

```
$ docker exec wecom-e2e-pg-55450 psql -U postgres -d postgres -tAc \
    "select sd.document_id, sd.current_version, left(v.html,80) from source_documents sd
       join source_document_versions v on v.source_document_id=sd.id and v.version=sd.current_version"
29da4380-5e23-4fab-89da-fee7db347537|10|<h2>מבוא</h2><p>סף מהירות: 6 מגה.</p><ul><li>בדיקת APN</li>…

$ … "select id, source_review_needed, source_review_reason from documents where id='29da4380-…'"
29da4380-5e23-4fab-89da-fee7db347537|t|גרסת מקור חדשה · נוהל WordPress לבדיקה · E2E Admin · d0b6e74a
```

The assertion is satisfied and the review flag is set — byte-for-byte the evidence §6.2 records.
The fix is F-4's `expect.poll` with a real timeout, in the lane that owns `apps/web/e2e/**`. The
stack was torn down afterwards and all four ports released.

## Files touched

**New**

- `deploy/nginx-security-headers.conf`
- `docs/security-advisories.md`
- `apps/api/test/create-admin-cli.test.ts`
- `apps/api/test/validation-envelope.test.ts`
- `apps/api/test/route-coverage.test.ts`
- `apps/api/test/route-coverage-allowlist.json`
- `apps/api/test/int/route-coverage-gaps.test.ts`

**Modified**

- `deploy/`: `nginx.conf`, `nginx-check.sh`, `Dockerfile.web`, `smoke.sh`, `restore-drill.sh`,
  `docker-compose.ci.yml`, `ci.env`, `.env.example`, `INSTALL.md`
- `.github/workflows/deploy-smoke.yml`
- `scripts/e2e-real.mjs`
- `apps/api/src/`: `app.ts` (error handler only), `config.ts`, `routes/health.ts`,
  `services/probes.ts`, `cli/create-admin.ts`
- `apps/api/test/`: `health.test.ts`, `probes.test.ts`, `unit/config.test.ts`,
  `int/trust-proxy.test.ts`
- `packages/shared/src/schemas/api.ts`, `packages/connectors/src/guards.ts`,
  `packages/connectors/test/guards.test.ts`
- `apps/web/package.json` (react-router-dom 7), `apps/web/test/msw/fixtures.ts`
- `package.json` (pnpm override), `pnpm-lock.yaml`
- `docs/api/openapi.json` (regenerated), `docs/operations.md`, `docs/identity.md`, `README.md`

## Notes for the coordinator

- Not rebased onto `main`; branched from `983148e`.
- **Use a different `E2E_WEB_PORT`.** 4190 is on the fetch standard's blocked list, so the gate
  cannot pass on it no matter what the code does (§4a). The runner now refuses it in a second with
  an explanation; 4191 works. Worth checking the ports handed to the other workers against
  https://fetch.spec.whatwg.org/#bad-port — 6000, 6666, 6667 and 10080 are the other plausible
  picks on that list.
- **`e2e:real` is red on one spec, W4-E2E-3, and it is F-4's** — the test's fixed 15 s budget, not
  the product. Evidence that the import completes is in the gate section above. Whoever lands F-4
  closes this.
- `packages/shared/src/schemas/api.ts` and `docs/api/openapi.json` both changed
  (`HealthResponseSchema` + regenerated contract) — the likeliest merge conflict with another lane.
- `apps/web/test/msw/fixtures.ts` gained one line (`modelStatus` on the `health` fixture); the
  fixture-schema test in `apps/web/test/msw/fixtures.test.ts` enforces it.
- The react-router 7 upgrade changes `apps/web/package.json` and the lockfile; any lane that also
  bumps a web dependency will conflict in `pnpm-lock.yaml`.
- `apps/api/test/unit/config.test.ts` and `apps/api/test/int/trust-proxy.test.ts` are existing
  files this lane had to edit — the new production guard makes their old `prod` fixtures invalid.
  Everything else in `apps/api/test/**` is a new file, as briefed.
