# L1 — Platform & Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the whole stack run on the LAN VM from a clean clone: Docker Compose (api, db, ollama, web), TLS via nginx, structured logging, job-queue runtime (pg-boss), a health/system probe that reports DB, model and queue, tested backup/restore, an install guide, a smoke test, and CI that builds the images and smoke-tests the composed stack.

**Architecture:** Four containers on one Docker network. `web` (nginx) terminates TLS with an internal-CA certificate and proxies `/api` and `/events` to `api`; `api` (Node 22) runs migrations on start, hosts pg-boss workers in-process, and probes `db` and `ollama` for `/api/v1/system/health`; `ollama` runs CPU inference and pulls the configured model on first start; a `backup` sidecar runs `pg_dump` nightly with 14-day retention. Everything is configured by one `.env`.

**Tech Stack:** Docker 26 + Compose v2, nginx 1.27, pgvector/pgvector:pg16, ollama/ollama, Node 22 (pnpm 9), pg-boss 10, pino 9, fastify-plugin 5, vitest 2, bash, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-13-kb-platform-program-and-lanes.md` (§5 L1, §11) and `docs/superpowers/specs/2026-09-13-kb-platform-stage1-foundation-design.md` (§1, §6). Consumes names from `docs/superpowers/plans/2026-09-13-L0-contracts-and-scaffold.md` (Tasks 13–14): `buildApp`, `Config`/`ConfigSchema` keys, `HealthResponseSchema`, `app.db`, `app.config`, migrations in `apps/api/migrations`.

## Global Constraints

- Node `>=22`, pnpm `>=9`, TypeScript `strict: true`; Docker Engine `>=26`, Compose `v2`.
- The VM has no GPU: Ollama runs on CPU; default model `qwen2.5:3b-instruct-q4_K_M` (`MODEL_NAME` in `.env`).
- All traffic inside the LAN goes over TLS terminated by nginx with an internal-CA certificate; plain HTTP redirects to HTTPS.
- Secrets live only in `deploy/.env` (never committed); `deploy/.env.example` lists every key of `ConfigSchema` from `apps/api/src/config.ts` plus the compose-only keys (`POSTGRES_PASSWORD`, `TLS_CERT_PATH`, `TLS_KEY_PATH`, `BACKUP_RETENTION_DAYS`).
- Daily backups with a tested restore script; retention 14 days.
- Logs: JSON lines (pino) to stdout with `requestId`; user-facing strings Hebrew, logs English.
- `HealthResponseSchema` shape is fixed by L0: `{ ok, db, model, queue, version, uptimeSec }` — this plan fills `model` and `queue`, it does not change the schema.
- Commit after every task; commit messages end with the attribution lines the session provides.

## File structure produced by this plan

```
deploy/
  docker-compose.yml          api, db, ollama, ollama-init, web, backup
  nginx.conf                  TLS, HSTS, /api + /events proxy (SSE-safe), SPA fallback
  .env.example                every Config key + compose keys
  api.Dockerfile              multi-stage pnpm build of apps/api (+ workspace packages)
  web.Dockerfile              multi-stage pnpm build of apps/web → nginx image
  ollama-init.sh              pulls MODEL_NAME once, idempotent
  backup.sh                   pg_dump → $BACKUP_DIR/kb-YYYYmmdd-HHMM.sql.gz, prune > retention
  restore.sh                  restores a chosen dump into a fresh DB, verifies table count
  backup.Dockerfile           postgres client + cron running backup.sh nightly
  smoke.sh                    curls health over TLS, asserts db=true and model=true
  INSTALL.md                  clean install, upgrade, backup, restore, TLS, Entra, Palo Alto
  certs/README.md             how to place cert.pem/key.pem from the internal CA
apps/api/src/plugins/boss.ts  app.boss (pg-boss) decorator, start/stop lifecycle
apps/api/src/plugins/logging.ts  pino options + request-id propagation
apps/api/src/services/probes.ts  probeModel(), probeQueue()
apps/api/src/routes/health.ts     (modify) fills model and queue
apps/api/src/server.ts            (modify) run migrations then listen
apps/api/src/migrate.ts           programmatic migration runner
apps/api/test/probes.test.ts      stubbed Ollama (node:http) + boss probe
apps/api/test/health.test.ts      (modify) model/queue assertions
.github/workflows/ci.yml          (modify) build images, compose up, smoke
```

---

### Task 1: Compose-only environment file and internal-CA certificate placeholder

**Files:**
- Create: `deploy/.env.example`, `deploy/certs/README.md`, `deploy/certs/.gitignore`

**Interfaces:**
- Produces: the canonical key list every later task reads from `deploy/.env`. Compose-only keys: `POSTGRES_PASSWORD`, `TLS_CERT_PATH`, `TLS_KEY_PATH`, `BACKUP_RETENTION_DAYS`, `WEB_HTTPS_PORT`, `WEB_HTTP_PORT`.

- [ ] **Step 1: Write a test that the example env covers every `ConfigSchema` key**

`apps/api/test/env-example.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ConfigSchema } from '../src/config.js';

