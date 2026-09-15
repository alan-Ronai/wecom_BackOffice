# Operations runbook

For first install see `deploy/INSTALL.md`. This is the day-2 reference: backups, restore
drills, rotating secrets, adding a connector, adding a category, upgrading the model.

All commands assume `cd /opt/wecom-kb` on the target VM and `deploy/.env` already configured,
unless noted otherwise.

## Backups

`backup.sh` runs nightly at 02:15 Asia/Jerusalem inside the `backup` container (`docker compose
-f deploy/docker-compose.yml exec backup backup.sh` to run one by hand) and writes
`deploy/backups/kb-YYYYmmdd-HHMM.dump` (a `pg_dump --format=custom` dump), pruning anything older
than `BACKUP_RETENTION_DAYS` (default 14). The `system.backup-check` worker verifies a recent
dump exists every night after the backup job and at API start-up; its result is visible at:

- `GET /api/v1/system/health` → `lastBackupAt`, `lastBackupOk`
- `GET /api/v1/admin/system` → `backup.lastBackupAt`, `backup.lastBackupOk`, `backup.checkedAt`,
  plus the legacy `backup.ok` / `backup.latestFile` / `backup.ageHours` fields

A `false`/stale `lastBackupOk` means: check `docker compose logs backup`, confirm the `backup`
volume is actually being copied off the VM by your normal backup job, and run a restore drill
(below) — a recent dump existing is not the same as a *restorable* one.

**Copy `deploy/backups` off the VM** with your normal VM/file-server backup job; the container
only proves a dump exists locally.

## Restore drill

Presence of a recent dump only proves `pg_dump` succeeded, not that it restores cleanly.
`deploy/restore-drill.sh` restores the **newest** dump into a throwaway `kb_restore_drill_*`
database on the same Postgres server, counts `documents`, then drops the scratch database —
it never touches the real `kb` database:

```bash
docker compose -f deploy/docker-compose.yml exec backup restore-drill.sh
```

Pass **no** `-e DATABASE_URL=…`: compose already sets a correct one inside the `backup` container.
The older spelling expanded `$POSTGRES_PASSWORD` in the *host* shell — unset there unless you ran
`set -a; . deploy/.env; set +a` first — so it silently became `postgres://kb:@db:5432/kb` and died
at authentication (acceptance review O-3). `restore-drill.sh` now rejects an empty-password URL
with that explanation rather than the raw Postgres error.

Run it:
- after any change to the backup/retention configuration,
- monthly, as routine verification,
- and do the **full** restore (`deploy/INSTALL.md` → Restore) on a scratch VM once a quarter —
  that's the only drill that also proves the `api`/`web` containers come back up against the
  restored data, not just that Postgres accepts the dump.

`deploy/backup-check.sh` (run in `deploy-smoke.yml` CI) exercises the whole backup → drop →
restore → verify round trip against a throwaway container on every push that touches `deploy/**`.

## Rotating secrets

| secret | rotate by | effect |
| --- | --- | --- |
| `SESSION_SECRET` | set a new `openssl rand -hex 32` in `.env`, `docker compose up -d api` | invalidates every signed session cookie — all users are signed out |
| `CONNECTOR_KEY` | **do not rotate casually** — it's the AES-256-GCM key connector configs (WordPress application password, webhook secret) are encrypted at rest with. Rotating it makes existing connectors' stored credentials unreadable; you must re-enter each connector's credentials under `/admin/connectors` immediately after. Keep it with the database backups, not just in `.env`. |
| WordPress application password | reissue in WordPress (*Users → Profile → Application Passwords*), update the connector under `/admin/connectors`, **Test** |
| WordPress webhook shared secret | generate a new one, update *Settings → KB Sync* in WordPress **and** the connector's `webhookSecret` in `/admin/connectors` at the same time — a mismatch 401s every webhook until both sides agree |
| `PALOALTO_API_KEY` | regenerate via `https://<fw>/api/?type=keygen&user=…&password=…`, set it in `.env`, `docker compose up -d api` |
| OIDC client secret | rotate in the Entra app registration, set `OIDC_CLIENT_SECRET` in `.env`, `docker compose up -d api` |
| TLS certificate | replace `deploy/certs/{cert,key}.pem`, `docker compose -f deploy/docker-compose.yml restart web` |

## Adding a connector

