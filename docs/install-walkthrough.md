# Install walkthrough — `deploy/INSTALL.md` and `docs/operations.md`, followed literally

**Date:** 2026-09-15 · **Repository:** `main` at `01ae1a0` · **Acceptance review §7 item 21** (the
half that does not need the VM).

Every command below was copied out of `deploy/INSTALL.md` or `docs/operations.md` and run as
written, in order, against a **fresh `git clone`** of the repository (`./.walkthrough/wecom-kb`,
deleted afterwards) — no repository state, no `node_modules`, no `deploy/.env`, no certificates,
nothing pre-pulled. Where a command is shown unchanged it was run unchanged; the three deliberate
deviations are listed under *Deviations* and are marked `[dev]` in the table.

## Machine

| | |
| --- | --- |
| Host | macOS (Darwin 25.0.0, x86_64), zsh |
| Docker | client 28.1.1, engine 29.7.2 (Docker Desktop), Compose v5.5.1 |
| Docker VM | 10 vCPU, 7.7 GB RAM |
| `openssl` | 3.6.3 · `curl` 8.7.1 (LibreSSL) · `lsof` present |
| Browser | Playwright Chromium (from `apps/web`), headless |

The documents target *Ubuntu 22.04/24.04, 4 vCPU, 16 GB RAM, 80 GB disk, Docker ≥ 26*. This host
is not that, which is why the model is the CI tag rather than the shipped one. Nothing in the
walkthrough depended on the difference; the two places where it could have (the Palo Alto
fallback, and a real client address reaching `/admin/sessions`) are called out as *not exercised*.

### Deviations

1. **Model.** `MODEL_NAME=qwen2.5:0.5b-instruct-q4_K_M` (~0.4 GB), the tag
   `.github/workflows/deploy-smoke.yml` uses, instead of the shipped `qwen2.5:3b-instruct-q4_K_M`.
2. **Ports.** `WEB_HTTPS_PORT=127.0.0.1:9443`, `WEB_HTTP_PORT=127.0.0.1:9080`, and
   `PUBLIC_URL=https://localhost:9443`, so the run could not collide with `pnpm e2e:compose`
   (8443–8446, 8080, 8186, 8085).
3. **Compose project.** `-p wecom-walkthrough` added to every compose command, for the same
   reason. The documents' own commands carry no `-p` and use the `name: wecom-kb` in
   `deploy/docker-compose.yml`.

## The steps

Result column: **pass** = the documented command did the documented thing; **pass\*** = it worked
but the document is wrong, unclear or silent about something an operator needs; **fail** = an
operator following the page is stuck. IDs (`W-n`) are the findings in
`.superpowers/sdd/program/operator-walkthrough-report.md`.

