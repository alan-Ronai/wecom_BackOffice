# wecom Knowledge Platform — installation on the LAN VM

Target: one VMware VM, Ubuntu 22.04/24.04, 4 vCPU, 16 GB RAM, 80 GB disk, Docker Engine ≥ 26 with Compose v2, no GPU.

## Clean install
1. Install Docker: `curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER` (log out and in).
2. Clone: `git clone <repo-url> /opt/wecom-kb && cd /opt/wecom-kb`.
3. Configure: `cp deploy/.env.example deploy/.env`, then set `POSTGRES_PASSWORD`, `SESSION_SECRET` (`openssl rand -hex 32`), `CONNECTOR_KEY` (`openssl rand -hex 32` — required even if you add the WordPress connector later; it encrypts connector secrets at rest), `PUBLIC_URL` (the DNS name users will open), and the identity settings below. `SESSION_SECRET` and `CONNECTOR_KEY` have development defaults that the API **refuses to start with** when `NODE_ENV=production`, so a half-filled `.env` fails loudly at step 5 rather than silently storing secrets under a known key.
4. TLS: place `cert.pem` and `key.pem` in `deploy/certs/` (see "TLS certificate").
5. Start: `docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build`.
   First start pulls the model (~2 GB, 5–20 min on the LAN); progress: `docker compose -f deploy/docker-compose.yml logs -f ollama-pull`.
6. Verify: `deploy/smoke.sh https://<PUBLIC_URL host>` prints `smoke passed`.
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
deploy/backup.sh   # or wait for the nightly one; see Backup
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
`nginx` terminates TLS and forwards `X-Real-IP` / `X-Forwarded-For`. The API only believes those headers when `TRUST_PROXY` allows the peer, so leave it set (default `172.16.0.0/12`, the docker bridge range; `true` trusts any peer, `false` trusts none). `req.ip` is what the Palo Alto subnet allowlist, the per-IP auth rate limits and the `audit_log.ip` / `sessions.ip` columns record — with the wrong value the allowlist evaluates nginx's own address and every login shares one rate-limit bucket. Check it after install: `curl -sk https://<host>/api/v1/auth/me` from a workstation and confirm the workstation's address (not `172.x`) appears in `/admin/sessions`.

## TLS certificate
Request a server certificate for `PUBLIC_URL`'s host from the internal CA (`deploy/certs/README.md`). Users' machines already trust the internal CA through GlobalProtect / domain policy, so no browser warning appears. Renewal: replace the two files and `docker compose -f deploy/docker-compose.yml restart web`.

## Microsoft Entra ID
Ask IT for an app registration: Web platform, redirect URI = `OIDC_REDIRECT_URI`, ID tokens enabled, optional claim `groups` (security groups), API permission `GroupMember.Read.All` (application, admin-consented) for the nightly sync. Put `OIDC_ISSUER` (`https://login.microsoftonline.com/<tenant-id>/v2.0`), `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` in `deploy/.env`, restart `api`, and map groups to roles in the admin UI (`/admin/groups-map`).

## Palo Alto User-ID fallback
Until the app registration exists, set `AUTH_FALLBACK=paloalto`, `PALOALTO_HOST` (firewall management address), `PALOALTO_API_KEY` (from `https://<fw>/api/?type=keygen&user=…&password=…` with a read-only admin), and `PALOALTO_SUBNETS` (comma-separated CIDRs allowed to auto-login). `PALOALTO_SCHEME` (default `https`) selects the scheme used to reach the firewall's API — leave it as `https` in every real deployment; `http` exists only so the test suite can run a local stub firewall. The API asks the firewall which user owns the caller's IP and signs that user in. Roles for such users are assigned in `/admin/users`.

