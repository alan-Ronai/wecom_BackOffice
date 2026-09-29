# Pilot readiness — status as of 2026-09-29 (waves 1–6 + wave Y)

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

## VM runbook — what only the pilot VM can sign off (added 2026-09-29)

Everything below needs the 4 vCPU VM, the real tenant, the firewall or the real WordPress site; the
code side is merged and green. Run in order; each step says where its evidence goes.

1. **Install.** Follow `deploy/INSTALL.md` literally. `.env`: keep `MODEL_TIER=1`
   (`EMBED_MODEL=bge-m3`, `EMBED_DIMENSION=1024`); never set `WECOM_E2E_RUNNER` or
   `AUTH_LOCAL_RATE_LIMIT` above 5 (the API refuses to boot in production if you do).
   `deploy/ollama-pull.sh` pulls both tiers; `deploy/ollama-pull-check.sh` must pass.
2. **Smoke.** `deploy/smoke.sh https://<host>` and `deploy/nginx-check.sh`
   → `docs/install-walkthrough.md` § VM.
3. **Seed the base knowledge** (fresh database only): `pnpm --filter @wecom/api migrate` then
   `pnpm --filter @wecom/api seed` — 31 documents incl. the Kira roaming and domestic-reception
   sets (`docs/waveY-acceptance.md` § Y5). Spot-check M-00, M-10 and T-10 in the library.
4. **Search load.** `pnpm --filter @wecom/api perf:load --compare` on a quiet VM
   → `docs/wave5-acceptance.md` § Merged gate. Pass = every class p95 ≤ 500 ms.
5. **Model tiers.** On the VM, with nothing else running:
   ```
   pnpm --filter @wecom/model eval --rules
   pnpm --filter @wecom/model eval --model qwen2.5:3b-instruct-q4_K_M --embed nomic-embed-text --out tier0.json
   pnpm --filter @wecom/model eval --model aya-expanse:8b-q4_K_M      --embed bge-m3           --out tier1.json
   ```
   → `docs/wave6-acceptance.md` § Model evaluation (dev-laptop reference: tier 1 1.000 / 1.000 /
   0.977 / precision 1.000, 0 language failures, ~12 s per case). Keep tier 1 if it still beats
   tier 0 and a case stays under the chat timeout; otherwise set `MODEL_TIER=0` and record why.
6. **Identity.** `/admin/identity`: configure Entra ID (and Palo Alto if used), press both test
   buttons, sign in as one agent, one editor and one **world-scoped manager** — confirm the
   manager can read a two-world document but gets no edit/publish on it (wave Y write rule).
7. **WordPress.** Connect the real site through the wizard (`docs/operations.md` § Adding a
   connector), run it once, review the queue, publish one change and confirm it lands.
8. **Backup.** `deploy/backup.sh` so health leaves `backup.status: never`.

### Open content questions for the owner (Kira import)

- `O-01 - בדיקות שירותי נדידה וחבילת חול במערכת.docx` arrived empty (0 bytes); drop the real
  file into `apps/api/seed/source/kira/roaming/` and run `pnpm --filter @wecom/api convert:kira`.
- Confirm the four code corrections in `convert-kira.mjs` ERRATA (M-00 R-05→R-04 and R-06→R-05,
  R-05 O-06→O-05, R-11 T30→T-10).
- Retire or keep the legacy `pdf-004`, `pdf-010` and the two old reception scripts.
- Referenced but not supplied: R-10, R-14, O-11, O-14, S-10, H-01, H-02, H-11.
