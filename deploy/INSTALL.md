# wecom Knowledge Platform — installation on the LAN VM

Target: one VMware VM, Ubuntu 22.04/24.04, 4 vCPU, 16 GB RAM, 80 GB disk, Docker Engine ≥ 26 with Compose v2, no GPU.

## Clean install
1. Install Docker: `curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER` (log out and in).
2. Clone: `git clone <repo-url> /opt/wecom-kb && cd /opt/wecom-kb`.
3. Configure: `cp deploy/.env.example deploy/.env`, then set `POSTGRES_PASSWORD`, `SESSION_SECRET` (`openssl rand -hex 32`), `CONNECTOR_KEY` (`openssl rand -hex 32` — required even if you add the WordPress connector later; it encrypts connector secrets at rest), `PUBLIC_URL` (the DNS name users will open), and the identity settings below. `SESSION_SECRET` and `CONNECTOR_KEY` have development defaults that the API **refuses to start with** when `NODE_ENV=production`, and `CONNECTOR_HOST_ALLOWLIST` and `TRUST_PROXY` must be set there too (both have permissive fallbacks — left empty, the allowlist admits **any reachable host, private ranges and loopback included**, and an unset `TRUST_PROXY` used to trust any `X-Forwarded-For` — that a production deployment should not arrive at by omission; see the WordPress connector and reverse-proxy sections, and set `TRUST_PROXY_HOPS=1` with it). A half-filled `.env` therefore fails loudly at step 5 rather than silently running open. Three
things nothing derives for you, so change them in the same pass as `PUBLIC_URL`:
`OIDC_REDIRECT_URI` (make it `<PUBLIC_URL>/api/v1/auth/callback`; it ships pointing at
`kb.wecom.local` and a stale value is an Entra redirect-mismatch error at the first SSO login,
not a start-up failure), `DATABASE_URL` (harmless on the shipped stack — `docker-compose.yml`
overrides it from `POSTGRES_PASSWORD` for the `api` and `backup` containers — but it is what any
command you run *outside* compose will use), and `MODEL_NAME`/`EMBED_MODEL` if you are not taking
the shipped tags.
4. TLS: place `cert.pem` and `key.pem` in `deploy/certs/` (see "TLS certificate").
5. Start: `docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build`.
   First start pulls the model (~2 GB, 5–20 min on the LAN); progress: `docker compose -f deploy/docker-compose.yml logs -f ollama-pull`.
   The `ollama-pull` service pulls **`MODEL_NAME` only** — compose does not pass it `EMBED_MODEL`
   at all. The search re-rank model (`nomic-embed-text` by default) is therefore never pulled by
   any step on this page, and step 6 does not check it, so pull it once by hand:
   ```bash
   docker compose -f deploy/docker-compose.yml exec ollama ollama pull nomic-embed-text
   ```
   Skip it and nothing fails: search silently falls back to lexical ranking, with no error in the
   logs and `model:true` in health. `docker compose -f deploy/docker-compose.yml exec ollama
   ollama list` is what tells you both tags are actually there.
6. Verify: `deploy/smoke.sh https://<PUBLIC_URL host>` prints `smoke passed`. The argument is a
   whole origin, so include the port if you changed `WEB_HTTPS_PORT` away from 443
   (`deploy/smoke.sh https://kb.wecom.local:9443`). Run it from the repository root: the script
   looks for `deploy/.env` next to itself.
   The check waits for the database **and** for the exact `MODEL_NAME` tag to appear in Ollama's
   `ollama list` — not merely for Ollama to answer — so a mistyped `MODEL_NAME` fails here
   (`waiting for the model tag '<tag>' to be pulled`) instead of at the first suggestion job. It
   also asserts the five security response headers on `GET /`. Run it with
   `SMOKE_REQUIRE_MODEL=false deploy/smoke.sh …` if you are deliberately running without a model.
7. Create the break-glass admin. There is no `--password` flag: `pnpm` echoes the resolved command
   line, so a password given there lands in the terminal transcript and in your shell history
   (acceptance review O-6). Either answer the prompt on a terminal —
   ```bash
   docker compose -f deploy/docker-compose.yml exec api \
     pnpm --filter @wecom/api create-admin --email admin@wecom.local --name 'מנהל'
   ```
   (`exec` allocates a TTY, and the typed characters are not echoed; you are asked to repeat it)
   — or pipe it in for an unattended install, with `exec -T` so stdin reaches the command:
   ```bash
   printf '%s' '<a strong password>' | docker compose -f deploy/docker-compose.yml exec -T api \
     pnpm --filter @wecom/api create-admin --email admin@wecom.local --name 'מנהל' --password-stdin
   ```
   (a leading space keeps that line out of history in bash/zsh with `HISTCONTROL=ignorespace` /
   `setopt histignorespace`; a password file read with `<` avoids the question entirely).
   Minimum length is 12 characters. Re-running the command rotates the password of the existing
   account rather than creating a second one.
