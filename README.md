# wecom Knowledge Platform

Monorepo: `apps/api` (Fastify + PostgreSQL), `apps/web` (React), `packages/shared` (contracts), `packages/connectors`, `packages/model`, `deploy/`, `docs/`, `legacy/` (previous static app, kept as the design reference).

See `docs/superpowers/specs/` for the design and `docs/superpowers/plans/` for the lane plans. Legacy app docs: `legacy/README.md`. Operating the deployed system (backups, restore drills, rotating secrets, adding a connector or category, upgrading the model): `docs/operations.md`. Installing on the target VM: `deploy/INSTALL.md`.

## Scripts

Root (`pnpm <script>`):

| script | what it does |
| --- | --- |
| `build` | `pnpm -r build` — builds every workspace package/app |
| `lint` | eslint + `prettier --check` across the repo |
| `typecheck` | `pnpm -r typecheck` |
| `test` | `pnpm -r test` (unit tests; integration tests are skipped unless `RUN_INTEGRATION=1`) |
| `openapi` | regenerates `docs/api/openapi.json` from the API's Zod schemas, then the web client types |
| `e2e:real` | the no-mocks end-to-end gate — a real Postgres, the real API, the built SPA, Playwright; see `scripts/e2e-real.mjs` |

`apps/api` (`pnpm --filter @wecom/api <script>`), on top of the usual `build`/`test`/`typecheck`:

| script | what it does |
| --- | --- |
| `test:int` | integration tests against a real (testcontainers) Postgres — set `RUN_INTEGRATION=1` |
| `migrate` / `migrate:down` | run/roll back `apps/api/migrations` |
| `seed` | loads the legacy static library into a fresh database |
| `create-admin` | creates/resets the local break-glass admin account |
| `load:fixture --docs 5000` | generates a realistic Hebrew fixture library (varied categories/waves, 5-15 steps, CRM refs, shared blocks, cross-document links) directly with batched SQL — for load testing, not through the HTTP API |
| `perf:check` | §11 non-functional gate: loads the fixture into a throwaway Postgres and asserts `GET /documents`, `GET /documents/:id` and `GET /search` stay under their p95 latency budget (300 ms / 500 ms) at 5,000 documents |

## CI (`.github/workflows/`)

- **`ci.yml`** — `build` (lint, typecheck, build, unit tests, `RUN_INTEGRATION=1 test:int` against a real testcontainers Postgres, an OpenAPI drift check, and a PHP syntax lint of `deploy/wp-plugin/kb-sync.php`), `e2e` (Playwright against the msw-backed dev build), `e2e-real` (`pnpm e2e:real` — Playwright against the real stack, no mocks), `perf` (`pnpm --filter @wecom/api perf:check`).
- **`deploy-smoke.yml`** — validates `deploy/nginx.conf`, `ollama-pull.sh` and `INSTALL.md`; runs the backup/restore round trip against a throwaway container; then actually builds the `api`/`web` Docker images, brings the full Compose stack up, and runs `deploy/smoke.sh` against it over TLS.

## WordPress plugin

`deploy/wp-plugin/kb-sync.php` is plain PHP with no build step. Lint it after any edit — locally and in CI (`ci.yml`'s `build` job runs the same check):
```bash
docker run --rm -v "$PWD/deploy/wp-plugin:/app" php:8.2-cli php -l /app/kb-sync.php
```