| # | Step | Command as documented | What happened | Result | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | Prerequisites (INSTALL §Clean install 1) | `curl -fsSL https://get.docker.com \| sh && sudo usermod -aG docker $USER` | Not run — Docker Desktop already present, and the line is Linux-only. Version floor (≥ 26 + Compose v2) satisfied. | pass | — |
| 2 | Clone (2) | `git clone <repo-url> /opt/wecom-kb && cd /opt/wecom-kb` | Cloned into `./.walkthrough/wecom-kb`. `deploy/backups/` does not exist in a fresh clone; Docker creates it at first `up`, writable, no permission trouble. | pass | — |
| 3 | Configure (3) | `cp deploy/.env.example deploy/.env`, then set `POSTGRES_PASSWORD`, `SESSION_SECRET`, `CONNECTOR_KEY`, `PUBLIC_URL`, `CONNECTOR_HOST_ALLOWLIST`, `TRUST_PROXY`, `TRUST_PROXY_HOPS` | Copied and filled in. The page promises "a half-filled `.env` fails loudly at step 5" — **for `SESSION_SECRET` it did not**: the shipped placeholder is not the value the guard rejects, and the API boots on it (**W-2**). `OIDC_REDIRECT_URI` is not in the list and stays pointed at `kb.wecom.local` (**W-6**). | **fail** | `deploy/.env.example` placeholder shortened below `min(16)` so it is refused (`a71fb43`); `OIDC_REDIRECT_URI`/`DATABASE_URL`/model tags added to step 3 (`3d44359`) |
| 4 | Guards actually fire | — | Booted the api image against four half-filled `.env` files. `CONNECTOR_HOST_ALLOWLIST=` → refused, named, with the reason. `TRUST_PROXY` absent → refused, named. `CONNECTOR_KEY=` → refused. `SESSION_SECRET=<shipped placeholder>` → **started**. | pass\* | see W-2 |
| 5 | TLS (4 + §TLS certificate) | `openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=kb.wecom.local"` | Produced a certificate with **no subjectAltName**. Every current browser refuses such a certificate even from a trusted CA — reproduced with a client applying the RFC 6125 rule: *"Hostname mismatch, certificate is not valid for 'localhost'"*, with the certificate supplied as its own CA. | **fail** | `-addext "subjectAltName=DNS:<host>"` + a verification line added to `deploy/certs/README.md`, requirement stated in INSTALL (`170a8ef`) |
| 6 | First start (5) `[dev]` | `docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build` | Built three images and brought six services up from cold in ~9 min. Migrations ran from the api entrypoint through `0045_pilot_hardening`; `pg-boss started`; server listening. | pass | — |
| 7 | Model pull (5) | `docker compose -f deploy/docker-compose.yml logs -f ollama-pull` | `ollama-pull` exited 0 after ~2.5 min, `model ready`. `--env-file` is not needed here: compose reads `deploy/.env` from the compose file's own directory. **`ollama list` then holds one tag.** `EMBED_MODEL` (`nomic-embed-text`) is never pulled by any step and nothing reports it missing (**W-3**). | pass\* | manual-pull instructions added to INSTALL step 5 and operations §Model upgrade (`b0439cb`) |
| 8 | Smoke (6) | `deploy/smoke.sh https://<PUBLIC_URL host>` | `smoke passed` — db, the exact `MODEL_NAME` tag, request id, SPA 200, five security headers, and the forged-`X-Forwarded-For` rate-limit proof (429 on attempt 6). The documented argument omits the port, which is wrong for any `WEB_HTTPS_PORT` ≠ 443 (**W-7**). | pass\* | step 6 now says "a whole origin, port included" (`3d44359`) |
| 9 | Break-glass admin (7) | `printf '%s' '<pw>' \| docker compose -f deploy/docker-compose.yml exec -T api pnpm --filter @wecom/api create-admin --email admin@wecom.local --name 'מנהל' --password-stdin` | `created admin b72dce74…`. The password did not appear in the echoed pnpm command line, which is the point of the section. The TTY variant was **not exercised** (needs an interactive terminal). | pass | — |
| 10 | Seed (8) | `docker compose -f deploy/docker-compose.yml exec api pnpm --filter @wecom/api seed` | `seeded { documents: 23, cards: 29, topics: 52, blocks: 4, fields: 14, scripts: 7, versions: 27, notes: 1 }`. One `pg` deprecation warning on stderr. | pass | — |
| 11 | First login (headless browser) | not documented as a step; `https://<PUBLIC_URL>` in a browser | Landed on `/login`, signed in with the step-7 account, reached `/library` with the grid rendered and the first-login tour shown. Two CSP violations on every page load: the inline theme script in `index.html` and the Google-Fonts `@import` in `app.css` are both blocked (**W-4**, **W-5**). | pass\* | reported; both fixes are under `apps/**` |
| 12 | Backup (§Backup) | `docker compose -f deploy/docker-compose.yml exec backup backup.sh` | `backup written: /backups/kb-20260915-0509.dump (672.0K)`, visible on the host in `deploy/backups/`. | pass | — |
| 13 | Restore drill (§Restore) | `docker compose -f deploy/docker-compose.yml exec backup restore-drill.sh` | `restore drill OK: … 61 tables, 59 documents`. No `-e DATABASE_URL` needed, exactly as the note says. | pass | — |
| 14 | Backup round trip (`deploy/backup-check.sh`) | `deploy/backup-check.sh` | `backup/restore ok` — dump, drop, restore, row count, retention prune, against a throwaway container. ~2 min. | pass | — |
| 15 | Full restore (§Restore) | `stop api` → `exec backup restore.sh /backups/kb-….dump` → `start api` → `deploy/smoke.sh` | `restore complete: 61 tables`, api back, `smoke passed`. `restore.sh` prints only `host:port/db`, never the URL with the password. | pass | — |
| 16 | nginx check | `deploy/nginx-check.sh` | Green: `nginx -t`, `X-Forwarded-For $remote_addr` on both proxying locations, TLS 1.2 + 1.3 with ECDHE-only suites, 1.0/1.1 refused, `Server: nginx` bare, five headers on `/`, `/assets/*`, `/api/*` and `= /api/v1/events`. | pass | — |
| 17 | INSTALL self-check | `deploy/install-check.sh` | `INSTALL.md ok`. | pass | — |
| 18 | Upgrade (§Upgrade) | `git pull` → `exec backup backup.sh` → `up -d --build` → `deploy/smoke.sh` | All four as documented. Unchanged images meant no container was recreated, which is correct and quiet; the pre-upgrade dump landed. | pass | — |
| 19 | WordPress connector (§WordPress connector 4) | add the connector under `/admin/connectors` with `baseUrl`, `username`, `applicationPassword`, `postTypes`, `categoryMap`, `webhookSecret`, then **Test** and **Run** | Driven in the browser against `scripts/wp-stub.mjs` (as `wp:8085` on the stack network, named in `CONNECTOR_HOST_ALLOWLIST`). **The wizard renders one input — *שם המחבר*.** None of the six settings have fields; **בדוק חיבור** answers `הגדרות המחבר אינן תקינות` and **צור מחבר** 400s (**W-1**). | **fail** | defect + the `POST /api/v1/connectors` call that works documented in both pages (`b291aa6`) |
| 20 | …the same connector via the API | — | `201`, **Test** `{"ok":true,"message":"החיבור ל-WordPress תקין"}`, **Run** `{"imported":1,…}`, source `נוהל WordPress לבדיקה` in `syncState: processing`. The connector, the allowlist and the stub are all fine — only the wizard is not. | pass | — |
| 21 | Logs (§Troubleshooting) | `docker compose logs -f api` | JSON lines carrying `reqId`/`requestId`, matching the `x-request-id` header. `web` logs JSON access lines too and is where the client address shows; neither it nor `backup`/`ollama-pull` was mentioned (**W-8**). | pass\* | all four listed (`3d44359`) |
| 22 | Fresh-install backup status | `GET /api/v1/system/health` | `lastBackupOk:false`, `lastBackupAt:null` on a stack installed minutes ago — the check runs at API start-up, before any dump exists. Clears after a backup **and** a restart (verified). Reads as a failed backup and was documented nowhere (**W-9**). | pass\* | Troubleshooting entry (`3d44359`) |
| 23 | Teardown | *(not documented)* | Neither page says how to stop, start or remove the stack, or that `down -v` destroys `dbdata`/`ollama`/`uploads`/`watch` without a prompt (**W-10**). Torn down with `docker compose -p wecom-walkthrough down -v`; all containers, volumes and networks gone. | **fail** | new §*Stopping, starting and removing the stack* in `docs/operations.md` (`e38a065`) |