8. Seed the initial library: `docker compose -f deploy/docker-compose.yml exec api pnpm --filter @wecom/api seed` (lane L2).

## Upgrade
```bash
cd /opt/wecom-kb && git pull
# Take a pre-upgrade dump — in the `backup` container, the same spelling as under Backup below.
# Not `deploy/backup.sh` on the host: it is `set -u` and needs DATABASE_URL and `pg_dump`, neither
# of which the VM's shell has, so it aborts on the unbound variable and the upgrade proceeds with
# no backup taken. (Or wait for the nightly one; see Backup.)
docker compose -f deploy/docker-compose.yml exec backup backup.sh
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
deploy/smoke.sh https://<host>
```
Migrations run automatically when `api` starts, via the container entrypoint (`pnpm --filter @wecom/api migrate`, controlled by `MIGRATE_ON_START`, default true). Roll back an upgrade by checking out the previous tag and restoring the pre-upgrade dump.

## Backup
Both the `backup` container and the `api` container see `deploy/backups` (the API read-only), so the nightly `system.backup-check` job can report a stale backup on `GET /admin/system`. The `backup` container runs `backup.sh` every night at 02:15 (`TZ=Asia/Jerusalem`) and writes `deploy/backups/kb-YYYYmmdd-HHMM.dump` (pg_dump custom format), keeping `BACKUP_RETENTION_DAYS` (14) days. Copy that folder to the file server with your normal VM backup job. Run one by hand: `docker compose -f deploy/docker-compose.yml exec backup backup.sh`.

## Restore
```bash
docker compose -f deploy/docker-compose.yml stop api
docker compose -f deploy/docker-compose.yml exec backup restore.sh /backups/kb-20260913-0215.dump
docker compose -f deploy/docker-compose.yml start api
deploy/smoke.sh https://<host>
```
`restore.sh` recreates the `public` and `pgboss` schemas, loads the dump with `pg_restore` and prints the table count. Test a restore on a scratch VM once per quarter — this exact round trip (backup → drop → restore → verify row count, plus retention pruning) is exercised by `deploy/backup-check.sh` against a throwaway container.

**Restore drill (non-destructive — leaves the real database untouched):**
```bash
docker compose -f deploy/docker-compose.yml exec backup restore-drill.sh
```
Pass no `-e DATABASE_URL=…`: compose already gives the `backup` container the right one. The
older spelling interpolated `$POSTGRES_PASSWORD` in the **host** shell, where it is unset unless
you sourced `deploy/.env` first, and silently became `postgres://kb:@db:5432/kb` (O-3). The script
now refuses an empty-password URL with that explanation instead of a bare authentication error.
Restores the newest `kb-*.dump` into a throwaway `kb_restore_drill_*` database on the same server, counts `documents`, then drops the scratch database. This is what actually proves a backup is restorable rather than merely present — run it after every change to the backup/retention config, and periodically (e.g. monthly) as its own check independent of the quarterly full restore above. The `system.backup-check` worker's own result (age of the *latest* dump, not whether it restores) is visible at `GET /api/v1/admin/system` → `backup.lastBackupAt` / `backup.lastBackupOk`, and on `GET /api/v1/system/health`.

## Reverse proxy and client IPs
`nginx` terminates TLS and **replaces** `X-Real-IP` / `X-Forwarded-For` with `$remote_addr`, the address the connection actually came from — it does not append to whatever the client sent. That matters because `req.ip` is what the Palo Alto subnet allowlist is checked against: while nginx appended, any client that could reach it could send an `X-Forwarded-For` of its own and be signed in as whoever the firewall maps to that address. `deploy/nginx-check.sh` fails if that line is ever reverted; do not edit it without reading "Trusting X-Forwarded-For" in `docs/operations.md`.

Two `.env` settings decide how the API reads the result. Set both:

