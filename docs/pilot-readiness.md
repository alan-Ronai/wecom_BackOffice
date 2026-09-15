# Pilot readiness — status as of 2026-09-15 (main ad97969)

What is proven, by which gate, and what only the pilot VM can prove. Companion to
`.superpowers/sdd/program/acceptance-review.md` (the ranked review this closes) and
`docs/wave5-acceptance.md`.

## Proven on every merge (all green on main)

| Gate | Command | What it proves |
|---|---|---|
| Unit | `pnpm test` | contracts, model rules (section grouping, tracked changes), bidi/plural helpers, web components — 1,100+ tests |
| Integration | `RUN_INTEGRATION=1 pnpm --filter @wecom/api test:int` | every OpenAPI operation against a real pgvector Postgres (route-coverage test fails on an untested route), migrations up/down incl. full rollback, RBAC/scope denials, sync state machine, webhook HMAC + replay, proxy trust — 629 tests |
| Web e2e (msw) | `pnpm --filter @wecom/web e2e` | agent/editor flows against schema-validated fixtures — 39 specs |
| Real stack | `pnpm e2e:real` | real Postgres + API + built SPA: login, library, call mode, editor, versions, WordPress round trip through the stub, connector wizard UI path, feedback loop, taxonomy visibility, learning loop — 15 specs |
| Real stack + SSO | `E2E_OIDC=1 pnpm e2e:real` | the same plus a live `oidc-provider` issuer, groups → roles — 16 specs |
| Compose stack | `pnpm e2e:compose` | the pilot topology as shipped: nginx TLS, security headers on every location, HTTP→HTTPS, LAN clients from fixed container addresses identified through a Palo Alto User-ID stub, forged `X-Forwarded-For` ignored, real Ollama with both model tags pulled, a published document embedded, WordPress round trip — 14 specs |
| Deploy checks | `deploy/nginx-check.sh`, `deploy/compose-check.sh`, `deploy/ollama-pull-check.sh`, `deploy/smoke-check.sh`, `deploy/backup-check.sh` | nginx config + live headers + TLS versions, bounded logging on every service, model pulls, smoke argument/backup parsing, backup → restore drill |
| Perf | `pnpm --filter @wecom/api perf:check`, `perf:load --compare` | §11 list/detail budgets; search under 20 concurrent clients at 5,000 documents (see below) |
| Install | `docs/install-walkthrough.md` | INSTALL.md followed literally on a fresh clone, 23 steps, defects fixed |

## Known limits (honest)

- **Search p95 under load.** After the two query changes, p95 is ~650 ms overall at 20 concurrent
  clients on a shared developer machine (was 2.6 s); the §11 budget of 500 ms is met by one query
  class of five here and by all but one in the search lane's quietest run. Sign-off needs one
  `perf:load --compare` on the pilot VM. Two-character prefix queries never hit the server (palette
  minimum is 3 characters).
- **Entra ID against the real tenant** and **Palo Alto User-ID against the real firewall** are
  exercised only against faithful stubs. First login on the VM follows `docs/identity.md`; the
  `/admin/identity` test buttons run the real discovery/op command.
- **The VM install** has been walked on a fresh clone on a Mac, not on the VMware guest;
  `deploy/INSTALL.md` step order and every script passed there unchanged.
- **Web test flakiness under machine load**: two long whole-app specs cross their budget when
  several test suites share the machine; they pass alone and have their own budgets now.

## Before the first supervised pilot

1. Install on the VM per `deploy/INSTALL.md`; run `deploy/smoke.sh https://<host>` and
   `deploy/nginx-check.sh`; record both in `docs/install-walkthrough.md` § VM.
2. Run `pnpm --filter @wecom/api perf:load --compare` once on the VM; paste into
   `docs/wave5-acceptance.md` § Merged gate.
3. Configure Entra ID and (if used) Palo Alto in `/admin/identity`, press both test buttons, sign in
   as one agent and one editor.
4. Connect the real WordPress site through the wizard (`docs/operations.md` § Adding a connector),
   run it once, review the queue, publish one change and confirm it lands in WordPress.
5. Take the first backup (`deploy/backup.sh`) so health leaves `backup.status: never`.