### Not exercised

- INSTALL step 7's interactive `create-admin` (needs a TTY).
- **Microsoft Entra ID** and **Palo Alto User-ID fallback** — both need infrastructure this host
  does not have. `pnpm e2e:compose` covers the fallback against a stub.
- §*Reverse proxy* check 2 (a workstation's real address in `/admin/sessions`): on Docker Desktop
  every host request arrives from the bridge gateway, so the check cannot distinguish.
- The WordPress plugin half of the connector section (`deploy/wp-plugin` into a real WordPress).
- `pnpm e2e:compose` itself — out of scope here and it owns ports this run had to avoid.

## Fixes committed by this walkthrough

| commit | what |
| --- | --- |
| `a71fb43` | `deploy/.env.example`: `SESSION_SECRET` placeholder now short enough to be refused at boot |
| `170a8ef` | `deploy/certs/README.md` + INSTALL: the lab certificate needs a `subjectAltName` |
| `b0439cb` | INSTALL + operations: `EMBED_MODEL` is never pulled; pull it by hand |
| `e38a065` | operations: stopping, starting and removing the stack |
| `b291aa6` | INSTALL + operations: the connector wizard defect and the API call that works |
| `3d44359` | INSTALL: `OIDC_REDIRECT_URI`, the smoke origin, the four logs, the fresh-install backup status |

Everything that could not be fixed in `deploy/*.{md,sh}` or `docs/` — `W-1`, `W-2`'s code half,
`W-3`'s code half, `W-4`, `W-5`, and two compose hazards — is written up with a proposed fix in
`.superpowers/sdd/program/operator-walkthrough-report.md`.