See `deploy/INSTALL.md` → **WordPress connector** for the WordPress-specific walkthrough. In
general: a connector's outbound HTTP is constrained by `CONNECTOR_HOST_ALLOWLIST` and a `json`
connector's `path` must resolve inside `CONNECTOR_FILE_ROOT`. Add the connector under
`/admin/connectors`, **Test** before **Run**, and watch `GET /api/v1/admin/system` →
`connectors[]` (`lastStatus`, `lastRunAt`, `conflicts`) after the first scheduled run.

> **`CONNECTOR_HOST_ALLOWLIST` is now required when `NODE_ENV=production`** — the API refuses to
> start with it empty, the same way it refuses the development `SESSION_SECRET` (acceptance
> review §5 / item 18). Write `*` if you genuinely want "any public host": the point is that it is
> a decision on the record, not a blank line. Leaving it empty used to mean
> **any reachable host** — including private ranges and loopback. This is deliberate: the KB is
> a LAN product and the WordPress instance normally *is* on a private address, so the allowlist
> is the control and not the private-range check (`packages/connectors/src/guards.ts`). The only
> thing refused unconditionally is link-local/cloud metadata (`169.254.0.0/16`, `fe80::/10`).
> With the list empty, anyone holding `connectors.manage` can point a connector at
> `http://127.0.0.1:11434` (the model) or at the database port and read the response back
> through a source revision. List the hosts this installation may talk to; an entry beginning
> with `.` matches that domain and its subdomains.
>
> The same list also constrains the admin identity probes — `PUT /admin/identity` and
> `POST /admin/identity/test` refuse an `issuer` or Palo Alto `host` outside it, on the same
> reasoning: `system.admin` is an application permission, not shell access.

## Adding a category

Categories are a closed enum, not a database table, so adding one touches code, not just data:

1. `packages/shared/src/schemas/common.ts` — add the new value to `CategorySchema`.
2. `apps/api/migrations/00NN_add_category_<name>.js` — a new migration that drops and re-adds
   the `documents_category_check` constraint (`check (category in (...))`, migration
   `0003_content.js`) with the new value included. **Additive only** — never remove or rename an
   existing category in the same migration as adding one; existing documents reference it.
3. `apps/api/src/modules/search/repo.ts` — add a Hebrew label to `CATEGORY_LABELS` (and
   `sourceFile()` if the category should map to a different legacy file name for the "N קבצים"
   counter).
4. `apps/web/src/lib/constants.ts` — add the category's label/icon for the frontend category
   filter, sidebar and cards.
5. `pnpm --filter @wecom/api openapi && pnpm --filter @wecom/web generate:client` and commit the
   regenerated `docs/api/openapi.json`.
6. Run `pnpm typecheck` — a category enum change is caught everywhere it's used at compile time.

## Model upgrade

`MODEL_NAME` (chat/suggestions) and `EMBED_MODEL` (search vector re-rank) are Ollama model tags.
To upgrade:

1. Set the new tag in `deploy/.env`.
2. `docker compose -f deploy/docker-compose.yml up -d ollama-pull` — pulls the new model into the
   `ollama` volume (progress: `docker compose logs -f ollama-pull`). The old model stays
   available until you prune it.
3. `docker compose -f deploy/docker-compose.yml up -d api` — the API picks up the new
   `MODEL_NAME`/`EMBED_MODEL` on restart (`app.model`, `plugins/model.ts`).
4. Confirm: `GET /api/v1/admin/system` → `modelName` reflects the new tag, `model: true`.
5. **If `EMBED_MODEL` changed**, every stored `documents.embedding` was computed with the old
   model and is no longer comparable to new query embeddings. Rebuild them: trigger the
   `search.reindex` job (its schedule, or `POST` the job manually if your ops tooling exposes
   that) — it recomputes both derived search text and, when a model with `embed` is configured,
   every document's embedding (`apps/api/src/modules/search/repo.ts#reindexAll`).
6. Prune the old model once you've confirmed the new one is working:
   `docker compose -f deploy/docker-compose.yml exec ollama ollama rm <old-tag>`.

## Performance

§11 of the design spec: library reads (`GET /documents`, `GET /documents/:id`) under 300 ms and
search (`GET /search`) under 500 ms, p95, at 5,000 documents. Verify after any change to a
document/search query or its indexes:

```bash
pnpm --filter @wecom/api perf:check
```

