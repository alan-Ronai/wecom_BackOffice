# wecom Knowledge Platform — installation on the LAN VM

Target: one VMware VM, Ubuntu 22.04/24.04, 4 vCPU, 16 GB RAM, 80 GB disk, Docker Engine ≥ 26 with Compose v2, no GPU.

## Clean install
1. Install Docker: `curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER` (log out and in).
2. Clone: `git clone <repo-url> /opt/wecom-kb && cd /opt/wecom-kb`.
3. Configure: `cp deploy/.env.example deploy/.env`, then set `POSTGRES_PASSWORD`, `SESSION_SECRET` (`openssl rand -hex 32`), `PUBLIC_URL` (the DNS name users will open), and the identity settings below.
4. TLS: place `cert.pem` and `key.pem` in `deploy/certs/` (see "TLS certificate").
5. Start: `docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build`.
   First start pulls the model (~2 GB, 5–20 min on the LAN); progress: `docker compose -f deploy/docker-compose.yml logs -f ollama-pull`.
6. Verify: `deploy/smoke.sh https://<PUBLIC_URL host>` prints `smoke passed`.
7. Create the break-glass admin: `docker compose -f deploy/docker-compose.yml exec api pnpm --filter @wecom/api create-admin --email admin@wecom.local` (command provided by lane L3).
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
The `backup` container runs `backup.sh` every night at 02:15 (`TZ=Asia/Jerusalem`) and writes `deploy/backups/kb-YYYYmmdd-HHMM.dump` (pg_dump custom format), keeping `BACKUP_RETENTION_DAYS` (14) days. Copy that folder to the file server with your normal VM backup job. Run one by hand: `docker compose -f deploy/docker-compose.yml exec backup backup.sh`.

## Restore
```bash
docker compose -f deploy/docker-compose.yml stop api
docker compose -f deploy/docker-compose.yml exec backup restore.sh /backups/kb-20260913-0215.dump
docker compose -f deploy/docker-compose.yml start api
deploy/smoke.sh https://<host>
```
`restore.sh` recreates the `public` and `pgboss` schemas, loads the dump with `pg_restore` and prints the table count. Test a restore on a scratch VM once per quarter — this exact round trip (backup → drop → restore → verify row count, plus retention pruning) is exercised by `deploy/backup-check.sh` against a throwaway container.

## TLS certificate
Request a server certificate for `PUBLIC_URL`'s host from the internal CA (`deploy/certs/README.md`). Users' machines already trust the internal CA through GlobalProtect / domain policy, so no browser warning appears. Renewal: replace the two files and `docker compose -f deploy/docker-compose.yml restart web`.

## Microsoft Entra ID
Ask IT for an app registration: Web platform, redirect URI = `OIDC_REDIRECT_URI`, ID tokens enabled, optional claim `groups` (security groups), API permission `GroupMember.Read.All` (application, admin-consented) for the nightly sync. Put `OIDC_ISSUER` (`https://login.microsoftonline.com/<tenant-id>/v2.0`), `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` in `deploy/.env`, restart `api`, and map groups to roles in the admin UI (`/admin/groups-map`).

## Palo Alto User-ID fallback
Until the app registration exists, set `AUTH_FALLBACK=paloalto`, `PALOALTO_HOST` (firewall management address), `PALOALTO_API_KEY` (from `https://<fw>/api/?type=keygen&user=…&password=…` with a read-only admin), and `PALOALTO_SUBNETS` (comma-separated CIDRs allowed to auto-login). The API asks the firewall which user owns the caller's IP and signs that user in. Roles for such users are assigned in `/admin/users`.

## WordPress connector
1. Generate the config-encryption key once and put it in `deploy/.env`: `CONNECTOR_KEY=$(openssl rand -hex 32)`. Connector configs are stored AES-256-GCM encrypted with it — rotating the key makes existing connectors unreadable, so keep it with the database backups.
2. In WordPress, create a dedicated editor user for the KB and issue an **application password** (*Users → Profile → Application Passwords*). The REST API is reached at `https://<wp-host>/wp-json/wp/v2/…`.
3. Copy `deploy/wp-plugin` to `wp-content/plugins/kb-sync`, activate **KB Sync**, and fill *Settings → KB Sync*: webhook URL `https://<kb-host>/api/v1/connectors/<connectorId>/webhook`, the shared secret, and the post types to sync (see `deploy/wp-plugin/README.md`).
4. In the KB, add the connector under `/admin/connectors` with `baseUrl`, `username`, `applicationPassword`, `postTypes`, `categoryMap` (WP category slug → KB category) and `webhookSecret` (the same secret as step 3), then **Test** and **Run**. The default schedule is every 15 minutes; each connector gets its own cron job.
5. Verify: edit a post in WordPress → suggestions appear in the review queue; publish a linked card in the KB → the post is updated. When both sides changed since the last sync the link goes to `conflict` and waits for a lead — nothing is overwritten automatically.

## Troubleshooting
- `health` shows `db:false` → `docker compose logs db`; check `POSTGRES_PASSWORD` matches in `.env`.
- `model:false` → `docker compose logs ollama-pull`; rerun with `docker compose up ollama-pull`.
- Browser certificate error → the cert's CN/SAN does not match `PUBLIC_URL`, or the CA is not trusted on that machine.
- Slow suggestions → expected on CPU (10–40 s per paragraph); jobs are queued, see `/admin/system`.
- Logs: `docker compose logs -f api` (JSON lines; filter by `requestId` shown in error messages).