- `TRUST_PROXY` — which peers may be believed at all. `deploy/.env.example` ships `172.16.0.0/12`, the docker bridge range; this is what refuses a forged header from a client that reaches the API without going through nginx, so never set it to `true` (`false` trusts none). Unset, it used to fall back to `true`, which is why the API now refuses to start without it.
- `TRUST_PROXY_HOPS` — how far to unwind the header. Optional, and `1` for the shipped stack: "believe exactly the address nginx wrote, and nothing beyond it". Raise it only if you put another proxy in front of nginx, by the number of proxies you added; leaving it unset unwinds the whole trusted chain.

`req.ip` is also what the per-IP auth rate limits and the `audit_log.ip` / `sessions.ip` columns record — with the wrong value the allowlist evaluates nginx's own address and every login shares one rate-limit bucket. Two checks after install:

1. `deploy/smoke.sh https://<host>` — among other things it proves a forged `X-Forwarded-For` does not reach `req.ip` (it sends seven rate-limited login attempts with different forged addresses and insists they share one bucket; the credentials are invalid, and that host cannot attempt a local login for the following minute).
2. `curl -sk https://<host>/api/v1/auth/me` from a workstation, then confirm the workstation's address (not `172.x`) appears in `/admin/sessions`.

## TLS certificate
Request a server certificate for `PUBLIC_URL`'s host from the internal CA (`deploy/certs/README.md`). Users' machines already trust the internal CA through GlobalProtect / domain policy, so no browser warning appears. Renewal: replace the two files and `docker compose -f deploy/docker-compose.yml restart web`.

Whatever issues it, the certificate must name the host in a **subjectAltName**, not only in the CN: every current browser ignores the CN and refuses a SAN-less certificate outright, trusted CA or not. Verify before you hand the link out — `openssl x509 -in deploy/certs/cert.pem -noout -text | grep -A1 "Subject Alternative Name"` must print your host.

## Microsoft Entra ID
Ask IT for an app registration: Web platform, redirect URI = `OIDC_REDIRECT_URI`, ID tokens enabled, optional claim `groups` (security groups), API permission `GroupMember.Read.All` (application, admin-consented) for the nightly sync. Put `OIDC_ISSUER` (`https://login.microsoftonline.com/<tenant-id>/v2.0`), `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` in `deploy/.env`, restart `api`, and map groups to roles in the admin UI (`/admin/groups-map`).