Loads a realistic 5,000-document fixture into a throwaway Postgres
(`apps/api/scripts/load-fixture.ts`, also runnable standalone with `load:fixture --docs N` for
manual poking) and prints a p50/p95 table, failing if any endpoint exceeds its threshold. Runs in
CI (`ci.yml`'s `perf` job) on every push.

## Trusting X-Forwarded-For

`nginx` sets `X-Forwarded-For $proxy_add_x_forwarded_for`, which **appends** the connecting
address to whatever the client sent rather than replacing it, and `TRUST_PROXY` then tells the API
how far out to unwind that list. With the prescribed `TRUST_PROXY=172.16.0.0/12` (the docker
bridge range) the API resolves `req.ip` to the left-most address the bridge did not add — which is
right when there is a second proxy in front, and means that a client able to reach nginx directly
can also *choose* the address the API sees, by sending an `X-Forwarded-For` of its own.

What that address decides:

- the Palo Alto subnet allowlist (`PALOALTO_SUBNETS`) — so a client on the LAN can ask the
  firewall about an address other than its own, and be signed in as whoever holds it;
- the per-IP auth rate-limit buckets;
- the `audit_log.ip` and `sessions.ip` columns.

For the pilot — one VM on a closed LAN, behind the same firewall that answers the User-ID
lookups — this is an accepted risk rather than a hole: the attacker must already be inside, and
can only become a user the firewall maps to an address in `PALOALTO_SUBNETS`. It stops being
acceptable the moment the VM is reachable from a wider network. Two things to do then, in order:

1. keep `TRUST_PROXY` naming the bridge (never `true`, which trusts an `X-Forwarded-For` from any
   peer, including a client that bypasses nginx entirely);
2. make nginx **replace** rather than append, by changing `deploy/nginx.conf`'s two
   `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` lines to `$remote_addr`. Do this
   only when nothing legitimate sits in front of nginx, since it discards a real upstream proxy's
   client address too.

`pnpm e2e:compose` relies on the current behaviour to play a LAN client from a laptop (see below),
so `apps/web/e2e/compose/lan-identity.spec.ts` is the thing that goes red when this changes.

## The Compose end-to-end gate

```bash
pnpm e2e:compose               # the whole gate, ~15–25 min cold
KEEP_STACK=1 pnpm e2e:compose  # …and leave the stack up to poke at
E2E_SKIP_BUILD=1 pnpm e2e:compose -- --grep "firewall"   # rerun one spec against built images
```

`scripts/e2e-compose.mjs` brings up `deploy/docker-compose.yml` + `docker-compose.ci.yml` +
`docker-compose.e2e.yml` under its own compose project (`wecom-kb-e2e`, so `down -v` can never
touch a pilot stack), waits for `modelStatus.tagPresent` the way `deploy/smoke.sh` does, seeds the
library, creates a break-glass admin and a LAN user, and runs `apps/web/e2e/compose/` against
`https://localhost:8443`. It covers what neither `deploy-smoke` nor `pnpm e2e:real` can see:

- TLS and the five security headers on the document, a hashed `/assets/*` bundle and an API call,
  plus the HTTP→HTTPS redirect;
- the **Palo Alto User-ID fallback** end to end — a browser with no session lands in the library
  as the firewall's user with the role the deployment granted, an address the firewall cannot name
  stays signed out, and an address outside `PALOALTO_SUBNETS` never reaches the firewall at all;
- an editorial round trip (create → publish → search → article) through the proxy;
- the two-way WordPress loop, with the connector's outbound call leaving the api *container* and
  being checked against `CONNECTOR_HOST_ALLOWLIST`.

Requirements: Docker with compose v2, `openssl`, `curl`, `lsof`, a Chromium for Playwright
(`pnpm --filter @wecom/web exec playwright install chromium`), and free TCP ports 8443, 8080, 8186
and 8085 — the first two are hard-coded in `docker-compose.ci.yml`, because compose concatenates
`ports` across overlay files instead of replacing them. Roughly 6 GB of disk for the images, the
Ollama layer and the small model.

Two stubs stand in for systems a test machine does not have: `scripts/paloalto-stub.mjs` (the
PAN-OS XML API, with a `/_control/*` plane the specs use to see which addresses were looked up)
and `scripts/wp-stub.mjs` (the same WordPress fake the connector unit tests use). Everything else
is the product. `deploy/e2e.env` holds the configuration and is copied over `deploy/.env` for the
run; whatever was there is moved to `deploy/.env.before-e2e` and put back on the way out.

In CI it is `.github/workflows/deploy-e2e.yml`: on `main`, nightly, and on demand — not on every
pull request, where `deploy-smoke` already builds the same images.