describe('deploy/.env.example', () => {
  it('lists every ConfigSchema key', () => {
    const text = readFileSync(new URL('../../../deploy/.env.example', import.meta.url), 'utf8');
    const keys = new Set(text.split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split('=')[0]));
    for (const k of Object.keys(ConfigSchema.shape)) expect(keys, k).toContain(k);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @wecom/api test -- env-example`
Expected: FAIL — `ENOENT: deploy/.env.example`.

- [ ] **Step 3: Write `deploy/.env.example`**

```dotenv
# ── api (ConfigSchema keys) ─────────────────────────────────────────────
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://kb:change-me@db:5432/kb
SESSION_SECRET=change-me-to-32-random-chars-minimum
PUBLIC_URL=https://kb.wecom.local
OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_REDIRECT_URI=https://kb.wecom.local/api/v1/auth/callback
AUTH_FALLBACK=none
PALOALTO_HOST=
PALOALTO_API_KEY=
PALOALTO_SUBNETS=10.0.0.0/8
MODEL_URL=http://ollama:11434
MODEL_NAME=qwen2.5:3b-instruct-q4_K_M
BACKUP_DIR=/backups
# ── compose only ────────────────────────────────────────────────────────
POSTGRES_PASSWORD=change-me
TLS_CERT_PATH=./certs/cert.pem
TLS_KEY_PATH=./certs/key.pem
BACKUP_RETENTION_DAYS=14
WEB_HTTPS_PORT=443
WEB_HTTP_PORT=80
```

`deploy/certs/README.md`:
```markdown
# TLS certificate

Place the certificate issued by the company's internal CA here:

- `cert.pem` — server certificate (plus intermediate chain, server first)
- `key.pem`  — private key, mode 600

Request a certificate for the DNS name in `PUBLIC_URL` (default `kb.wecom.local`).
For a lab install without a CA: `openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=kb.wecom.local"`.
Both files are ignored by git.
```

`deploy/certs/.gitignore`:
```
*.pem
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @wecom/api test -- env-example`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add deploy/.env.example deploy/certs apps/api/test/env-example.test.ts
git commit -m "deploy: env example covering every config key, cert placeholder"
```

---

### Task 2: Structured logging with request ids

**Files:**
- Create: `apps/api/src/plugins/logging.ts`
- Modify: `apps/api/src/app.ts` (use `loggerOptions`, add request-id header)
- Test: `apps/api/test/logging.test.ts`

**Interfaces:**
- Produces: `loggerOptions(config: Config): FastifyServerOptions['logger']`, `REQUEST_ID_HEADER = 'x-request-id'`; every response carries `x-request-id`; every log line has `requestId`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { REQUEST_ID_HEADER } from '../src/plugins/logging.js';

const DB = 'postgres://nobody:none@127.0.0.1:1/none';
describe('logging', () => {
  it('echoes an incoming request id and generates one when missing', async () => {
    const app = await buildApp({ config: { DATABASE_URL: DB } });
    const r1 = await app.inject({ method: 'GET', url: '/api/v1/system/health', headers: { [REQUEST_ID_HEADER]: 'abc-123' } });
    expect(r1.headers[REQUEST_ID_HEADER]).toBe('abc-123');
    const r2 = await app.inject({ method: 'GET', url: '/api/v1/system/health' });
    expect(String(r2.headers[REQUEST_ID_HEADER])).toMatch(/^[0-9a-f-]{36}$/);
    await app.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @wecom/api test -- logging`
Expected: FAIL — cannot find module `../src/plugins/logging.js`.

- [ ] **Step 3: Implement**

`apps/api/src/plugins/logging.ts`:
```ts
import type { FastifyServerOptions } from 'fastify';
import type { Config } from '../config.js';

export const REQUEST_ID_HEADER = 'x-request-id';

export function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  if (config.NODE_ENV === 'test') return false;
  return {
    level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    serializers: {
      req: (req) => ({ method: req.method, url: req.url, requestId: req.id, ip: req.ip }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  };
}
```

In `apps/api/src/app.ts` replace the `Fastify({ logger: ..., genReqId: ... })` line with:
```ts
import { loggerOptions, REQUEST_ID_HEADER } from './plugins/logging.js';
// …
const app = Fastify({
  logger: loggerOptions(config),
  requestIdHeader: REQUEST_ID_HEADER,
  genReqId: () => crypto.randomUUID(),
}).withTypeProvider<ZodTypeProvider>();
app.addHook('onSend', async (req, reply) => { reply.header(REQUEST_ID_HEADER, req.id); });
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @wecom/api test`
Expected: PASS (health + logging).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/plugins/logging.ts apps/api/src/app.ts apps/api/test/logging.test.ts
git commit -m "feat(api): structured pino logging with request ids"
```

---

### Task 3: pg-boss runtime plugin (`app.boss`)

**Files:**
- Create: `apps/api/src/plugins/boss.ts`
- Modify: `apps/api/src/app.ts` (register plugin after `dbPlugin`)
- Test: `apps/api/test/boss.test.ts` (integration, testcontainers)

**Interfaces:**
- Produces: `app.boss: PgBoss | null` (null when `opts.boss === false` or DB unreachable at start in test), `QUEUES = { pipelineProcess: 'pipeline.process', sourcesWatch: 'sources.watch', connectorRun: 'connector.run', connectorWebhook: 'connector.webhook', identitySync: 'identity.sync', trashPurge: 'trash.purge', searchReindex: 'search.reindex', backupCheck: 'system.backup-check' }` (the canonical job catalogue; other lanes import `QUEUES` and never spell queue names inline) exported from `plugins/boss.ts`. L2/L5/L6 register workers with `app.boss.work(QUEUES.x, handler)`.

- [ ] **Step 1: Write the failing integration test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { buildApp } from '../src/app.js';
import { QUEUES } from '../src/plugins/boss.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
run('pg-boss plugin', () => {
  let c: StartedPostgreSqlContainer;
  beforeAll(async () => { c = await new PostgreSqlContainer('pgvector/pgvector:pg16').start(); }, 120000);
  afterAll(async () => { await c?.stop(); });
  it('starts boss and round-trips a job', async () => {
    const app = await buildApp({ config: { DATABASE_URL: c.getConnectionUri(), NODE_ENV: 'test' } });
    await app.ready();
    expect(app.boss).not.toBeNull();
    const got: string[] = [];
    await app.boss!.work(QUEUES.trashPurge, async (jobs) => { for (const j of jobs) got.push((j.data as { x: string }).x); });
    await app.boss!.send(QUEUES.trashPurge, { x: 'hello' });
    await new Promise((r) => setTimeout(r, 1500));
    expect(got).toEqual(['hello']);
    await app.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @wecom/api test:int -- boss`
Expected: FAIL — `app.boss` undefined / module missing.

- [ ] **Step 3: Implement**

`apps/api/src/plugins/boss.ts`:
```ts
import fp from 'fastify-plugin';
import PgBoss from 'pg-boss';

export const QUEUES = {
  pipelineProcess: 'pipeline.process',   // L5: turn a source revision into suggestions (concurrency 1)
  sourcesWatch: 'sources.watch',         // L5: watched-folder poller
  connectorRun: 'connector.run',         // L6: scheduled connector sync (one schedule per connector id)
  connectorWebhook: 'connector.webhook', // L6: webhook-triggered sync
  identitySync: 'identity.sync',         // L3: nightly Entra users/groups refresh
  trashPurge: 'trash.purge',             // L2: nightly hard delete after 30 days
  searchReindex: 'search.reindex',       // L2: rebuild search_text / embeddings
  backupCheck: 'system.backup-check',    // L1: verify last backup age
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

declare module 'fastify' { interface FastifyInstance { boss: PgBoss | null } }

export default fp(async (app, opts: { boss?: boolean }) => {
  if (opts.boss === false) { app.decorate('boss', null); return; }
  const boss = new PgBoss({ connectionString: app.config.DATABASE_URL, schema: 'pgboss', retryLimit: 3, retryBackoff: true, archiveCompletedAfterSeconds: 3600, deleteAfterDays: 7 });
  boss.on('error', (err) => app.log.error({ err }, 'pg-boss error'));
  try {
    await boss.start();
    for (const q of Object.values(QUEUES)) await boss.createQueue(q);
    app.decorate('boss', boss);
    app.log.info('pg-boss started');
  } catch (err) {
    app.log.warn({ err }, 'pg-boss not started (database unreachable)');
    app.decorate('boss', null);
    return;
  }
  app.addHook('onClose', async () => { await boss.stop({ graceful: true, timeout: 5000 }); });
});
```

In `apps/api/src/app.ts`, after `await app.register(dbPlugin, { pool: opts.pool });` add:
```ts
import bossPlugin from './plugins/boss.js';
// …
await app.register(bossPlugin, { boss: opts.boss });
```
and extend the `buildApp` options type to `{ config?: Partial<Config>; pool?: pg.Pool; boss?: boolean }`. In the existing unit tests (`health.test.ts`, `logging.test.ts`) pass `boss: false` so they don't wait on a database.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @wecom/api test && pnpm --filter @wecom/api test:int -- boss`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/plugins/boss.ts apps/api/src/app.ts apps/api/test
git commit -m "feat(api): pg-boss runtime plugin with named queues"
```

---

### Task 4: Model and queue probes, health route fills `model` and `queue`

**Files:**
- Create: `apps/api/src/services/probes.ts`
- Modify: `apps/api/src/routes/health.ts`
- Test: `apps/api/test/probes.test.ts`, modify `apps/api/test/health.test.ts`

**Interfaces:**
- Produces: `probeModel(modelUrl: string, modelName: string, timeoutMs = 1500): Promise<{ up: boolean; hasModel: boolean; latencyMs: number }>`, `probeQueue(boss: PgBoss | null): Promise<number | null>` (pending jobs across `QUEUES`). Health `model` = `up && hasModel`, `queue` = pending count or null.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/probes.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { probeModel } from '../src/services/probes.js';

let server: http.Server; let url = '';
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/api/tags') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ models: [{ name: 'qwen2.5:3b-instruct-q4_K_M' }] })); return; }
    res.statusCode = 404; res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

describe('probeModel', () => {
  it('reports up and hasModel from /api/tags', async () => {
    const r = await probeModel(url, 'qwen2.5:3b-instruct-q4_K_M');
    expect(r.up).toBe(true); expect(r.hasModel).toBe(true); expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });
  it('reports missing model', async () => {
    expect((await probeModel(url, 'llama3:8b')).hasModel).toBe(false);
  });
  it('reports down on connection error', async () => {
    const r = await probeModel('http://127.0.0.1:1', 'x', 300);
    expect(r.up).toBe(false); expect(r.hasModel).toBe(false);
  });
});
```

Add to `apps/api/test/health.test.ts`:
```ts
it('reports model=false and queue=null when nothing is reachable', async () => {
  const app = await buildApp({ config: { DATABASE_URL: 'postgres://nobody:none@127.0.0.1:1/none', MODEL_URL: 'http://127.0.0.1:1' }, boss: false });
  const body = (await app.inject({ method: 'GET', url: '/api/v1/system/health' })).json();
  expect(body.model).toBe(false); expect(body.queue).toBeNull();
  await app.close();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @wecom/api test -- probes health`
Expected: FAIL — module `services/probes.js` missing; health `model` is `null`.

- [ ] **Step 3: Implement**

`apps/api/src/services/probes.ts`:
```ts
import type PgBoss from 'pg-boss';
import { QUEUES } from '../plugins/boss.js';

export async function probeModel(modelUrl: string, modelName: string, timeoutMs = 1500): Promise<{ up: boolean; hasModel: boolean; latencyMs: number }> {
  const t0 = Date.now();
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(new URL('/api/tags', modelUrl), { signal: ctrl.signal });
    if (!res.ok) return { up: false, hasModel: false, latencyMs: Date.now() - t0 };
    const body = (await res.json()) as { models?: { name: string }[] };
    const hasModel = (body.models ?? []).some((m) => m.name === modelName || m.name.split(':')[0] === modelName.split(':')[0]);
    return { up: true, hasModel, latencyMs: Date.now() - t0 };
  } catch {
    return { up: false, hasModel: false, latencyMs: Date.now() - t0 };
  } finally { clearTimeout(timer); }
}

export async function probeQueue(boss: PgBoss | null): Promise<number | null> {
  if (!boss) return null;
  try {
    let pending = 0;
    for (const q of Object.values(QUEUES)) pending += await boss.getQueueSize(q);
    return pending;
  } catch { return null; }
}
```

Replace `apps/api/src/routes/health.ts` with:
```ts
import type { FastifyInstance } from 'fastify';
import { HealthResponseSchema, VERSION } from '@wecom/shared';
import { probeModel, probeQueue } from '../services/probes.js';

const started = Date.now();
export default async function routes(app: FastifyInstance) {
  app.get('/system/health', { schema: { tags: ['system'], response: { 200: HealthResponseSchema } } }, async () => {
    let db = false;
    try { await app.db.query('select 1'); db = true; } catch { db = false; }
    const [m, queue] = await Promise.all([probeModel(app.config.MODEL_URL, app.config.MODEL_NAME), probeQueue(app.boss)]);
    const model = m.up && m.hasModel;
    return { ok: db && model, db, model, queue, version: VERSION, uptimeSec: Math.round((Date.now() - started) / 1000) };
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @wecom/api test`
Expected: PASS.

- [ ] **Step 5: Regenerate OpenAPI (schema unchanged, file must stay identical) and commit**

```bash
pnpm --filter @wecom/api openapi && git diff --exit-code -- docs/api/openapi.json
git add apps/api/src apps/api/test
git commit -m "feat(api): model and queue probes in system health"
```

---

### Task 5: Migrate-on-start and server bootstrap

**Files:**
- Create: `apps/api/src/migrate.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/test/migrate.test.ts` (integration)

**Interfaces:**
- Produces: `runMigrations(databaseUrl: string, log?: (msg: string) => void): Promise<string[]>` (names applied); `server.ts` calls it before `listen` when `MIGRATE_ON_START !== 'false'`.

- [ ] **Step 1: Write the failing integration test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runMigrations } from '../src/migrate.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
run('runMigrations', () => {
  let c: StartedPostgreSqlContainer;
  beforeAll(async () => { c = await new PostgreSqlContainer('pgvector/pgvector:pg16').start(); }, 120000);
  afterAll(async () => { await c?.stop(); });
  it('applies all migrations once and is idempotent', async () => {
    const first = await runMigrations(c.getConnectionUri());
    expect(first.length).toBeGreaterThanOrEqual(7);
    const second = await runMigrations(c.getConnectionUri());
    expect(second).toEqual([]);
    const pool = new pg.Pool({ connectionString: c.getConnectionUri() });
    expect((await pool.query("select count(*)::int as n from information_schema.tables where table_name='documents'")).rows[0].n).toBe(1);
    await pool.end();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @wecom/api test:int -- migrate`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`apps/api/src/migrate.ts`:
```ts
import { runner } from 'node-pg-migrate';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function runMigrations(databaseUrl: string, log: (msg: string) => void = () => undefined): Promise<string[]> {
  const applied = await runner({ databaseUrl, dir, direction: 'up', migrationsTable: 'pgmigrations', log, checkOrder: true });
  return applied.map((m) => m.name);
}
```

`apps/api/src/server.ts`:
```ts
import { buildApp } from './app.js';
import { runMigrations } from './migrate.js';
import { loadConfig } from './config.js';

const config = loadConfig();
if (process.env.MIGRATE_ON_START !== 'false') {
  const applied = await runMigrations(config.DATABASE_URL, (m) => console.log(JSON.stringify({ level: 30, msg: m, component: 'migrate' })));
  console.log(JSON.stringify({ level: 30, msg: `migrations applied: ${applied.length}`, applied }));
}
const app = await buildApp();
await app.listen({ port: app.config.PORT, host: '0.0.0.0' });
const shutdown = async (signal: string) => { app.log.info({ signal }, 'shutting down'); await app.close(); process.exit(0); };
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
```

Note: `migrations` must be copied into the image next to `dist/` (Task 6 Dockerfile does `COPY apps/api/migrations ./migrations`), so `path.resolve(dist, '..', 'migrations')` resolves in both dev (`src/../migrations`) and prod (`dist/../migrations`).

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @wecom/api test:int -- migrate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/migrate.ts apps/api/src/server.ts apps/api/test/migrate.test.ts
git commit -m "feat(api): migrate on start and graceful shutdown"
```

---

### Task 6: API and web Dockerfiles

**Files:**
- Create: `deploy/api.Dockerfile`, `deploy/web.Dockerfile`, `.dockerignore`

**Interfaces:**
- Produces: images `wecom-kb-api` (entry `node apps/api/dist/server.js`, port 3000) and `wecom-kb-web` (nginx, ports 80/443, static files at `/usr/share/nginx/html`).

- [ ] **Step 1: Write a build check script as the "test"**

`deploy/build-check.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker build -f deploy/api.Dockerfile -t wecom-kb-api:test .
docker build -f deploy/web.Dockerfile -t wecom-kb-web:test .
docker run --rm wecom-kb-api:test node -e "import('/app/apps/api/dist/app.js').then(()=>console.log('api image ok'))"
docker run --rm wecom-kb-web:test sh -c "test -f /usr/share/nginx/html/index.html && nginx -t && echo web image ok"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `chmod +x deploy/build-check.sh && deploy/build-check.sh`
Expected: FAIL — Dockerfiles not found.

- [ ] **Step 3: Write the Dockerfiles**

`.dockerignore` (repo root):
```
node_modules
**/node_modules
**/dist
legacy
docs
.git
.playwright-mcp
deploy/certs/*.pem
```

`deploy/api.Dockerfile`:
```dockerfile
# ── build ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/connectors/package.json packages/connectors/
COPY packages/model/package.json packages/model/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @wecom/api...
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @wecom/api... build
RUN pnpm --filter @wecom/api... --prod deploy /out

# ── runtime ─────────────────────────────────────────────────────────────
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/apps/api
COPY --from=build /out ./
COPY apps/api/migrations ./migrations
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:3000/api/v1/system/health | grep -q '"db":true' || exit 1
CMD ["node", "dist/server.js"]
```

`deploy/web.Dockerfile`:
```dockerfile
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @wecom/web...
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
COPY docs/api/openapi.json ./docs/api/openapi.json
RUN pnpm --filter @wecom/shared build && pnpm --filter @wecom/web generate:client && pnpm --filter @wecom/web build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80 443
```

(The `nginx.conf` referenced here is written in Task 7; for this task's build check create it first from Task 7 Step 3 or run the check after Task 7 — the order in this plan is intentional: Task 6 Step 4 is executed after Task 7 Step 3.)

- [ ] **Step 4: Run the build check (after Task 7 Step 3 exists)**

Run: `deploy/build-check.sh`
Expected: prints `api image ok` and `web image ok`.

- [ ] **Step 5: Commit**

```bash
git add deploy/api.Dockerfile deploy/web.Dockerfile deploy/build-check.sh .dockerignore
git commit -m "deploy: multi-stage api and web images"
```

---

### Task 7: nginx with TLS, SSE-safe proxying and SPA fallback

**Files:**
- Create: `deploy/nginx.conf`
- Test: `deploy/nginx-check.sh`

- [ ] **Step 1: Write the check script**

`deploy/nginx-check.sh`:
```bash
#!/usr/bin/env bash
# Validates nginx.conf syntax inside the official image with dummy certs.
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d)
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$tmp/key.pem" -out "$tmp/cert.pem" -days 1 -subj "/CN=test" >/dev/null 2>&1
docker run --rm -v "$PWD/nginx.conf:/etc/nginx/nginx.conf:ro" -v "$tmp:/etc/nginx/certs:ro" nginx:1.27-alpine nginx -t
grep -q 'proxy_buffering off' nginx.conf && grep -q 'try_files $uri /index.html' nginx.conf && echo "nginx.conf ok"
```

- [ ] **Step 2: Run to verify it fails**

Run: `chmod +x deploy/nginx-check.sh && deploy/nginx-check.sh`
Expected: FAIL — `nginx.conf` missing.

- [ ] **Step 3: Write `deploy/nginx.conf`**

```nginx
worker_processes auto;
events { worker_connections 1024; }
http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  log_format json escape=json '{"time":"$time_iso8601","ip":"$remote_addr","method":"$request_method","uri":"$request_uri","status":$status,"bytes":$body_bytes_sent,"ms":$request_time,"requestId":"$upstream_http_x_request_id"}';
  access_log /dev/stdout json;
  error_log /dev/stderr warn;
  sendfile on;
  gzip on;
  gzip_types text/plain text/css application/json application/javascript image/svg+xml;
  client_max_body_size 50m;                       # docx uploads

  upstream api { server api:3000; }

  server {
    listen 80;
    return 301 https://$host$request_uri;
  }

  server {
    listen 443 ssl;
    http2 on;
    server_name _;
    ssl_certificate     /etc/nginx/certs/cert.pem;
    ssl_certificate_key /etc/nginx/certs/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;

    root /usr/share/nginx/html;

    location /api/ {
      proxy_pass http://api;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto https;
      proxy_read_timeout 300s;                    # model calls can be slow on CPU
    }

    location /events {
      proxy_pass http://api;
      proxy_http_version 1.1;
      proxy_set_header Connection "";
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_buffering off;                        # SSE
      proxy_cache off;
      proxy_read_timeout 24h;
      chunked_transfer_encoding off;
    }

    location /assets/ { expires 30d; add_header Cache-Control "public, immutable"; }
    location / { try_files $uri /index.html; add_header Cache-Control "no-cache"; }
  }
}
```

- [ ] **Step 4: Run the check**

Run: `deploy/nginx-check.sh`
Expected: `nginx: configuration file /etc/nginx/nginx.conf test is successful` and `nginx.conf ok`. Then run `deploy/build-check.sh` (Task 6 Step 4) — both images build.

- [ ] **Step 5: Commit**

```bash
git add deploy/nginx.conf deploy/nginx-check.sh
git commit -m "deploy: nginx TLS reverse proxy with SSE-safe /events"
```

---

### Task 8: Ollama first-start model pull

**Files:**
- Create: `deploy/ollama-init.sh`
- Test: `deploy/ollama-init-check.sh`

**Interfaces:**
- Produces: a one-shot container `ollama-init` in compose that waits for `ollama` and runs `ollama pull $MODEL_NAME` only if the tag is not already present.

- [ ] **Step 1: Write the check (runs the script against a stub HTTP server, no real Ollama)**

`deploy/ollama-init-check.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# stub: /api/tags returns the model as present → script must exit 0 without pulling
python3 - <<'PY' &
import http.server, json
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.send_header('content-type','application/json'); self.end_headers()
        self.wfile.write(json.dumps({"models":[{"name":"qwen2.5:3b-instruct-q4_K_M"}]}).encode())
    def log_message(self,*a): pass
http.server.HTTPServer(('127.0.0.1', 11499), H).serve_forever()
PY
pid=$!
sleep 0.5
OLLAMA_HOST=http://127.0.0.1:11499 MODEL_NAME=qwen2.5:3b-instruct-q4_K_M OLLAMA_BIN=/bin/false bash ollama-init.sh
kill $pid
echo "ollama-init ok (model already present, no pull attempted)"
```

- [ ] **Step 2: Run to verify it fails**

Run: `chmod +x deploy/ollama-init-check.sh && deploy/ollama-init-check.sh`
Expected: FAIL — `ollama-init.sh: No such file`.

- [ ] **Step 3: Write `deploy/ollama-init.sh`**

```bash
#!/usr/bin/env bash
# Pull the configured model once. Idempotent: skips when the tag already exists.
set -euo pipefail
: "${OLLAMA_HOST:=http://ollama:11434}"
: "${MODEL_NAME:=qwen2.5:3b-instruct-q4_K_M}"
: "${OLLAMA_BIN:=ollama}"

for i in $(seq 1 60); do
  if curl -fsS "$OLLAMA_HOST/api/tags" >/dev/null 2>&1; then break; fi
  echo "waiting for ollama ($i)"; sleep 2
done

if curl -fsS "$OLLAMA_HOST/api/tags" | grep -q "\"name\":\"$MODEL_NAME\""; then
  echo "model $MODEL_NAME already present"
  exit 0
fi
echo "pulling $MODEL_NAME (CPU quantized, first start only)"
OLLAMA_HOST="$OLLAMA_HOST" "$OLLAMA_BIN" pull "$MODEL_NAME"
echo "model ready"
```

- [ ] **Step 4: Run the check**

Run: `deploy/ollama-init-check.sh`
Expected: `model … already present` then `ollama-init ok`.

- [ ] **Step 5: Commit**

```bash
git add deploy/ollama-init.sh deploy/ollama-init-check.sh
git commit -m "deploy: idempotent ollama model pull on first start"
```

---

### Task 9: Backup sidecar with nightly `pg_dump` and tested restore

**Files:**
- Create: `deploy/backup.sh`, `deploy/restore.sh`, `deploy/backup.Dockerfile`
- Test: `deploy/backup-check.sh` (runs against a throwaway Postgres container)

**Interfaces:**
- Produces: dumps at `$BACKUP_DIR/kb-YYYYmmdd-HHMM.sql.gz`; `restore.sh <file>` restores into `$DATABASE_URL` after dropping/recreating the schema, prints table count.

- [ ] **Step 1: Write the check**

`deploy/backup-check.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
name=kb-backup-check
docker rm -f $name >/dev/null 2>&1 || true
docker run -d --name $name -e POSTGRES_USER=kb -e POSTGRES_PASSWORD=kb -e POSTGRES_DB=kb -p 55432:5432 pgvector/pgvector:pg16 >/dev/null
for i in $(seq 1 30); do docker exec $name pg_isready -U kb >/dev/null 2>&1 && break; sleep 1; done
export DATABASE_URL=postgres://kb:kb@127.0.0.1:55432/kb
export BACKUP_DIR=$(mktemp -d) BACKUP_RETENTION_DAYS=14
docker exec $name psql -U kb -d kb -c "create table t(x int); insert into t values (1),(2),(3);" >/dev/null
bash backup.sh
f=$(ls "$BACKUP_DIR"/kb-*.sql.gz | head -1); test -s "$f"
docker exec $name psql -U kb -d kb -c "drop table t;" >/dev/null
bash restore.sh "$f" | tee /tmp/restore.out
docker exec $name psql -U kb -d kb -tAc "select count(*) from t" | grep -qx 3
# retention: an old file must be pruned
touch -d '20 days ago' "$BACKUP_DIR/kb-20000101-0000.sql.gz"; bash backup.sh; test ! -e "$BACKUP_DIR/kb-20000101-0000.sql.gz"
docker rm -f $name >/dev/null
echo "backup/restore ok"
```

- [ ] **Step 2: Run to verify it fails**

Run: `chmod +x deploy/backup-check.sh && deploy/backup-check.sh`
Expected: FAIL — `backup.sh: No such file`.

- [ ] **Step 3: Write the scripts and sidecar image**

`deploy/backup.sh`:
```bash
#!/usr/bin/env bash
# Nightly logical backup. Requires DATABASE_URL, BACKUP_DIR; optional BACKUP_RETENTION_DAYS (default 14).
set -euo pipefail
: "${BACKUP_DIR:=/backups}"; : "${BACKUP_RETENTION_DAYS:=14}"
mkdir -p "$BACKUP_DIR"
stamp=$(date +%Y%m%d-%H%M)
out="$BACKUP_DIR/kb-$stamp.sql.gz"
pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -6 > "$out.tmp"
mv "$out.tmp" "$out"
echo "backup written: $out ($(du -h "$out" | cut -f1))"
find "$BACKUP_DIR" -name 'kb-*.sql.gz' -mtime +"$BACKUP_RETENTION_DAYS" -print -delete | sed 's/^/pruned: /'
```

`deploy/restore.sh`:
```bash
#!/usr/bin/env bash
# Usage: restore.sh <dump.sql.gz>  — restores into DATABASE_URL after recreating the public schema.
set -euo pipefail
file=${1:?dump file required}
test -s "$file"
echo "restoring $file into $DATABASE_URL"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "drop schema if exists public cascade; drop schema if exists pgboss cascade; create schema public;"
gunzip -c "$file" | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q
n=$(psql "$DATABASE_URL" -tAc "select count(*) from information_schema.tables where table_schema='public'")
echo "restore complete: $n tables"
```

`deploy/backup.Dockerfile`:
```dockerfile
FROM postgres:16-alpine
RUN apk add --no-cache bash gzip findutils
COPY deploy/backup.sh deploy/restore.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh \
 && echo '15 2 * * * /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1' > /etc/crontabs/root
CMD ["crond", "-f", "-l", "8"]
```

- [ ] **Step 4: Run the check**

Run: `deploy/backup-check.sh`
Expected: `backup written`, `restore complete: 1 tables`, `pruned: …kb-20000101…`, `backup/restore ok`.

- [ ] **Step 5: Commit**

```bash
git add deploy/backup.sh deploy/restore.sh deploy/backup.Dockerfile deploy/backup-check.sh
git commit -m "deploy: nightly pg_dump sidecar with retention and tested restore"
```

---

### Task 10: Docker Compose stack and smoke test

**Files:**
- Create: `deploy/docker-compose.yml`, `deploy/smoke.sh`

**Interfaces:**
- Produces: `docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build` brings up the stack; `deploy/smoke.sh [base-url]` exits 0 when `db` and `model` are true (use `SMOKE_REQUIRE_MODEL=false` in CI to skip the model requirement since pulling 2 GB in CI is out of scope).

- [ ] **Step 1: Write `deploy/smoke.sh`**

```bash
#!/usr/bin/env bash
# Smoke test: health must be reachable over TLS and report db=true (and model=true unless SMOKE_REQUIRE_MODEL=false).
set -euo pipefail
base=${1:-https://localhost}
: "${SMOKE_REQUIRE_MODEL:=true}"
for i in $(seq 1 60); do
  body=$(curl -ksS "$base/api/v1/system/health" || true)
  if echo "$body" | grep -q '"db":true'; then
    if [ "$SMOKE_REQUIRE_MODEL" = "true" ] && ! echo "$body" | grep -q '"model":true'; then echo "waiting for model ($i): $body"; sleep 5; continue; fi
    echo "health ok: $body"
    rid=$(curl -ksSI "$base/api/v1/system/health" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-request-id"{print $2}')
    test -n "$rid" && echo "request id ok: $rid"
    curl -ksS -o /dev/null -w 'spa %{http_code}\n' "$base/" | grep -q 'spa 200'
    echo "smoke passed"; exit 0
  fi
  echo "waiting for api ($i): $body"; sleep 2
done
echo "smoke FAILED"; exit 1
```

- [ ] **Step 2: Run to verify it fails**

Run: `chmod +x deploy/smoke.sh && deploy/smoke.sh https://localhost`
Expected: after 60 retries `smoke FAILED` (nothing is running).

- [ ] **Step 3: Write `deploy/docker-compose.yml`**

```yaml
name: wecom-kb
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: kb
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: kb
    volumes: [dbdata:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U kb -d kb"], interval: 5s, timeout: 5s, retries: 20 }
    restart: unless-stopped

  ollama:
    image: ollama/ollama:latest
    volumes: [ollama:/root/.ollama]
    environment: { OLLAMA_KEEP_ALIVE: 30m, OLLAMA_NUM_PARALLEL: 1, OLLAMA_MAX_LOADED_MODELS: 1 }
    healthcheck: { test: ["CMD-SHELL", "ollama list >/dev/null 2>&1 || exit 1"], interval: 10s, timeout: 5s, retries: 30 }
    restart: unless-stopped

  ollama-init:
    image: ollama/ollama:latest
    entrypoint: ["/bin/bash", "/ollama-init.sh"]
    environment: { OLLAMA_HOST: "http://ollama:11434", MODEL_NAME: "${MODEL_NAME}" }
    volumes: ["./ollama-init.sh:/ollama-init.sh:ro"]
    depends_on: { ollama: { condition: service_healthy } }
    restart: "no"

  api:
    build: { context: .., dockerfile: deploy/api.Dockerfile }
    image: wecom-kb-api
    env_file: .env
    environment:
      DATABASE_URL: postgres://kb:${POSTGRES_PASSWORD}@db:5432/kb
      MODEL_URL: http://ollama:11434
    depends_on:
      db: { condition: service_healthy }
      ollama: { condition: service_healthy }
    volumes: [uploads:/data/uploads]
    restart: unless-stopped

  web:
    build: { context: .., dockerfile: deploy/web.Dockerfile }
    image: wecom-kb-web
    ports: ["${WEB_HTTPS_PORT:-443}:443", "${WEB_HTTP_PORT:-80}:80"]
    volumes:
      - ${TLS_CERT_PATH}:/etc/nginx/certs/cert.pem:ro
      - ${TLS_KEY_PATH}:/etc/nginx/certs/key.pem:ro
    depends_on: [api]
    restart: unless-stopped

  backup:
    build: { context: .., dockerfile: deploy/backup.Dockerfile }
    image: wecom-kb-backup
    environment:
      DATABASE_URL: postgres://kb:${POSTGRES_PASSWORD}@db:5432/kb
      BACKUP_DIR: /backups
      BACKUP_RETENTION_DAYS: ${BACKUP_RETENTION_DAYS:-14}
      TZ: Asia/Jerusalem
    volumes: [./backups:/backups]
    depends_on: { db: { condition: service_healthy } }
    restart: unless-stopped

volumes:
  dbdata: {}
  ollama: {}
  uploads: {}
```

- [ ] **Step 4: Bring the stack up locally and smoke it**

```bash
cp deploy/.env.example deploy/.env   # edit POSTGRES_PASSWORD, SESSION_SECRET, TLS paths
cd deploy/certs && openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=kb.wecom.local" && cd ../..
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
SMOKE_REQUIRE_MODEL=false deploy/smoke.sh https://localhost
```
Expected: `health ok`, `request id ok`, `smoke passed` (model becomes true once `ollama-init` finishes pulling; rerun without the env override to verify).

- [ ] **Step 5: Commit**

```bash
git add deploy/docker-compose.yml deploy/smoke.sh
git commit -m "deploy: docker compose stack and smoke test"
```

---

### Task 11: INSTALL guide

**Files:**
- Create: `deploy/INSTALL.md`

- [ ] **Step 1: Write a link/step checker as the test**

`deploy/install-check.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
for h in "## Clean install" "## Upgrade" "## Backup" "## Restore" "## TLS certificate" "## Microsoft Entra ID" "## Palo Alto User-ID fallback" "## Troubleshooting"; do
  grep -q "^$h" INSTALL.md || { echo "missing section: $h"; exit 1; }
done
for f in docker-compose.yml .env.example backup.sh restore.sh smoke.sh; do grep -q "$f" INSTALL.md || { echo "INSTALL.md does not mention $f"; exit 1; }; done
echo "INSTALL.md ok"
```

- [ ] **Step 2: Run to verify it fails**

Run: `chmod +x deploy/install-check.sh && deploy/install-check.sh`
Expected: FAIL — `INSTALL.md` missing.

- [ ] **Step 3: Write `deploy/INSTALL.md`**

```markdown
# wecom Knowledge Platform — installation on the LAN VM

Target: one VMware VM, Ubuntu 22.04/24.04, 4 vCPU, 16 GB RAM, 80 GB disk, Docker Engine ≥ 26 with Compose v2, no GPU.

## Clean install
1. Install Docker: `curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER` (log out and in).
2. Clone: `git clone <repo-url> /opt/wecom-kb && cd /opt/wecom-kb`.
3. Configure: `cp deploy/.env.example deploy/.env`, then set `POSTGRES_PASSWORD`, `SESSION_SECRET` (`openssl rand -hex 32`), `PUBLIC_URL` (the DNS name users will open), and the identity settings below.
4. TLS: place `cert.pem` and `key.pem` in `deploy/certs/` (see "TLS certificate").
5. Start: `docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build`.
   First start pulls the model (~2 GB, 5–20 min on the LAN); progress: `docker compose -f deploy/docker-compose.yml logs -f ollama-init`.
6. Verify: `deploy/smoke.sh https://<PUBLIC_URL host>` prints `smoke passed`.
7. Create the break-glass admin: `docker compose -f deploy/docker-compose.yml exec api node dist/cli.js create-admin --email admin@wecom.local` (command provided by lane L3).
8. Seed the initial library: `docker compose -f deploy/docker-compose.yml exec api node dist/cli.js seed` (lane L2).

## Upgrade
```bash
cd /opt/wecom-kb && git pull
deploy/backup.sh   # or wait for the nightly one; see Backup
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
deploy/smoke.sh https://<host>
```
Migrations run automatically when `api` starts (`MIGRATE_ON_START` defaults to true). Roll back an upgrade by checking out the previous tag and restoring the pre-upgrade dump.

## Backup
The `backup` container runs `backup.sh` every night at 02:15 (`TZ=Asia/Jerusalem`) and writes `deploy/backups/kb-YYYYmmdd-HHMM.sql.gz`, keeping `BACKUP_RETENTION_DAYS` (14) days. Copy that folder to the file server with your normal VM backup job. Run one by hand: `docker compose -f deploy/docker-compose.yml exec backup backup.sh`.

## Restore
```bash
docker compose -f deploy/docker-compose.yml stop api
docker compose -f deploy/docker-compose.yml exec backup restore.sh /backups/kb-20260913-0215.sql.gz
docker compose -f deploy/docker-compose.yml start api
deploy/smoke.sh https://<host>
```
`restore.sh` recreates the `public` and `pgboss` schemas, loads the dump and prints the table count. Test a restore on a scratch VM once per quarter.

## TLS certificate
Request a server certificate for `PUBLIC_URL`'s host from the internal CA (`deploy/certs/README.md`). Users' machines already trust the internal CA through GlobalProtect / domain policy, so no browser warning appears. Renewal: replace the two files and `docker compose -f deploy/docker-compose.yml restart web`.

## Microsoft Entra ID
Ask IT for an app registration: Web platform, redirect URI = `OIDC_REDIRECT_URI`, ID tokens enabled, optional claim `groups` (security groups), API permission `GroupMember.Read.All` (application, admin-consented) for the nightly sync. Put `OIDC_ISSUER` (`https://login.microsoftonline.com/<tenant-id>/v2.0`), `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` in `deploy/.env`, restart `api`, and map groups to roles in the admin UI (`/admin/groups-map`).

## Palo Alto User-ID fallback
Until the app registration exists, set `AUTH_FALLBACK=paloalto`, `PALOALTO_HOST` (firewall management address), `PALOALTO_API_KEY` (from `https://<fw>/api/?type=keygen&user=…&password=…` with a read-only admin), and `PALOALTO_SUBNETS` (comma-separated CIDRs allowed to auto-login). The API asks the firewall which user owns the caller's IP and signs that user in. Roles for such users are assigned in `/admin/users`.

## Troubleshooting
- `health` shows `db:false` → `docker compose logs db`; check `POSTGRES_PASSWORD` matches in `.env`.
- `model:false` → `docker compose logs ollama-init`; rerun with `docker compose up ollama-init`.
- Browser certificate error → the cert's CN/SAN does not match `PUBLIC_URL`, or the CA is not trusted on that machine.
- Slow suggestions → expected on CPU (10–40 s per paragraph); jobs are queued, see `/admin/system`.
- Logs: `docker compose logs -f api` (JSON lines; filter by `requestId` shown in error messages).
```

- [ ] **Step 4: Run the check**

Run: `deploy/install-check.sh`
Expected: `INSTALL.md ok`.

- [ ] **Step 5: Commit**

```bash
git add deploy/INSTALL.md deploy/install-check.sh
git commit -m "docs(deploy): installation, upgrade, backup, restore, identity guide"
```

---

### Task 12: CI — build images and smoke the composed stack

**Files:**
- Modify: `.github/workflows/ci.yml` (add a `deploy` job)
- Create: `deploy/ci.env` (non-secret values for CI), `deploy/docker-compose.ci.yml` (override: no ollama pull, no TLS mount, self-signed cert generated in-job)

- [ ] **Step 1: Write the CI override compose**

`deploy/docker-compose.ci.yml`:
```yaml
services:
  ollama-init:
    entrypoint: ["/bin/sh", "-c", "echo skipping model pull in CI"]
  web:
    volumes:
      - ./certs/cert.pem:/etc/nginx/certs/cert.pem:ro
      - ./certs/key.pem:/etc/nginx/certs/key.pem:ro
    ports: ["8443:443", "8080:80"]
  backup:
    profiles: ["never"]
```

`deploy/ci.env`:
```dotenv
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://kb:ci@db:5432/kb
SESSION_SECRET=ci-secret-ci-secret-ci-secret-1234
PUBLIC_URL=https://localhost:8443
AUTH_FALLBACK=none
PALOALTO_SUBNETS=
MODEL_URL=http://ollama:11434
MODEL_NAME=qwen2.5:3b-instruct-q4_K_M
BACKUP_DIR=/backups
POSTGRES_PASSWORD=ci
TLS_CERT_PATH=./certs/cert.pem
TLS_KEY_PATH=./certs/key.pem
BACKUP_RETENTION_DAYS=14
WEB_HTTPS_PORT=8443
WEB_HTTP_PORT=8080
```

- [ ] **Step 2: Add the job to `.github/workflows/ci.yml`**

Append under `jobs:`:
```yaml
  deploy:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
      - name: self-signed cert
        run: cd deploy/certs && openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 1 -subj "/CN=localhost"
      - name: validate configs
        run: deploy/nginx-check.sh && deploy/ollama-init-check.sh && deploy/install-check.sh
      - name: build images
        run: docker compose --env-file deploy/ci.env -f deploy/docker-compose.yml -f deploy/docker-compose.ci.yml build
      - name: up
        run: docker compose --env-file deploy/ci.env -f deploy/docker-compose.yml -f deploy/docker-compose.ci.yml up -d
      - name: smoke
        run: SMOKE_REQUIRE_MODEL=false deploy/smoke.sh https://localhost:8443
      - name: backup/restore
        run: deploy/backup-check.sh
      - name: logs on failure
        if: failure()
        run: docker compose --env-file deploy/ci.env -f deploy/docker-compose.yml -f deploy/docker-compose.ci.yml logs
      - name: down
        if: always()
        run: docker compose --env-file deploy/ci.env -f deploy/docker-compose.yml -f deploy/docker-compose.ci.yml down -v
```

- [ ] **Step 3: Run the same sequence locally**

```bash
cd deploy/certs && openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 1 -subj "/CN=localhost" && cd ../..
docker compose --env-file deploy/ci.env -f deploy/docker-compose.yml -f deploy/docker-compose.ci.yml up -d --build
SMOKE_REQUIRE_MODEL=false deploy/smoke.sh https://localhost:8443
docker compose --env-file deploy/ci.env -f deploy/docker-compose.yml -f deploy/docker-compose.ci.yml down -v
```
Expected: `smoke passed`, stack tears down cleanly.

- [ ] **Step 4: Push and confirm the `deploy` job is green**

Run: `git push` and check the Actions tab — both `build` and `deploy` jobs pass.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml deploy/ci.env deploy/docker-compose.ci.yml
git commit -m "ci: build images and smoke-test the composed stack"
```

---

## Self-review

- **Spec coverage**: stage-1 §1 containers (api/db/ollama/web) → Tasks 6, 8, 10; `.env` keys → Task 1; nightly `pg_dump` + restore script → Task 9; health endpoint reporting DB, model, queue → Tasks 3–4; structured logs with request ids → Task 2; `deploy/INSTALL.md` (install, upgrade, backup, restore, TLS, Entra, Palo Alto) → Task 11; program §11 TLS with internal CA, secrets only in `.env`, backups tested → Tasks 1, 7, 9; §6 CI runs on every push including the composed stack → Task 12; pg-boss in-process queues (program §2 Architecture) → Task 3. The `/admin/system` UI itself is L4's; its data source (`/system/health` with model and queue) is delivered here.
- **Placeholder scan**: none; every step contains the file content or the exact command. The two CLI commands referenced in INSTALL.md (`create-admin`, `seed`) are named as deliverables of L3 and L2 respectively.
- **Type consistency**: `buildApp({ config, pool, boss })` is extended additively; `HealthResponseSchema` fields are unchanged; `QUEUES` names (`pipeline.process`, `pipeline.process`, `connector.run`, `system.backup-check`, `trash.purge`) are the ones L2/L5/L6 must use; `REQUEST_ID_HEADER` is `x-request-id` in the API, nginx log and smoke test alike.