## Palo Alto User-ID fallback
Until the app registration exists, set `AUTH_FALLBACK=paloalto`, `PALOALTO_HOST` (firewall management address), `PALOALTO_API_KEY` (from `https://<fw>/api/?type=keygen&user=…&password=…` with a read-only admin), and `PALOALTO_SUBNETS` (comma-separated CIDRs allowed to auto-login). `PALOALTO_SCHEME` (default `https`) selects the scheme used to reach the firewall's API — leave it as `https` in every real deployment; `http` exists only so the test suite can run a local stub firewall. The API asks the firewall which user owns the caller's IP and signs that user in. Roles for such users are assigned in `/admin/users`. A firewall-identified user arrives with **no roles at all**, so nothing is visible until one is granted — grant it before telling agents the link works, or their first visit is an empty library. The whole path (a browser with no session landing in the library as the firewall's user, an unknown address staying signed out, and an address outside `PALOALTO_SUBNETS` never reaching the firewall) is exercised by `pnpm e2e:compose`; see "Verifying a release on the real stack" below and `docs/operations.md`.

## WordPress connector
1. Generate the config-encryption key once and put it in `deploy/.env`: `CONNECTOR_KEY=$(openssl rand -hex 32)`. Connector configs are stored AES-256-GCM encrypted with it — rotating the key makes existing connectors unreadable, so keep it with the database backups.
2. In WordPress, create a dedicated editor user for the KB and issue an **application password** (*Users → Profile → Application Passwords*). The REST API is reached at `https://<wp-host>/wp-json/wp/v2/…`.
3. Copy `deploy/wp-plugin` to `wp-content/plugins/kb-sync`, activate **KB Sync**, and fill *Settings → KB Sync*: webhook URL `https://<kb-host>/api/v1/connectors/<connectorId>/webhook`, the shared secret, and the post types to sync (see `deploy/wp-plugin/README.md`). Lint the plugin's PHP after editing it: `docker run --rm -v "$PWD/deploy/wp-plugin:/app" php:8.2-cli php -l /app/kb-sync.php` (also run in CI on every push).
4. In the KB, add the connector under `/admin/connectors` with `baseUrl`, `username`, `applicationPassword`, `postTypes`, `categoryMap` (WP category slug → KB category) and `webhookSecret` (the same secret as step 3), then **Test** and **Run**.

   > **Known defect — the wizard cannot do this yet (walkthrough W-1).** Step 2 of
   > `/admin/connectors → ✚ מחבר` renders only *שם המחבר*: none of the six settings above have
   > input fields, so **בדוק חיבור** answers `הגדרות המחבר אינן תקינות` and **צור מחבר** 400s with
   > nowhere to type the fix. `GET /connectors/types` returns the config schema as
   > `configSchema.fields`, while the wizard reads `configSchema.properties`, so the field list is
   > empty for every connector type. Until that is fixed, create the connector with one API call
   > as the admin you made in step 7 — it is the same request the wizard would send, and **Test**,
   > **Run**, the schedule and the webhook URL all work normally on `/admin/connectors` afterwards:
   >
   > ```bash
   > curl -sk -c jar -X POST https://<kb-host>/api/v1/auth/local \
   >   -H 'content-type: application/json' \
   >   -d '{"email":"admin@wecom.local","password":"<the password from step 7>"}'
   > curl -sk -b jar -X POST https://<kb-host>/api/v1/connectors \
   >   -H 'content-type: application/json' -d '{
   >     "type":"wordpress","name":"wordpress","enabled":true,
   >     "config":{"baseUrl":"https://<wp-host>","username":"<kb editor user>",
   >               "applicationPassword":"<application password>","postTypes":["posts"],
   >               "categoryMap":{},"webhookSecret":"<the secret from step 3>"}}'
   > ```
   >
   > `baseUrl`'s host must be named in `CONNECTOR_HOST_ALLOWLIST` (below) or the run is refused. The default schedule is every 15 minutes; each connector gets its own cron job. A `json` connector's `path` must resolve inside `CONNECTOR_FILE_ROOT` (default `/data/connectors`) — this is what stops a connector reading arbitrary files on the container. `CONNECTOR_HOST_ALLOWLIST` (comma-separated) restricts which hosts outbound connector HTTP (a WordPress `baseUrl`) may reach — this is the SSRF guard. It is **required** when `NODE_ENV=production`, and the three settings differ in ways worth knowing before you pick one (`docs/operations.md` → *Adding a connector* is the authoritative description):

   - **empty** — unrestricted: any reachable host, **private ranges and loopback included**. Anyone holding `connectors.manage` can point a connector at `http://127.0.0.1:11434` or at the database port and read the answer back through a source revision. This is the dev/LAN shape, and it is why the API refuses to start on it in production.
   - **`*`** — any **public** host, and exactly that: loopback, `10/8`, `172.16/12`, `192.168/16`, carrier-grade NAT (`100.64/10`), `0.0.0.0`, `::1`, `fc00::/7` and `localhost` are all refused under it. Note that the test reads IP literals and `localhost`, so a DNS name that resolves into private space is still admitted — name your hosts if that matters.
   - **a list** — exactly those hosts, whatever range they are in; an entry beginning with `.` matches that domain and its subdomains (e.g. `wp.wecom.local,.wecom.local`). An explicit entry always wins, `*` present or not.

   The KB is a LAN product and the WordPress instance normally *is* on a private address, so **naming it is how you admit it** — `*` alone will not. Link-local/cloud-metadata addresses (`169.254.0.0/16`, `fe80::/10`) are refused whatever the list says. The same list also constrains the admin identity probes (`PUT /admin/identity`, `POST /admin/identity/test`).
5. Verify both directions: edit a post in WordPress → suggestions appear in the review queue, and accepting + publishing them creates the `sync_links` row; publish a linked card in the KB → the post is updated (the push runs after the publish transaction commits, so a WordPress outage never blocks a local publish — it shows up as a `job.failed` event and an `api` log line). When both sides changed since the last sync the link goes to `conflict` and waits for a lead — nothing is overwritten automatically.

## Retention
`TRASH_DAYS` (default 30) is how long a soft-deleted document survives before the nightly `trash.purge` job hard-deletes it (and prunes sessions expired/revoked more than a week ago). `BACKUP_RETENTION_DAYS` (compose-only, default 14) is how long `backup.sh` keeps old dumps in `deploy/backups`.

## Performance
§11 of the design spec requires library reads under 300 ms and search under 500 ms (p95) at 5,000 documents. `apps/api/scripts/load-fixture.ts` (`pnpm --filter @wecom/api load:fixture --docs 5000`) generates a realistic fixture library directly with SQL (varied categories/waves, 5–15 steps, CRM references, shared blocks, cross-document links); `apps/api/scripts/perf-check.ts` (`pnpm --filter @wecom/api perf:check`) loads that fixture into a throwaway Postgres and measures `GET /documents`, `GET /documents/:id` and `GET /search` (Hebrew and Latin terms) against it, failing if any p95 exceeds its threshold. `perf:check` runs in CI on every push as its own `perf` job (`.github/workflows/ci.yml`), which is also what loads the fixture; see `docs/perf.md` for the two heavier commands (`perf:load`, `perf:sql`) that are not in CI.

## Verifying a release on the real stack
`deploy/smoke.sh` answers "is it up?". `pnpm e2e:compose` answers "does it work?" — it builds the
images, brings this same compose stack up under its own project name (`wecom-kb-e2e`, so it can
never touch the pilot's volumes), and drives a browser through nginx over TLS: the security
headers on the document and on a hashed asset, the Palo Alto fallback signing a LAN client in with
the role it was granted, an editorial round trip (create → publish → search → article), and the
two-way WordPress loop. Two stubs stand in for the firewall and for WordPress
(`scripts/paloalto-stub.mjs`, `scripts/wp-stub.mjs`); everything else is the product.

Run it on a build machine, not on the pilot VM — it wants Docker with compose v2, `openssl`,
`curl`, `lsof`, a Playwright Chromium, TCP ports 8443/8080/8186/8085/8444/8445/8446 free and about
6 GB of disk,
and it takes 15–25 minutes from cold (about 8 with `E2E_SKIP_BUILD=1` on unchanged images).
`KEEP_STACK=1` leaves it running to poke at. It is also `.github/workflows/deploy-e2e.yml`, which
runs on `main`, nightly, and on demand. Configuration lives in `deploy/e2e.env` and is copied over
`deploy/.env` for the duration; whatever was there is moved to `deploy/.env.before-e2e` and
restored afterwards. Full description in `docs/operations.md`.

The gate plays a LAN client honestly: `nginx.conf` replaces `X-Forwarded-For`, so no header a
browser sends can change `req.ip`, and the stack instead runs small forwarder containers pinned to
fixed addresses on a simulated LAN (ports 8444/8445/8446 on the host, which must also be free).
One spec asserts that a browser forging `X-Forwarded-For` stays signed out. See
`docs/operations.md`, "Trusting X-Forwarded-For" and "How the gate plays a LAN client".

## Troubleshooting
- `health` shows `db:false` → `docker compose logs db`; check `POSTGRES_PASSWORD` matches in `.env`.
- `model:false` → look at `modelStatus` in the same body. `reachable:false` means Ollama itself is
  down (`docker compose logs ollama`); `reachable:true, tagPresent:false` means Ollama is up but
  `modelStatus.name` has never been pulled — check `MODEL_NAME` in `deploy/.env` against
  `docker compose exec ollama ollama list`, then `docker compose logs ollama-pull` and rerun with
  `docker compose up ollama-pull`.
- Browser certificate error → the cert's CN/SAN does not match `PUBLIC_URL`, or the CA is not trusted on that machine.
- Slow suggestions → expected on CPU (10–40 s per paragraph); jobs are queued, see `GET /api/v1/admin/system` (queue depths, model reachability, last backup age).
- `backup.lastBackupOk: false` / `lastBackupAt: null` on a stack you installed today → expected,
  and not a failure: `system.backup-check` runs at API start-up and after the nightly backup job,
  and at install time there is no dump yet. It clears itself after 02:15, or immediately with
  `docker compose -f deploy/docker-compose.yml exec backup backup.sh` followed by
  `docker compose -f deploy/docker-compose.yml restart api`.
- Logs, all four on stdout — nothing is written to a file, so `docker compose logs` is the whole
  story and Docker's rotation is what bounds it:
  - `docker compose logs -f api` — the application (JSON lines; filter by `requestId`, which is
    also the `x-request-id` header and the id shown in error messages).
  - `docker compose logs -f web` — nginx's access log, also JSON (`ip`, `uri`, `status`, `ms`,
    `requestId`), which is where you see the client address the API was given.
  - `docker compose logs backup` — the nightly `backup.sh` output, one line per run.
  - `docker compose logs ollama-pull` — the model pull; the container exits when it is done.