## WordPress connector
1. Generate the config-encryption key once and put it in `deploy/.env`: `CONNECTOR_KEY=$(openssl rand -hex 32)`. Connector configs are stored AES-256-GCM encrypted with it — rotating the key makes existing connectors unreadable, so keep it with the database backups.
2. In WordPress, create a dedicated editor user for the KB and issue an **application password** (*Users → Profile → Application Passwords*). The REST API is reached at `https://<wp-host>/wp-json/wp/v2/…`.
3. Copy `deploy/wp-plugin` to `wp-content/plugins/kb-sync`, activate **KB Sync**, and fill *Settings → KB Sync*: webhook URL `https://<kb-host>/api/v1/connectors/<connectorId>/webhook`, the shared secret, and the post types to sync (see `deploy/wp-plugin/README.md`). Lint the plugin's PHP after editing it: `docker run --rm -v "$PWD/deploy/wp-plugin:/app" php:8.2-cli php -l /app/kb-sync.php` (also run in CI on every push).
4. In the KB, add the connector under `/admin/connectors` with `baseUrl`, `username`, `applicationPassword`, `postTypes`, `categoryMap` (WP category slug → KB category) and `webhookSecret` (the same secret as step 3), then **Test** and **Run**. The default schedule is every 15 minutes; each connector gets its own cron job. A `json` connector's `path` must resolve inside `CONNECTOR_FILE_ROOT` (default `/data/connectors`) — this is what stops a connector reading arbitrary files on the container. `CONNECTOR_HOST_ALLOWLIST` (comma-separated, empty = any public host) restricts which hosts outbound connector HTTP (a WordPress `baseUrl`) may reach; private/loopback/link-local targets are always refused unless the host is listed — this is the SSRF guard, so widen it rather than leaving it empty if the WordPress host is on a private LAN address (which it normally is here).
5. Verify both directions: edit a post in WordPress → suggestions appear in the review queue, and accepting + publishing them creates the `sync_links` row; publish a linked card in the KB → the post is updated (the push runs after the publish transaction commits, so a WordPress outage never blocks a local publish — it shows up as a `job.failed` event and an `api` log line). When both sides changed since the last sync the link goes to `conflict` and waits for a lead — nothing is overwritten automatically.

## Retention
`TRASH_DAYS` (default 30) is how long a soft-deleted document survives before the nightly `trash.purge` job hard-deletes it (and prunes sessions expired/revoked more than a week ago). `BACKUP_RETENTION_DAYS` (compose-only, default 14) is how long `backup.sh` keeps old dumps in `deploy/backups`.

## Performance
§11 of the design spec requires library reads under 300 ms and search under 500 ms (p95) at 5,000 documents. `apps/api/scripts/load-fixture.ts` (`pnpm --filter @wecom/api load:fixture --docs 5000`) generates a realistic fixture library directly with SQL (varied categories/waves, 5–15 steps, CRM references, shared blocks, cross-document links); `apps/api/scripts/perf-check.ts` (`pnpm --filter @wecom/api perf:check`) loads that fixture into a throwaway Postgres and measures `GET /documents`, `GET /documents/:id` and `GET /search` (Hebrew and Latin terms) against it, failing if any p95 exceeds its threshold. Both run in CI (the `build` job) on every push.

## Troubleshooting
- `health` shows `db:false` → `docker compose logs db`; check `POSTGRES_PASSWORD` matches in `.env`.
- `model:false` → look at `modelStatus` in the same body. `reachable:false` means Ollama itself is
  down (`docker compose logs ollama`); `reachable:true, tagPresent:false` means Ollama is up but
  `modelStatus.name` has never been pulled — check `MODEL_NAME` in `deploy/.env` against
  `docker compose exec ollama ollama list`, then `docker compose logs ollama-pull` and rerun with
  `docker compose up ollama-pull`.
- Browser certificate error → the cert's CN/SAN does not match `PUBLIC_URL`, or the CA is not trusted on that machine.
- Slow suggestions → expected on CPU (10–40 s per paragraph); jobs are queued, see `GET /api/v1/admin/system` (queue depths, model reachability, last backup age).
- Logs: `docker compose logs -f api` (JSON lines; filter by `requestId` shown in error messages).
