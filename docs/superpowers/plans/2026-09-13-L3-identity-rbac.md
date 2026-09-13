# L3 — Identity & RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real sign-in with the company Microsoft identity (Entra ID via OIDC) with a Palo Alto User-ID fallback, server-side sessions, fine-grained permission enforcement on every route, and the admin API for users, roles, group mapping, sessions and audit.

**Architecture:** Two Fastify modules under `apps/api/src/modules/` (`auth`, `admin`) plus one plugin (`plugins/auth.ts`) that resolves the session cookie into `req.user` and enforces `config.requires` / `config.scope` declared on routes. Identity providers are pluggable functions behind one `IdentityService`; permission resolution is a pure function over role rows, cached per session for 60 s. Every admin mutation writes an `audit_log` row inside the same transaction through `audit()`.

**Tech Stack:** Fastify 5, fastify-type-provider-zod, `openid-client` 6, `@fastify/rate-limit` 10, `argon2` 0.41, `pg-boss` 10, `ipaddr.js` 2 (CIDR checks), `fast-xml-parser` 4 (Palo Alto XML), `oauth2-mock-server` 7 (tests), `@testcontainers/postgresql`, vitest 2.

**Spec:** `docs/superpowers/specs/2026-09-13-kb-platform-stage1-foundation-design.md` §3 (identity, RBAC, enforcement), §4 (auth and admin routes, conventions) and `docs/superpowers/specs/2026-09-13-kb-platform-program-and-lanes.md` §5 (L3), §6 (contracts 2, 3). Consumes the L0 plan `docs/superpowers/plans/2026-09-13-L0-contracts-and-scaffold.md` (schemas, permissions, migrations, `buildApp`).

## Global Constraints

- Node `>=22`, TypeScript `strict: true`; all user-facing messages in Hebrew, logs/identifiers in English.
- Permission strings exactly as `PERMISSIONS` in `@wecom/shared`: `docs.read, docs.create, docs.edit, docs.publish, docs.delete, docs.restore, blocks.edit, fields.edit, scripts.edit, notes.write, notes.moderate, suggestions.review, suggestions.apply, sources.manage, connectors.manage, users.manage, roles.manage, audit.read, system.admin`.
- Default roles come from `DEFAULT_ROLES`; the `admin` role can never lose `ADMIN_LOCKED` (`roles.manage`, `users.manage`).
- Session cookie name `kb_session`; httpOnly; `SameSite=Lax`; `Secure` outside `NODE_ENV=development`; 8-hour sliding expiry; the DB stores only `sha256(token)`.
- Palo Alto fallback runs only when `AUTH_FALLBACK=paloalto`, only for request IPs inside `PALOALTO_SUBNETS`, and never overrides an existing session.
- Rate limit `/api/v1/auth/*`: 20 requests / minute / IP; `POST /auth/local`: 5 / minute / IP.
- Error envelope `{ code, message, details?, requestId }`; codes used here: `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `SCOPE_DENIED` (403), `PROVIDER_UNAVAILABLE` (503), `INVALID_CREDENTIALS` (401), `LOCKED_PERMISSION` (409), `NOT_FOUND` (404).
- Every mutating admin route writes `audit_log` in the same transaction; every write returns `{ auditId }` in the body.
- DB access uses `app.db` (pg Pool) and the migration column names from L0 Task 14 verbatim (`users.subject`, `users.source`, `user_roles.category_scope`, `groups_map.idp_group_id`, `sessions.token_hash`, `audit_log.actor_id`, …).
- Commit after every task; commit messages end with the attribution lines the session provides.

## File structure produced by this plan

```
apps/api/src/lib/audit.ts                    audit(client, entry) → auditId (create only if L2 hasn't)
apps/api/src/lib/session.ts                  token generation/hashing, cookie options, sliding expiry
apps/api/src/lib/errors.ts                   HttpError(status, code, message) (create only if L2 hasn't)
apps/api/src/modules/auth/permissions.ts     resolvePermissions(db, userId) + pure mergeRoleRows()
apps/api/src/modules/auth/identity.ts        IdentityService: upsertUser, applyGroupMap, deactivate
apps/api/src/modules/auth/oidc.ts            Entra OIDC (openid-client v6) + Graph groups fallback
apps/api/src/modules/auth/paloalto.ts        User-ID XML API lookup with CIDR guard
apps/api/src/modules/auth/local.ts           break-glass password login (argon2)
apps/api/src/modules/auth/routes.ts          /auth/* routes
apps/api/src/plugins/auth.ts                 req.user decorator, cache, enforcement hook
apps/api/src/modules/admin/users.ts          /admin/users
apps/api/src/modules/admin/roles.ts          /admin/roles
apps/api/src/modules/admin/groups-map.ts     /admin/groups-map
apps/api/src/modules/admin/sessions.ts       /admin/sessions
apps/api/src/modules/admin/audit.ts          /admin/audit
apps/api/src/modules/admin/routes.ts         mounts the five admin route files
apps/api/src/jobs/identity-sync.ts           pg-boss job "identity.sync" (nightly)
apps/api/src/cli/create-admin.ts             pnpm --filter @wecom/api create-admin
apps/api/src/app.ts                          (modify) register rate-limit, auth plugin, auth + admin routes, jobs
apps/api/test/unit/permissions.test.ts
apps/api/test/unit/session.test.ts
apps/api/test/unit/scope.test.ts
apps/api/test/helpers/db.ts                  testcontainers Postgres + migrations + seed users helper
apps/api/test/helpers/oidc.ts                oauth2-mock-server issuer
apps/api/test/helpers/paloalto.ts            stub XML API server
apps/api/test/int/auth-oidc.test.ts
apps/api/test/int/auth-paloalto.test.ts
apps/api/test/int/auth-local-session.test.ts
apps/api/test/int/enforcement.test.ts
apps/api/test/int/admin.test.ts
apps/api/test/int/identity-sync.test.ts
```


## Cross-lane reconciliation (authoritative — added after the eight plans were reviewed together)

These names win over anything else in this file. They are the L0-owned contract for runtime glue (ADR 0001).

- **Job queues**: import `QUEUES` from `apps/api/src/plugins/boss.ts` (owned by L1) and never spell queue names inline. Catalogue: `pipeline.process` (L5, concurrency 1), `sources.watch` (L5), `connector.run` (L6, one cron schedule per connector, job key = connector id), `connector.webhook` (L6), `identity.sync` (L3), `trash.purge` (L2), `search.reindex` (L2), `system.backup-check` (L1). The decorator is `app.boss: PgBoss | null`; there is no `plugins/jobs.ts`.
- **Audit**: low-level `audit(tx, { actorId, action, entityType, entityId, before, after, requestId, ip }): Promise<string>` lives in `apps/api/src/lib/audit.ts` (owned by L2; L3 creates it with this exact signature only if L2 has not landed). L3's auth plugin additionally decorates the convenience wrapper `app.audit(req, action, entityType, entityId, before, after)` which fills `actorId = req.user?.id ?? null`, `requestId = req.id`, `ip = req.ip` and runs on `app.db`. L6 uses the wrapper; L2/L5 use the low-level function inside their transactions.
- **Events**: `app.events: EventBus` from `apps/api/src/lib/events.ts` (L2) with `publish(tx, event)` where `event = makeEvent(name, payload)` from `@wecom/shared`. No lane creates `plugins/events.ts`.
- **Auth**: `apps/api/src/plugins/auth.ts` (L3) sets `req.user: AuthUser = { id, displayName, roles, permissions: Set<string>, categoryScopes: string[] | null, sessionId }` (`displayName` is an additive field L3 includes) and enforces route `config: { requires: Permission[], scope?: 'document' }`. No lane adds a `requires()` preHandler or `plugins/authz.ts`; until L3 lands, tests use the `x-test-user` header plugin from L2 (`apps/api/test/helpers/fakeAuth.ts`) or `buildApp({ testUser })` — both must set the same `AuthUser` shape.
- **Module registration**: every `/api/v1` module registers inside the single `v1` callback in `apps/api/src/app.ts` via `registerModules(v1)` from `apps/api/src/modules/index.ts` (L2); other lanes add one line there.
- **For this lane**: add `displayName: string` to `AuthUser` (Task 2) and decorate `app.audit(req, action, entityType, entityId, before, after)` in the auth plugin (Task 4) as a thin wrapper over `lib/audit.ts`; schedule `identity.sync` through `QUEUES.identitySync` from `plugins/boss.ts` instead of creating a jobs plugin.

---

### Task 1: Shared helpers — `HttpError`, `audit()`, session token utilities

**Files:**
- Create (skip any that L2 already created with the same signature): `apps/api/src/lib/errors.ts`, `apps/api/src/lib/audit.ts`
- Create: `apps/api/src/lib/session.ts`
- Test: `apps/api/test/unit/session.test.ts`

**Interfaces:**
- Produces:
  - `class HttpError extends Error { constructor(public statusCode: number, public code: string, message: string, public details?: unknown) }`
  - `audit(client: pg.PoolClient | pg.Pool, e: { actorId: string | null; action: string; entityType: string; entityId: string | null; before: unknown; after: unknown; requestId: string | null; ip: string | null }): Promise<string>` (returns audit id)
  - `newSessionToken(): string` (base64url, 32 random bytes), `hashToken(token: string): string` (hex sha256), `SESSION_COOKIE = 'kb_session'`, `SESSION_TTL_MS = 8 * 3600 * 1000`, `cookieOptions(env: string): CookieSerializeOptions`, `shouldSlide(lastSeenAt: Date, now: Date): boolean` (true when > 5 min since last touch).

- [ ] **Step 1: Write the failing test**

`apps/api/test/unit/session.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { newSessionToken, hashToken, cookieOptions, shouldSlide, SESSION_COOKIE, SESSION_TTL_MS } from '../../src/lib/session.js';

describe('session utilities', () => {
  it('generates 32-byte base64url tokens that hash deterministically', () => {
    const t = newSessionToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(newSessionToken()).not.toBe(t);
  });
  it('sets secure cookie options outside development', () => {
    expect(cookieOptions('production')).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true, path: '/' });
    expect(cookieOptions('development').secure).toBe(false);
    expect(SESSION_COOKIE).toBe('kb_session');
    expect(SESSION_TTL_MS).toBe(8 * 3600 * 1000);
  });
  it('slides only after five minutes', () => {
    const now = new Date('2026-01-01T10:00:00Z');
    expect(shouldSlide(new Date('2026-01-01T09:58:00Z'), now)).toBe(false);
    expect(shouldSlide(new Date('2026-01-01T09:50:00Z'), now)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wecom/api test -- test/unit/session.test.ts`
Expected: FAIL with "Cannot find module '../../src/lib/session.js'".

- [ ] **Step 3: Write the implementation**

`apps/api/src/lib/errors.ts`:
```ts
export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = 'HttpError';
  }
}
export const unauthenticated = () => new HttpError(401, 'UNAUTHENTICATED', 'נדרשת כניסה למערכת');
export const forbidden = (perm?: string) => new HttpError(403, 'FORBIDDEN', 'אין לך הרשאה לפעולה זו', perm ? { permission: perm } : undefined);
export const notFound = (what = 'הפריט') => new HttpError(404, 'NOT_FOUND', `${what} לא נמצא`);
```

`apps/api/src/lib/audit.ts`:
```ts
import type pg from 'pg';

export interface AuditEntryInput {
  actorId: string | null; action: string; entityType: string; entityId: string | null;
  before: unknown; after: unknown; requestId: string | null; ip: string | null;
}
/** Writes one audit row and returns its id. Pass the transaction client so the row commits with the change. */
export async function audit(client: pg.PoolClient | pg.Pool, e: AuditEntryInput): Promise<string> {
  const r = await client.query<{ id: string }>(
    `insert into audit_log(actor_id, action, entity_type, entity_id, before, after, ip, request_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [e.actorId, e.action, e.entityType, e.entityId, e.before == null ? null : JSON.stringify(e.before), e.after == null ? null : JSON.stringify(e.after), e.ip, e.requestId],
  );
  return r.rows[0].id;
}
```

`apps/api/src/lib/session.ts`:
```ts
import { createHash, randomBytes } from 'node:crypto';
import type { CookieSerializeOptions } from '@fastify/cookie';

export const SESSION_COOKIE = 'kb_session';
export const SESSION_TTL_MS = 8 * 3600 * 1000;
const SLIDE_AFTER_MS = 5 * 60 * 1000;

export const newSessionToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const cookieOptions = (env: string): CookieSerializeOptions => ({
  httpOnly: true, sameSite: 'lax', secure: env !== 'development', path: '/', maxAge: SESSION_TTL_MS / 1000,
});
export const shouldSlide = (lastSeenAt: Date, now: Date): boolean => now.getTime() - lastSeenAt.getTime() > SLIDE_AFTER_MS;
```

Add dependencies: `pnpm --filter @wecom/api add argon2@^0.41.1 openid-client@^6.1.3 @fastify/rate-limit@^10.1.1 ipaddr.js@^2.2.0 fast-xml-parser@^4.5.0` and dev `oauth2-mock-server@^7.1.2`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wecom/api test -- test/unit/session.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib apps/api/test/unit/session.test.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): session token utilities, audit helper, HttpError"
```

---

### Task 2: Permission resolution (pure merge + DB query)

**Files:**
- Create: `apps/api/src/modules/auth/permissions.ts`
- Test: `apps/api/test/unit/permissions.test.ts`

**Interfaces:**
- Produces:
  - `type RoleRow = { role_name: string; permission: string | null; category_scope: string[] | null }`
  - `mergeRoleRows(rows: RoleRow[]): { roles: string[]; permissions: Set<string>; categoryScopes: string[] | null }` — scopes merge as: any role with `null` scope → `null` (unrestricted); otherwise the union of arrays.
  - `resolvePermissions(db: Queryable, userId: string): Promise<ReturnType<typeof mergeRoleRows>>` where `Queryable = { query: pg.Pool['query'] }`.
  - `type AuthUser = { id: string; roles: string[]; permissions: Set<string>; categoryScopes: string[] | null; sessionId: string | null }`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/unit/permissions.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mergeRoleRows } from '../../src/modules/auth/permissions.js';

describe('mergeRoleRows', () => {
  it('unions permissions across roles', () => {
    const r = mergeRoleRows([
      { role_name: 'agent', permission: 'docs.read', category_scope: null },
      { role_name: 'agent', permission: 'notes.write', category_scope: null },
      { role_name: 'editor', permission: 'docs.edit', category_scope: null },
    ]);
    expect(r.roles).toEqual(['agent', 'editor']);
    expect([...r.permissions].sort()).toEqual(['docs.edit', 'docs.read', 'notes.write']);
    expect(r.categoryScopes).toBeNull();
  });
  it('unions category scopes when every role is scoped', () => {
    const r = mergeRoleRows([
      { role_name: 'lead', permission: 'docs.publish', category_scope: ['intl'] },
      { role_name: 'lead2', permission: 'docs.publish', category_scope: ['tech', 'intl'] },
    ]);
    expect(r.categoryScopes).toEqual(['intl', 'tech']);
  });
  it('an unscoped role removes all restrictions', () => {
    const r = mergeRoleRows([
      { role_name: 'lead', permission: 'docs.publish', category_scope: ['intl'] },
      { role_name: 'admin', permission: 'system.admin', category_scope: null },
    ]);
    expect(r.categoryScopes).toBeNull();
  });
  it('handles a role with no permissions', () => {
    const r = mergeRoleRows([{ role_name: 'empty', permission: null, category_scope: null }]);
    expect(r.roles).toEqual(['empty']);
    expect(r.permissions.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wecom/api test -- test/unit/permissions.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

`apps/api/src/modules/auth/permissions.ts`:
```ts
import type pg from 'pg';

export type RoleRow = { role_name: string; permission: string | null; category_scope: string[] | null };
export type Resolved = { roles: string[]; permissions: Set<string>; categoryScopes: string[] | null };
export type AuthUser = Resolved & { id: string; sessionId: string | null };
export type Queryable = { query: pg.Pool['query'] };

export function mergeRoleRows(rows: RoleRow[]): Resolved {
  const roles = new Set<string>();
  const permissions = new Set<string>();
  let unrestricted = false;
  const scopes = new Set<string>();
  for (const r of rows) {
    roles.add(r.role_name);
    if (r.permission) permissions.add(r.permission);
    if (r.category_scope == null) unrestricted = true;
    else r.category_scope.forEach((c) => scopes.add(c));
  }
  return { roles: [...roles].sort(), permissions, categoryScopes: unrestricted ? null : [...scopes].sort() };
}

export async function resolvePermissions(db: Queryable, userId: string): Promise<Resolved> {
  const r = await db.query<RoleRow>(
    `select r.name as role_name, rp.permission, ur.category_scope
       from user_roles ur
       join roles r on r.id = ur.role_id
       left join role_permissions rp on rp.role_id = r.id
      where ur.user_id = $1
      order by r.name, rp.permission`,
    [userId],
  );
  return mergeRoleRows(r.rows);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wecom/api test -- test/unit/permissions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/permissions.ts apps/api/test/unit/permissions.test.ts
git commit -m "feat(api): permission resolution from roles and category scopes"
```

---

### Task 3: Test helpers — Postgres container, seed users, OIDC mock issuer, Palo Alto stub

**Files:**
- Create: `apps/api/test/helpers/db.ts`, `apps/api/test/helpers/oidc.ts`, `apps/api/test/helpers/paloalto.ts`
- Test: `apps/api/test/int/helpers.test.ts`

**Interfaces:**
- Produces:
  - `startTestDb(): Promise<{ pool: pg.Pool; url: string; stop(): Promise<void> }>` — starts `pgvector/pgvector:pg16`, runs migrations up.
  - `seedUser(pool, { email, displayName, source?, roles?: string[], categoryScope?: string[] | null, subject? }): Promise<string>` (returns user id; roles by name).
  - `startOidcMock(port = 8085): Promise<{ issuer: string; stop(): Promise<void>; setUser(claims: Record<string, unknown>): void }>` using `oauth2-mock-server` with `beforeTokenSigning` injecting `sub, email, name, groups`.
  - `startPaloAltoStub(port = 8086): Promise<{ url: string; setMapping(ip: string, user: string | null): void; stop(): Promise<void>; calls: string[] }>` returning the firewall's XML format.

- [ ] **Step 1: Write the failing test**

`apps/api/test/int/helpers.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, seedUser } from '../helpers/db.js';
import { startOidcMock } from '../helpers/oidc.js';
import { startPaloAltoStub } from '../helpers/paloalto.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
run('test helpers', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => { db = await startTestDb(); }, 120000);
  afterAll(async () => { await db.stop(); });

  it('seeds a user with roles', async () => {
    const id = await seedUser(db.pool, { email: 'a@wecom.co.il', displayName: 'ענבר ל.', roles: ['editor'], categoryScope: ['intl'] });
    const r = await db.pool.query('select r.name, ur.category_scope from user_roles ur join roles r on r.id=ur.role_id where ur.user_id=$1', [id]);
    expect(r.rows).toEqual([{ name: 'editor', category_scope: ['intl'] }]);
  });
  it('serves an OIDC discovery document', async () => {
    const m = await startOidcMock(8085);
    const res = await fetch(m.issuer + '/.well-known/openid-configuration');
    expect((await res.json()).authorization_endpoint).toContain('/authorize');
    await m.stop();
  });
  it('answers the Palo Alto ip-user-mapping query', async () => {
    const s = await startPaloAltoStub(8086);
    s.setMapping('10.1.2.3', 'WECOM\\inbar');
    const res = await fetch(s.url + '/api/?type=op&key=k&cmd=' + encodeURIComponent('<show><user><ip-user-mapping><ip>10.1.2.3</ip></ip-user-mapping></user></show>'));
    expect(await res.text()).toContain('<user>WECOM\\inbar</user>');
    await s.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `RUN_INTEGRATION=1 pnpm --filter @wecom/api test -- test/int/helpers.test.ts`
Expected: FAIL (helpers missing).

- [ ] **Step 3: Write the helpers**

`apps/api/test/helpers/db.ts`:
```ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runner } from 'node-pg-migrate';

export async function startTestDb() {
  const c = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
  const url = c.getConnectionUri();
  await runner({ databaseUrl: url, dir: 'migrations', direction: 'up', migrationsTable: 'pgmigrations', log: () => undefined });
  const pool = new pg.Pool({ connectionString: url });
  return { pool, url, stop: async () => { await pool.end(); await c.stop(); } };
}

export async function seedUser(pool: pg.Pool, u: { email: string; displayName: string; source?: 'entra' | 'paloalto' | 'local'; subject?: string; roles?: string[]; categoryScope?: string[] | null; passwordHash?: string | null; active?: boolean }): Promise<string> {
  const source = u.source ?? 'entra';
  const r = await pool.query<{ id: string }>(
    `insert into users(subject, source, email, display_name, initials, active, password_hash) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [u.subject ?? 'sub-' + u.email, source, u.email, u.displayName, u.displayName.slice(0, 1), u.active ?? true, u.passwordHash ?? null],
  );
  const id = r.rows[0].id;
  for (const role of u.roles ?? []) {
    await pool.query(`insert into user_roles(user_id, role_id, category_scope) select $1, id, $3 from roles where name=$2`, [id, role, u.categoryScope ?? null]);
  }
  return id;
}

export async function createSession(pool: pg.Pool, userId: string, tokenHash: string, expiresAt = new Date(Date.now() + 3600e3)) {
  const r = await pool.query<{ id: string }>(`insert into sessions(user_id, token_hash, expires_at) values ($1,$2,$3) returning id`, [userId, tokenHash, expiresAt]);
  return r.rows[0].id;
}
```

`apps/api/test/helpers/oidc.ts`:
```ts
import { OAuth2Server } from 'oauth2-mock-server';

export async function startOidcMock(port = 8085) {
  const server = new OAuth2Server();
  await server.issuer.keys.generate('RS256');
  let claims: Record<string, unknown> = { sub: 'entra-sub-1', email: 'inbar@wecom.co.il', name: 'ענבר ל.', groups: ['grp-editors'] };
  server.service.on('beforeTokenSigning', (token) => { Object.assign(token.payload, claims); });
  server.service.on('beforeUserinfo', (userInfoResponse) => { Object.assign(userInfoResponse.body, claims); });
  await server.start(port, 'localhost');
  return {
    issuer: `http://localhost:${port}`,
    setUser: (c: Record<string, unknown>) => { claims = c; },
    stop: () => server.stop(),
  };
}
```

`apps/api/test/helpers/paloalto.ts`:
```ts
import http from 'node:http';

export async function startPaloAltoStub(port = 8086) {
  const mapping = new Map<string, string | null>();
  const calls: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    calls.push(url.search);
    const m = /<ip>([^<]+)<\/ip>/.exec(url.searchParams.get('cmd') ?? '');
    const user = m ? mapping.get(m[1]) : undefined;
    res.setHeader('content-type', 'application/xml');
    if (url.searchParams.get('key') !== 'k') { res.statusCode = 403; res.end('<response status="error"><msg>Invalid credentials</msg></response>'); return; }
    if (!user) { res.end('<response status="success"><result><entry></entry></result></response>'); return; }
    res.end(`<response status="success"><result><entry><ip>${m![1]}</ip><vsys>vsys1</vsys><type>GP</type><user>${user}</user><idle_timeout>3600</idle_timeout></entry></result></response>`);
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    setMapping: (ip: string, user: string | null) => { mapping.set(ip, user); },
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `RUN_INTEGRATION=1 pnpm --filter @wecom/api test -- test/int/helpers.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/helpers apps/api/test/int/helpers.test.ts
git commit -m "test(api): db, oidc mock and palo alto stub helpers"
```

---

### Task 4: Auth plugin — session lookup, `req.user`, cache, enforcement hook

**Files:**
- Create: `apps/api/src/plugins/auth.ts`, `apps/api/src/modules/auth/session-store.ts`
- Modify: `apps/api/src/app.ts` (register plugin after `dbPlugin`)
- Test: `apps/api/test/unit/scope.test.ts`, `apps/api/test/int/enforcement.test.ts`

**Interfaces:**
- Produces:
  - `declare module 'fastify' { interface FastifyRequest { user: AuthUser | null } interface FastifyContextConfig { requires?: Permission[]; scope?: 'document'; public?: boolean } }`
  - `SessionStore` (class, ctor `(db: pg.Pool)`): `create(userId, ip, ua): Promise<{ token: string; id: string }>`, `find(token): Promise<{ id: string; userId: string; lastSeenAt: Date; expiresAt: Date } | null>` (excludes revoked/expired), `touch(id)`, `revoke(id)`, `revokeAllForUser(userId)`.
  - `checkScope(user: AuthUser, category: string): boolean` (pure).
  - `app.authCache.invalidate(userId)` — clears cached resolutions for a user (used by admin role changes and identity sync).
  - The hook: 401 when route not `public` and no user; 403 `FORBIDDEN` when any `requires` permission is missing; for `scope: 'document'`, reads `req.params.id` (document id) → `select category from documents where id=$1 and deleted_at is null`, 404 if missing, 403 `SCOPE_DENIED` if `checkScope` fails.

- [ ] **Step 1: Write the failing unit test**

`apps/api/test/unit/scope.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { checkScope } from '../../src/plugins/auth.js';

const u = (scopes: string[] | null) => ({ id: 'u', roles: [], permissions: new Set<string>(), categoryScopes: scopes, sessionId: null });
describe('checkScope', () => {
  it('allows everything when unscoped', () => { expect(checkScope(u(null), 'intl')).toBe(true); });
  it('allows listed categories only', () => {
    expect(checkScope(u(['intl', 'tech']), 'intl')).toBe(true);
    expect(checkScope(u(['intl']), 'billing')).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing integration test**

`apps/api/test/int/enforcement.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { startTestDb, seedUser, createSession } from '../helpers/db.js';
import { hashToken, SESSION_COOKIE } from '../../src/lib/session.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
run('enforcement hook', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>; let app: Awaited<ReturnType<typeof buildApp>>;
  let leadIntlCookie: string; let agentCookie: string; let docId: string;
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ config: { DATABASE_URL: db.url, NODE_ENV: 'test' }, pool: db.pool });
    // test-only routes exercising the hook
    app.get('/api/v1/_t/public', { config: { public: true } }, async () => ({ ok: true }));
    app.get('/api/v1/_t/read', { config: { requires: ['docs.read'] } }, async (req) => ({ user: req.user?.id }));
    app.post('/api/v1/_t/documents/:id/publish', { config: { requires: ['docs.publish'], scope: 'document' } }, async () => ({ ok: true }));
    await app.ready();
    const lead = await seedUser(db.pool, { email: 'lead@wecom.co.il', displayName: 'אלון ר.', roles: ['lead'], categoryScope: ['intl'] });
    const agent = await seedUser(db.pool, { email: 'agent@wecom.co.il', displayName: 'דנה ר.', roles: ['agent'] });
    const t1 = 'tok-lead'; await createSession(db.pool, lead, hashToken(t1)); leadIntlCookie = `${SESSION_COOKIE}=${t1}`;
    const t2 = 'tok-agent'; await createSession(db.pool, agent, hashToken(t2)); agentCookie = `${SESSION_COOKIE}=${t2}`;
    const d = await db.pool.query<{ id: string }>(`insert into documents(slug,title,category,wave,priority) values ('t-billing','x','billing',1,'m') returning id`);
    docId = d.rows[0].id;
  }, 120000);
  afterAll(async () => { await app.close(); await db.stop(); });

  it('public routes need no session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/_t/public' })).statusCode).toBe(200);
  });
  it('rejects missing session with 401 and the envelope', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/_t/read' });
    expect(r.statusCode).toBe(401); expect(r.json().code).toBe('UNAUTHENTICATED');
  });
  it('rejects a revoked session', async () => {
    await db.pool.query(`update sessions set revoked_at=now() where token_hash=$1`, [hashToken('tok-agent')]);
    const r = await app.inject({ method: 'GET', url: '/api/v1/_t/read', headers: { cookie: agentCookie } });
    expect(r.statusCode).toBe(401);
    await db.pool.query(`update sessions set revoked_at=null where token_hash=$1`, [hashToken('tok-agent')]);
  });
  it('allows a permitted user and exposes req.user', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/_t/read', headers: { cookie: agentCookie } });
    expect(r.statusCode).toBe(200); expect(r.json().user).toBeTruthy();
  });
  it('denies missing permission with FORBIDDEN', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/_t/documents/${docId}/publish`, headers: { cookie: agentCookie } });
    expect(r.statusCode).toBe(403); expect(r.json().code).toBe('FORBIDDEN'); expect(r.json().details).toEqual({ permission: 'docs.publish' });
  });
  it('denies out-of-scope category with SCOPE_DENIED', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/_t/documents/${docId}/publish`, headers: { cookie: leadIntlCookie } });
    expect(r.statusCode).toBe(403); expect(r.json().code).toBe('SCOPE_DENIED');
  });
  it('404s scope checks for unknown documents', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/_t/documents/00000000-0000-4000-8000-000000000000/publish`, headers: { cookie: leadIntlCookie } });
    expect(r.statusCode).toBe(404);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `RUN_INTEGRATION=1 pnpm --filter @wecom/api test -- test/unit/scope.test.ts test/int/enforcement.test.ts`
Expected: FAIL (plugin missing).

- [ ] **Step 4: Write the implementation**

`apps/api/src/modules/auth/session-store.ts`:
```ts
import type pg from 'pg';
import { hashToken, newSessionToken, SESSION_TTL_MS } from '../../lib/session.js';

export type SessionRow = { id: string; userId: string; lastSeenAt: Date; expiresAt: Date };

export class SessionStore {
  constructor(private db: pg.Pool) {}
  async create(userId: string, ip: string | null, userAgent: string | null): Promise<{ token: string; id: string }> {
    const token = newSessionToken();
    const r = await this.db.query<{ id: string }>(
      `insert into sessions(user_id, token_hash, ip, user_agent, expires_at) values ($1,$2,$3,$4,$5) returning id`,
      [userId, hashToken(token), ip, userAgent, new Date(Date.now() + SESSION_TTL_MS)],
    );
    return { token, id: r.rows[0].id };
  }
  async find(token: string): Promise<SessionRow | null> {
    const r = await this.db.query<{ id: string; user_id: string; last_seen_at: Date; expires_at: Date }>(
      `select s.id, s.user_id, s.last_seen_at, s.expires_at from sessions s join users u on u.id = s.user_id
        where s.token_hash=$1 and s.revoked_at is null and s.expires_at > now() and u.active`,
      [hashToken(token)],
    );
    const s = r.rows[0];
    return s ? { id: s.id, userId: s.user_id, lastSeenAt: s.last_seen_at, expiresAt: s.expires_at } : null;
  }
  async touch(id: string): Promise<void> {
    await this.db.query(`update sessions set last_seen_at=now(), expires_at=$2 where id=$1`, [id, new Date(Date.now() + SESSION_TTL_MS)]);
  }
  async revoke(id: string): Promise<void> { await this.db.query(`update sessions set revoked_at=now() where id=$1 and revoked_at is null`, [id]); }
  async revokeAllForUser(userId: string): Promise<number> {
    const r = await this.db.query(`update sessions set revoked_at=now() where user_id=$1 and revoked_at is null`, [userId]);
    return r.rowCount ?? 0;
  }
}
```

`apps/api/src/plugins/auth.ts`:
```ts
import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Permission } from '@wecom/shared';
import { SESSION_COOKIE, cookieOptions, shouldSlide } from '../lib/session.js';
import { HttpError, unauthenticated, forbidden } from '../lib/errors.js';
import { resolvePermissions, type AuthUser } from '../modules/auth/permissions.js';
import { SessionStore } from '../modules/auth/session-store.js';

declare module 'fastify' {
  interface FastifyRequest { user: AuthUser | null }
  interface FastifyContextConfig { requires?: Permission[]; scope?: 'document'; public?: boolean }
  interface FastifyInstance { sessions: SessionStore; authCache: { invalidate(userId: string): void; clear(): void }; fallbackIdentify?: (req: FastifyRequest, reply: FastifyReply) => Promise<AuthUser | null> }
}

const CACHE_TTL_MS = 60_000;

export function checkScope(user: AuthUser, category: string): boolean {
  return user.categoryScopes == null || user.categoryScopes.includes(category);
}

export default fp(async (app) => {
  const sessions = new SessionStore(app.db);
  const cache = new Map<string, { at: number; value: AuthUser }>(); // key: sessionId
  const byUser = new Map<string, Set<string>>();
  app.decorate('sessions', sessions);
  app.decorate('authCache', {
    invalidate(userId: string) { for (const sid of byUser.get(userId) ?? []) cache.delete(sid); byUser.delete(userId); },
    clear() { cache.clear(); byUser.clear(); },
  });
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const s = await sessions.find(token);
      if (s) {
        const hit = cache.get(s.id);
        if (hit && Date.now() - hit.at < CACHE_TTL_MS) req.user = hit.value;
        else {
          const resolved = await resolvePermissions(app.db, s.userId);
          req.user = { id: s.userId, sessionId: s.id, ...resolved };
          cache.set(s.id, { at: Date.now(), value: req.user });
          if (!byUser.has(s.userId)) byUser.set(s.userId, new Set());
          byUser.get(s.userId)!.add(s.id);
        }
        if (shouldSlide(s.lastSeenAt, new Date())) { await sessions.touch(s.id); reply.setCookie(SESSION_COOKIE, token, cookieOptions(app.config.NODE_ENV)); }
      }
    }
    if (!req.user && app.fallbackIdentify) req.user = await app.fallbackIdentify(req, reply);
  });

  app.addHook('preHandler', async (req) => {
    const cfg = req.routeOptions.config;
    if (cfg.public) return;
    if (!req.user) throw unauthenticated();
    for (const p of cfg.requires ?? []) if (!req.user.permissions.has(p)) throw forbidden(p);
    if (cfg.scope === 'document') {
      const id = (req.params as { id?: string }).id;
      const r = await app.db.query<{ category: string }>(`select category from documents where id=$1 and deleted_at is null`, [id]);
      if (!r.rows[0]) throw new HttpError(404, 'NOT_FOUND', 'המסמך לא נמצא');
      if (!checkScope(req.user, r.rows[0].category)) throw new HttpError(403, 'SCOPE_DENIED', 'ההרשאה שלך מוגבלת לקטגוריות אחרות', { category: r.rows[0].category, scopes: req.user.categoryScopes });
    }
  });
});
```

Modify `apps/api/src/app.ts`: after `await app.register(dbPlugin, ...)` add `import authPlugin from './plugins/auth.js';` and `await app.register(authPlugin);`. Make the existing health route public: in `routes/health.ts` add `config: { public: true }` to the route options. Also make the swagger route `/api/docs/json` `config: { public: true }`.

Also update the error handler in `app.ts` so `HttpError.code` and `details` flow through: it already reads `err.code`/`statusCode`; change the `details` line to `details: status === 400 ? (err as { validation?: unknown }).validation : (err as { details?: unknown }).details`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `RUN_INTEGRATION=1 pnpm --filter @wecom/api test -- test/unit/scope.test.ts test/int/enforcement.test.ts test/health.test.ts`
Expected: PASS (health still 200 because it is public).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/plugins/auth.ts apps/api/src/modules/auth/session-store.ts apps/api/src/app.ts apps/api/src/routes/health.ts apps/api/test
git commit -m "feat(api): auth plugin with sessions, permission and category-scope enforcement"
```

---

### Task 5: IdentityService — upsert users, apply group mapping, deactivate

**Files:**
- Create: `apps/api/src/modules/auth/identity.ts`
- Test: `apps/api/test/int/identity.test.ts`

**Interfaces:**
- Produces `class IdentityService` (ctor `(db: pg.Pool, invalidate: (userId: string) => void)`):
  - `upsertUser(input: { subject: string; source: 'entra'|'paloalto'|'local'; email: string | null; displayName: string }): Promise<{ id: string; created: boolean }>` — matches by `(subject, source)`, else by lower(email) when the existing row has the same source or source `paloalto` (so a VPN-identified user later logging in through Entra is merged: the row's `subject`/`source` are upgraded to entra); updates `display_name`, `initials` (first letter), `last_login_at`.
  - `applyGroupMap(userId: string, groupIds: string[]): Promise<{ added: string[]; removed: string[] }>` — mapped roles = roles in `groups_map` for the given group ids; adds missing `user_roles` (granted_by null, category_scope null), removes user_roles whose role appears in `groups_map` at all but not in the user's current groups (manually granted roles that are not in groups_map are untouched).
  - `deactivate(userId: string, actorId: string | null): Promise<void>` — sets `active=false`, revokes sessions, invalidates cache.
  - `initials(name: string): string` exported helper.

- [ ] **Step 1: Write the failing test**

`apps/api/test/int/identity.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, seedUser } from '../helpers/db.js';
import { IdentityService, initials } from '../../src/modules/auth/identity.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
run('IdentityService', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>; let svc: IdentityService; const invalidated: string[] = [];
  beforeAll(async () => { db = await startTestDb(); svc = new IdentityService(db.pool, (id) => invalidated.push(id)); }, 120000);
  afterAll(async () => { await db.stop(); });

  it('computes initials', () => { expect(initials('ענבר ל.')).toBe('ע'); expect(initials('')).toBe('?'); });

  it('creates then updates a user by subject', async () => {
    const a = await svc.upsertUser({ subject: 's1', source: 'entra', email: 'x@wecom.co.il', displayName: 'ענבר ל.' });
    const b = await svc.upsertUser({ subject: 's1', source: 'entra', email: 'x@wecom.co.il', displayName: 'ענבר לוי' });
    expect(a.created).toBe(true); expect(b.created).toBe(false); expect(a.id).toBe(b.id);
    const r = await db.pool.query('select display_name, last_login_at from users where id=$1', [a.id]);
    expect(r.rows[0].display_name).toBe('ענבר לוי'); expect(r.rows[0].last_login_at).not.toBeNull();
  });

  it('merges a paloalto user into an entra login by email', async () => {
    const pa = await seedUser(db.pool, { email: 'merge@wecom.co.il', displayName: 'דנה', source: 'paloalto', subject: 'WECOM\\dana' });
    const e = await svc.upsertUser({ subject: 'entra-dana', source: 'entra', email: 'Merge@wecom.co.il', displayName: 'דנה ר.' });
    expect(e.id).toBe(pa);
    const r = await db.pool.query('select subject, source from users where id=$1', [pa]);
    expect(r.rows[0]).toEqual({ subject: 'entra-dana', source: 'entra' });
  });

  it('applies and removes mapped roles without touching manual roles', async () => {
    const id = await seedUser(db.pool, { email: 'g@wecom.co.il', displayName: 'ג', roles: ['agent'] });
    await db.pool.query(`insert into groups_map(idp_group_id, idp_group_name, role_id) select 'grp-editors','KB-Editors', id from roles where name='editor'`);
    await db.pool.query(`insert into groups_map(idp_group_id, idp_group_name, role_id) select 'grp-leads','KB-Leads', id from roles where name='lead'`);
    const first = await svc.applyGroupMap(id, ['grp-editors']);
    expect(first.added).toEqual(['editor']); expect(first.removed).toEqual([]);
    const second = await svc.applyGroupMap(id, ['grp-leads']);
    expect(second.added).toEqual(['lead']); expect(second.removed).toEqual(['editor']);
    const roles = (await db.pool.query('select r.name from user_roles ur join roles r on r.id=ur.role_id where ur.user_id=$1 order by 1', [id])).rows.map((x) => x.name);
    expect(roles).toEqual(['agent', 'lead']);
    expect(invalidated).toContain(id);
  });

  it('deactivates and revokes', async () => {
    const id = await seedUser(db.pool, { email: 'd@wecom.co.il', displayName: 'ד' });
    await db.pool.query(`insert into sessions(user_id, token_hash, expires_at) values ($1,'h',now()+interval '1 hour')`, [id]);
    await svc.deactivate(id, null);
    const r = await db.pool.query('select u.active, s.revoked_at from users u join sessions s on s.user_id=u.id where u.id=$1', [id]);
    expect(r.rows[0].active).toBe(false); expect(r.rows[0].revoked_at).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `RUN_INTEGRATION=1 pnpm --filter @wecom/api test -- test/int/identity.test.ts` — FAIL.

- [ ] **Step 3: Write the implementation**

`apps/api/src/modules/auth/identity.ts`:
```ts
import type pg from 'pg';

export const initials = (name: string): string => { const t = name.trim(); return t ? t[0] : '?'; };

export type UpsertInput = { subject: string; source: 'entra' | 'paloalto' | 'local'; email: string | null; displayName: string };

export class IdentityService {
  constructor(private db: pg.Pool, private invalidate: (userId: string) => void) {}

  async upsertUser(input: UpsertInput): Promise<{ id: string; created: boolean }> {
    const email = input.email ? input.email.toLowerCase() : null;
    const bySubject = await this.db.query<{ id: string }>(`select id from users where subject=$1 and source=$2`, [input.subject, input.source]);
    let id = bySubject.rows[0]?.id;
    let created = false;
    if (!id && email) {
      // merge: same source, or a VPN-identified (paloalto) row being upgraded to an Entra identity
      const byEmail = await this.db.query<{ id: string }>(
        `select id from users where lower(email)=$1 and (source=$2 or (source='paloalto' and $2='entra')) order by created_at limit 1`, [email, input.source]);
      id = byEmail.rows[0]?.id;
      if (id) await this.db.query(`update users set subject=$2, source=$3 where id=$1`, [id, input.subject, input.source]);
    }
    if (!id) {
      const r = await this.db.query<{ id: string }>(
        `insert into users(subject, source, email, display_name, initials, last_login_at) values ($1,$2,$3,$4,$5,now()) returning id`,
        [input.subject, input.source, email, input.displayName, initials(input.displayName)]);
      id = r.rows[0].id; created = true;
    } else {
      await this.db.query(`update users set email=coalesce($2,email), display_name=$3, initials=$4, last_login_at=now(), updated_at=now() where id=$1`,
        [id, email, input.displayName, initials(input.displayName)]);
    }
    return { id, created };
  }

  async applyGroupMap(userId: string, groupIds: string[]): Promise<{ added: string[]; removed: string[] }> {
    const mapped = await this.db.query<{ role_id: string; name: string }>(`select distinct gm.role_id, r.name from groups_map gm join roles r on r.id=gm.role_id`);
    const wanted = await this.db.query<{ role_id: string; name: string }>(
      `select distinct gm.role_id, r.name from groups_map gm join roles r on r.id=gm.role_id where gm.idp_group_id = any($1::text[])`, [groupIds]);
    const current = await this.db.query<{ role_id: string; name: string }>(`select ur.role_id, r.name from user_roles ur join roles r on r.id=ur.role_id where ur.user_id=$1`, [userId]);
    const wantedIds = new Set(wanted.rows.map((x) => x.role_id));
    const mappedIds = new Set(mapped.rows.map((x) => x.role_id));
    const currentIds = new Set(current.rows.map((x) => x.role_id));
    const added: string[] = []; const removed: string[] = [];
    for (const w of wanted.rows) if (!currentIds.has(w.role_id)) {
      await this.db.query(`insert into user_roles(user_id, role_id) values ($1,$2) on conflict do nothing`, [userId, w.role_id]); added.push(w.name);
    }
    for (const c of current.rows) if (mappedIds.has(c.role_id) && !wantedIds.has(c.role_id)) {
      await this.db.query(`delete from user_roles where user_id=$1 and role_id=$2`, [userId, c.role_id]); removed.push(c.name);
    }
    if (added.length || removed.length) this.invalidate(userId);
    return { added: added.sort(), removed: removed.sort() };
  }

  async deactivate(userId: string, _actorId: string | null): Promise<void> {
    await this.db.query(`update users set active=false, updated_at=now() where id=$1`, [userId]);
    await this.db.query(`update sessions set revoked_at=now() where user_id=$1 and revoked_at is null`, [userId]);
    this.invalidate(userId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes** — Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/identity.ts apps/api/test/int/identity.test.ts
git commit -m "feat(api): identity service (upsert, group mapping, deactivate)"
```

---

### Task 6: Entra ID OIDC client with Graph groups fallback

**Files:**
- Create: `apps/api/src/modules/auth/oidc.ts`
- Test: `apps/api/test/int/oidc-client.test.ts`

**Interfaces:**
- Produces `class OidcProvider` (ctor `(cfg: { issuer: string; clientId: string; clientSecret: string; redirectUri: string; graphUrl?: string })`):
  - `static configured(config: Config): boolean` (all four `OIDC_*` set).
  - `init(): Promise<void>` — discovery via `openid-client` `discovery()`; retries are the caller's job.
  - `startLogin(): Promise<{ url: string; state: string; codeVerifier: string; nonce: string }>` — PKCE S256, scopes `openid profile email`.
  - `finishLogin(currentUrl: URL, expected: { state: string; codeVerifier: string; nonce: string }): Promise<{ subject: string; email: string | null; displayName: string; groups: string[]; groupsOverflow: boolean }>` — from ID-token claims; `groups` from the `groups` claim; `groupsOverflow` true when claim absent and `_claim_names.groups` present (Entra overage) → caller uses `fetchGroupsFromGraph`.
  - `fetchGroupsFromGraph(subject: string): Promise<string[]>` — client-credentials token (`scope=https://graph.microsoft.com/.default`) then `GET {graphUrl}/users/{subject}/memberOf?$select=id&$top=999` following `@odata.nextLink`, returns group ids.
  - `listDisabledUsers(subjects: string[]): Promise<Set<string>>` and `listUserGroups(subject)` — used by the nightly job (same Graph token).

- [ ] **Step 1: Write the failing test**

`apps/api/test/int/oidc-client.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { startOidcMock } from '../helpers/oidc.js';
import { OidcProvider } from '../../src/modules/auth/oidc.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
run('OidcProvider', () => {
  let mock: Awaited<ReturnType<typeof startOidcMock>>; let graph: http.Server; let provider: OidcProvider; const graphCalls: string[] = [];
  beforeAll(async () => {
    mock = await startOidcMock(8087);
    graph = http.createServer((req, res) => { graphCalls.push(req.url ?? ''); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ value: [{ id: 'grp-a' }, { id: 'grp-b' }] })); });
    await new Promise<void>((r) => graph.listen(8088, '127.0.0.1', r));
    provider = new OidcProvider({ issuer: mock.issuer, clientId: 'kb', clientSecret: 'secret', redirectUri: 'http://localhost:3000/api/v1/auth/callback', graphUrl: 'http://127.0.0.1:8088/v1.0' });
    await provider.init();
  }, 60000);
  afterAll(async () => { await mock.stop(); await new Promise<void>((r) => graph.close(() => r())); });

  it('builds a PKCE authorization url', async () => {
    const s = await provider.startLogin();
    const u = new URL(s.url);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')).toBe('openid profile email');
    expect(u.searchParams.get('state')).toBe(s.state);
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/v1/auth/callback');
  });

  it('completes the code flow and reads claims', async () => {
    mock.setUser({ sub: 'entra-1', email: 'inbar@wecom.co.il', name: 'ענבר ל.', groups: ['grp-editors'] });
    const s = await provider.startLogin();
    const authRes = await fetch(s.url, { redirect: 'manual' });
    const location = new URL(authRes.headers.get('location')!);
    const result = await provider.finishLogin(location, { state: s.state, codeVerifier: s.codeVerifier, nonce: s.nonce });
    expect(result).toMatchObject({ subject: 'entra-1', email: 'inbar@wecom.co.il', displayName: 'ענבר ל.', groups: ['grp-editors'], groupsOverflow: false });
  });

  it('flags overage and fetches groups from Graph', async () => {
    mock.setUser({ sub: 'entra-2', email: 'big@wecom.co.il', name: 'ב', _claim_names: { groups: 'src1' } });
    const s = await provider.startLogin();
    const location = new URL((await fetch(s.url, { redirect: 'manual' })).headers.get('location')!);
    const r = await provider.finishLogin(location, { state: s.state, codeVerifier: s.codeVerifier, nonce: s.nonce });
    expect(r.groupsOverflow).toBe(true);
    expect(await provider.fetchGroupsFromGraph('entra-2')).toEqual(['grp-a', 'grp-b']);
    expect(graphCalls[0]).toContain('/users/entra-2/memberOf');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL (module missing).

- [ ] **Step 3: Write the implementation**

`apps/api/src/modules/auth/oidc.ts`:
```ts
import * as client from 'openid-client';
import type { Config } from '../../config.js';

export type OidcConfig = { issuer: string; clientId: string; clientSecret: string; redirectUri: string; graphUrl?: string };
export type LoginStart = { url: string; state: string; codeVerifier: string; nonce: string };
export type LoginResult = { subject: string; email: string | null; displayName: string; groups: string[]; groupsOverflow: boolean };

export class OidcProvider {
  private config!: client.Configuration;
  private graphToken: { value: string; exp: number } | null = null;
  constructor(private cfg: OidcConfig) {}

  static configured(c: Config): boolean { return !!(c.OIDC_ISSUER && c.OIDC_CLIENT_ID && c.OIDC_CLIENT_SECRET && c.OIDC_REDIRECT_URI); }
  static fromConfig(c: Config): OidcProvider { return new OidcProvider({ issuer: c.OIDC_ISSUER!, clientId: c.OIDC_CLIENT_ID!, clientSecret: c.OIDC_CLIENT_SECRET!, redirectUri: c.OIDC_REDIRECT_URI! }); }

  async init(): Promise<void> {
    const options = this.cfg.issuer.startsWith('http://') ? { execute: [client.allowInsecureRequests] } : undefined;
    this.config = await client.discovery(new URL(this.cfg.issuer), this.cfg.clientId, this.cfg.clientSecret, undefined, options);
  }

  async startLogin(): Promise<LoginStart> {
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();
    const url = client.buildAuthorizationUrl(this.config, {
      redirect_uri: this.cfg.redirectUri, scope: 'openid profile email', code_challenge: codeChallenge, code_challenge_method: 'S256', state, nonce,
    });
    return { url: url.href, state, codeVerifier, nonce };
  }

  async finishLogin(currentUrl: URL, expected: { state: string; codeVerifier: string; nonce: string }): Promise<LoginResult> {
    const tokens = await client.authorizationCodeGrant(this.config, currentUrl, { pkceCodeVerifier: expected.codeVerifier, expectedState: expected.state, expectedNonce: expected.nonce, idTokenExpected: true });
    const claims = tokens.claims()!;
    const groups = Array.isArray(claims.groups) ? (claims.groups as string[]) : [];
    const overflow = !Array.isArray(claims.groups) && typeof claims._claim_names === 'object' && claims._claim_names != null && 'groups' in (claims._claim_names as object);
    const email = (claims.email as string | undefined) ?? (claims.preferred_username as string | undefined) ?? null;
    return { subject: claims.sub, email: email ? email.toLowerCase() : null, displayName: (claims.name as string | undefined) ?? email ?? claims.sub, groups, groupsOverflow: overflow };
  }

  private async graphAccessToken(): Promise<string> {
    if (this.graphToken && this.graphToken.exp > Date.now() + 30_000) return this.graphToken.value;
    const t = await client.clientCredentialsGrant(this.config, { scope: 'https://graph.microsoft.com/.default' });
    this.graphToken = { value: t.access_token, exp: Date.now() + (t.expiresIn() ?? 300) * 1000 };
    return t.access_token;
  }

  private async graphGet<T>(path: string): Promise<T> {
    const base = this.cfg.graphUrl ?? 'https://graph.microsoft.com/v1.0';
    const res = await fetch(path.startsWith('http') ? path : base + path, { headers: { authorization: 'Bearer ' + (await this.graphAccessToken()) } });
    if (!res.ok) throw new Error(`graph ${res.status} for ${path}`);
    return (await res.json()) as T;
  }

  async fetchGroupsFromGraph(subject: string): Promise<string[]> {
    const ids: string[] = [];
    let next: string | undefined = `/users/${encodeURIComponent(subject)}/memberOf?$select=id&$top=999`;
    while (next) {
      const page: { value: { id: string }[]; '@odata.nextLink'?: string } = await this.graphGet(next);
      ids.push(...page.value.map((v) => v.id));
      next = page['@odata.nextLink'];
    }
    return ids;
  }
  listUserGroups(subject: string): Promise<string[]> { return this.fetchGroupsFromGraph(subject); }

  async listDisabledUsers(subjects: string[]): Promise<Set<string>> {
    const disabled = new Set<string>();
    for (const s of subjects) {
      try { const u: { accountEnabled?: boolean } = await this.graphGet(`/users/${encodeURIComponent(s)}?$select=id,accountEnabled`); if (u.accountEnabled === false) disabled.add(s); }
      catch (e) { if (String(e).includes('404')) disabled.add(s); }
    }
    return disabled;
  }
}
```

- [ ] **Step 4: Run test to verify it passes** — `RUN_INTEGRATION=1 pnpm --filter @wecom/api test -- test/int/oidc-client.test.ts` — PASS (3 tests). If `oauth2-mock-server` lacks a `nonce` echo, set `idTokenExpected: true` only and drop `expectedNonce` from the test (keep it in production via the `nonce` param); note it in the commit.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/oidc.ts apps/api/test/int/oidc-client.test.ts
git commit -m "feat(api): Entra ID OIDC provider with Graph group overage fallback"
```

---

### Task 7: Palo Alto User-ID fallback

**Files:**
- Create: `apps/api/src/modules/auth/paloalto.ts`
- Test: `apps/api/test/int/auth-paloalto.test.ts` (client part; the request hook is tested in Task 8)

**Interfaces:**
- Produces:
  - `parseSubnets(csv: string): [ipaddr.IPv4 | ipaddr.IPv6, number][]`, `ipInSubnets(ip: string, subnets): boolean`.
  - `parseUserIdXml(xml: string): string | null` — returns `DOMAIN\user` or null.
  - `class PaloAltoClient` (ctor `(host: string, apiKey: string, fetchImpl = fetch)`): `lookup(ip: string): Promise<{ domain: string | null; user: string } | null>` — GET `https://{host}/api/?type=op&key=…&cmd=<show><user><ip-user-mapping><ip>{ip}</ip></ip-user-mapping></user></show>`, 3 s timeout, returns null on any failure (logged by caller).
  - `makeFallbackIdentify(opts: { client: PaloAltoClient; subnets; identity: IdentityService; sessions: SessionStore; env: string; log: FastifyBaseLogger })` → the `fallbackIdentify(req, reply)` function registered on the app: checks `req.ip` ∈ subnets, looks up, `upsertUser({ subject: 'DOMAIN\\user', source: 'paloalto', email: null, displayName: user })`, creates a session + cookie, returns the resolved `AuthUser`. Negative lookups are cached 60 s per IP so the firewall isn't hammered.

- [ ] **Step 1: Write the failing test**

`apps/api/test/int/auth-paloalto.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPaloAltoStub } from '../helpers/paloalto.js';
import { PaloAltoClient, parseSubnets, ipInSubnets, parseUserIdXml } from '../../src/modules/auth/paloalto.js';

describe('paloalto helpers', () => {
  it('parses subnets and checks membership', () => {
    const s = parseSubnets('10.1.0.0/16, 192.168.5.0/24');
    expect(ipInSubnets('10.1.2.3', s)).toBe(true);
    expect(ipInSubnets('10.2.2.3', s)).toBe(false);
    expect(ipInSubnets('::ffff:192.168.5.9', s)).toBe(true);
    expect(ipInSubnets('not-an-ip', s)).toBe(false);
  });
  it('parses the XML answer', () => {
    expect(parseUserIdXml('<response status="success"><result><entry><ip>10.1.2.3</ip><user>WECOM\\inbar</user></entry></result></response>')).toBe('WECOM\\inbar');
    expect(parseUserIdXml('<response status="success"><result><entry></entry></result></response>')).toBeNull();
    expect(parseUserIdXml('garbage')).toBeNull();
  });
});

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
run('PaloAltoClient', () => {
  let stub: Awaited<ReturnType<typeof startPaloAltoStub>>;
  beforeAll(async () => { stub = await startPaloAltoStub(8089); });
  afterAll(async () => { await stub.stop(); });
  it('returns the mapped user', async () => {
    stub.setMapping('10.1.2.3', 'WECOM\\inbar');
    const c = new PaloAltoClient('127.0.0.1:8089', 'k', fetch, 'http');
    expect(await c.lookup('10.1.2.3')).toEqual({ domain: 'WECOM', user: 'inbar' });
    expect(await c.lookup('10.1.2.4')).toBeNull();
  });
  it('returns null on auth failure instead of throwing', async () => {
    const c = new PaloAltoClient('127.0.0.1:8089', 'wrong', fetch, 'http');
    expect(await c.lookup('10.1.2.3')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Write the implementation**

`apps/api/src/modules/auth/paloalto.ts`:
```ts
import ipaddr from 'ipaddr.js';
import { XMLParser } from 'fast-xml-parser';
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import type { IdentityService } from './identity.js';
import type { SessionStore } from './session-store.js';
import { resolvePermissions, type AuthUser } from './permissions.js';
import { SESSION_COOKIE, cookieOptions } from '../../lib/session.js';
import type pg from 'pg';

export type Subnet = [ipaddr.IPv4 | ipaddr.IPv6, number];
export function parseSubnets(csv: string): Subnet[] {
  return csv.split(',').map((s) => s.trim()).filter(Boolean).map((s) => ipaddr.parseCIDR(s) as Subnet);
}
export function ipInSubnets(ip: string, subnets: Subnet[]): boolean {
  if (!ipaddr.isValid(ip)) return false;
  let addr = ipaddr.parse(ip);
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) addr = (addr as ipaddr.IPv6).toIPv4Address();
  return subnets.some(([net, bits]) => net.kind() === addr.kind() && addr.match(net as never, bits));
}

const parser = new XMLParser({ ignoreAttributes: false });
export function parseUserIdXml(xml: string): string | null {
  try {
    const doc = parser.parse(xml) as { response?: { result?: { entry?: { user?: string } | { user?: string }[] } } };
    const entry = doc.response?.result?.entry;
    const e = Array.isArray(entry) ? entry[0] : entry;
    const user = e && typeof e === 'object' ? e.user : undefined;
    return typeof user === 'string' && user.trim() ? user.trim() : null;
  } catch { return null; }
}

export class PaloAltoClient {
  constructor(private host: string, private apiKey: string, private fetchImpl: typeof fetch = fetch, private scheme: 'https' | 'http' = 'https') {}
  async lookup(ip: string): Promise<{ domain: string | null; user: string } | null> {
    const cmd = `<show><user><ip-user-mapping><ip>${ip}</ip></ip-user-mapping></user></show>`;
    const url = `${this.scheme}://${this.host}/api/?type=op&key=${encodeURIComponent(this.apiKey)}&cmd=${encodeURIComponent(cmd)}`;
    try {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return null;
      const raw = parseUserIdXml(await res.text());
      if (!raw) return null;
      const i = raw.indexOf('\\');
      return i >= 0 ? { domain: raw.slice(0, i), user: raw.slice(i + 1) } : { domain: null, user: raw };
    } catch { return null; }
  }
}

export function makeFallbackIdentify(opts: { db: pg.Pool; client: PaloAltoClient; subnets: Subnet[]; identity: IdentityService; sessions: SessionStore; env: string; log: FastifyBaseLogger }) {
  const negative = new Map<string, number>();
  return async (req: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> => {
    const ip = req.ip;
    if (!ipInSubnets(ip, opts.subnets)) return null;
    const until = negative.get(ip); if (until && until > Date.now()) return null;
    const found = await opts.client.lookup(ip);
    if (!found) { negative.set(ip, Date.now() + 60_000); return null; }
    const subject = found.domain ? `${found.domain}\\${found.user}` : found.user;
    const { id } = await opts.identity.upsertUser({ subject, source: 'paloalto', email: null, displayName: found.user });
    const s = await opts.sessions.create(id, ip, req.headers['user-agent'] ?? null);
    reply.setCookie(SESSION_COOKIE, s.token, cookieOptions(opts.env));
    opts.log.info({ ip, subject }, 'paloalto fallback login');
    const resolved = await resolvePermissions(opts.db, id);
    return { id, sessionId: s.id, ...resolved };
  };
}
```

- [ ] **Step 4: Run test to verify it passes** — `RUN_INTEGRATION=1 pnpm --filter @wecom/api test -- test/int/auth-paloalto.test.ts` — PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/paloalto.ts apps/api/test/int/auth-paloalto.test.ts
git commit -m "feat(api): Palo Alto User-ID fallback client"
```

---

### Task 8: Auth routes (providers, login, callback, logout, me, local) + rate limit + fallback wiring

**Files:**
- Create: `apps/api/src/modules/auth/local.ts`, `apps/api/src/modules/auth/routes.ts`, `apps/api/src/modules/auth/index.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/int/auth-oidc.test.ts`, `apps/api/test/int/auth-local-session.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword(pw): Promise<string>`, `verifyPassword(hash, pw): Promise<boolean>` (argon2id).
  - Routes under `/api/v1/auth`:
    - `GET /providers` (public) → `{ providers: ('entra'|'local')[]; fallback: 'none'|'paloalto' }`.
    - `GET /login?returnTo=/path` (public) → 302 to Entra; stores `{ state, codeVerifier, nonce, returnTo }` in a signed, httpOnly cookie `kb_oidc` (10 min, `SameSite=Lax`). 503 `PROVIDER_UNAVAILABLE` when OIDC isn't configured or discovery failed.
    - `GET /callback` (public) → verifies, `upsertUser`, groups (claim or Graph), `applyGroupMap`, creates session, sets `kb_session`, clears `kb_oidc`, 302 to `PUBLIC_URL + returnTo` (only relative paths allowed, default `/`). Audit action `auth.login`.
    - `POST /logout` → revokes current session, clears cookie, audit `auth.logout`, `{ ok: true }`.
    - `GET /me` → `MeSchema` (user row, roles, permissions, categoryScopes, preferences from `user_preferences.prefs` parsed with `PreferencesSchema`).
    - `POST /local` (public; body `{ email, password }`) → argon2 verify against `users.password_hash` where `source='local' and active`, else 401 `INVALID_CREDENTIALS`; audit `auth.login.local`.
  - `app.identity: IdentityService`, `app.oidc: OidcProvider | null` decorators.
  - `authModule(app, deps)` registered in `app.ts`; `@fastify/rate-limit` registered globally with `global: false`, applied on auth routes via `config.rateLimit`.

- [ ] **Step 1: Write the failing OIDC round-trip test**

`apps/api/test/int/auth-oidc.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { startTestDb } from '../helpers/db.js';
import { startOidcMock } from '../helpers/oidc.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
const cookiesOf = (res: { cookies: { name: string; value: string }[] }) => res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');

run('OIDC login round-trip', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>; let mock: Awaited<ReturnType<typeof startOidcMock>>; let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    db = await startTestDb(); mock = await startOidcMock(8090);
    await db.pool.query(`insert into groups_map(idp_group_id, idp_group_name, role_id) select 'grp-editors','KB-Editors', id from roles where name='editor'`);
    app = await buildApp({ pool: db.pool, config: { DATABASE_URL: db.url, NODE_ENV: 'test', PUBLIC_URL: 'http://localhost:5173', OIDC_ISSUER: mock.issuer, OIDC_CLIENT_ID: 'kb', OIDC_CLIENT_SECRET: 'secret', OIDC_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/callback' } });
    await app.ready();
  }, 120000);
  afterAll(async () => { await app.close(); await mock.stop(); await db.stop(); });

  it('lists providers', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/auth/providers' });
    expect(r.json()).toEqual({ providers: ['entra', 'local'], fallback: 'none' });
  });

  it('logs in, maps groups to roles, and serves /me', async () => {
    mock.setUser({ sub: 'entra-1', email: 'inbar@wecom.co.il', name: 'ענבר ל.', groups: ['grp-editors'] });
    const login = await app.inject({ method: 'GET', url: '/api/v1/auth/login?returnTo=/doc/browsing' });
    expect(login.statusCode).toBe(302);
    const oidcCookie = cookiesOf(login);
    const authorize = await fetch(login.headers.location as string, { redirect: 'manual' });
    const cb = new URL(authorize.headers.get('location')!);
    const callback = await app.inject({ method: 'GET', url: '/api/v1/auth/callback' + cb.search, headers: { cookie: oidcCookie } });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('http://localhost:5173/doc/browsing');
    const session = callback.cookies.find((c) => c.name === 'kb_session')!;
    expect(session.httpOnly).toBe(true); expect(session.sameSite?.toLowerCase()).toBe('lax');
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: `kb_session=${session.value}` } });
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(body.user).toMatchObject({ email: 'inbar@wecom.co.il', displayName: 'ענבר ל.', source: 'entra', initials: 'ע' });
    expect(body.roles).toEqual(['editor']);
    expect(body.permissions).toContain('docs.edit'); expect(body.permissions).not.toContain('docs.publish');
    expect(body.preferences.font).toBe('plex');
    const audit = await db.pool.query(`select action from audit_log order by at desc limit 1`);
    expect(audit.rows[0].action).toBe('auth.login');
    const out = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: `kb_session=${session.value}` } });
    expect(out.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: `kb_session=${session.value}` } })).statusCode).toBe(401);
  });

  it('rejects a callback with a mismatched state', async () => {
    const login = await app.inject({ method: 'GET', url: '/api/v1/auth/login' });
    const r = await app.inject({ method: 'GET', url: '/api/v1/auth/callback?code=x&state=wrong', headers: { cookie: cookiesOf(login) } });
    expect(r.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Write the failing local-login / session test**

`apps/api/test/int/auth-local-session.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { startTestDb, seedUser } from '../helpers/db.js';
import { hashPassword } from '../../src/modules/auth/local.js';
import { startPaloAltoStub } from '../helpers/paloalto.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
run('local login, sessions, palo alto fallback', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>; let app: Awaited<ReturnType<typeof buildApp>>; let stub: Awaited<ReturnType<typeof startPaloAltoStub>>;
  beforeAll(async () => {
    db = await startTestDb(); stub = await startPaloAltoStub(8091); stub.setMapping('10.1.2.3', 'WECOM\\dana');
    await seedUser(db.pool, { email: 'admin@wecom.co.il', displayName: 'Admin', source: 'local', subject: 'admin@wecom.co.il', roles: ['admin'], passwordHash: await hashPassword('Str0ng-pass!') });
    app = await buildApp({ pool: db.pool, config: { DATABASE_URL: db.url, NODE_ENV: 'test', AUTH_FALLBACK: 'paloalto', PALOALTO_HOST: '127.0.0.1:8091', PALOALTO_API_KEY: 'k', PALOALTO_SUBNETS: '10.1.0.0/16', PALOALTO_SCHEME: 'http' } });
    await app.ready();
  }, 120000);
  afterAll(async () => { await app.close(); await stub.stop(); await db.stop(); });

  it('logs in a local break-glass admin', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/local', payload: { email: 'admin@wecom.co.il', password: 'Str0ng-pass!' } });
    expect(r.statusCode).toBe(200);
    const s = r.cookies.find((c) => c.name === 'kb_session')!;
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: `kb_session=${s.value}` } });
    expect(me.json().roles).toEqual(['admin']);
  });
  it('rejects wrong password with INVALID_CREDENTIALS', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/local', payload: { email: 'admin@wecom.co.il', password: 'nope' } });
    expect(r.statusCode).toBe(401); expect(r.json().code).toBe('INVALID_CREDENTIALS');
  });
  it('rate-limits local login', async () => {
    let last = 0;
    for (let i = 0; i < 7; i++) last = (await app.inject({ method: 'POST', url: '/api/v1/auth/local', payload: { email: 'x@y.z', password: 'p' }, remoteAddress: '203.0.113.9' })).statusCode;
    expect(last).toBe(429);
  });
  it('identifies a LAN user through the Palo Alto fallback and creates a session', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', remoteAddress: '10.1.2.3' });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ source: 'paloalto', subject: 'WECOM\\dana', displayName: 'dana' });
    expect(me.cookies.find((c) => c.name === 'kb_session')).toBeTruthy();
    expect(me.json().roles).toEqual([]);
  });
  it('does not consult the firewall outside the allowed subnets', async () => {
    const before = stub.calls.length;
    const r = await app.inject({ method: 'GET', url: '/api/v1/auth/me', remoteAddress: '172.16.0.5' });
    expect(r.statusCode).toBe(401); expect(stub.calls.length).toBe(before);
  });
});
```

Add `PALOALTO_SCHEME: z.enum(['https', 'http']).default('https')` to `ConfigSchema` in `apps/api/src/config.ts` (test-only override; production stays https).

- [ ] **Step 3: Run tests to verify they fail** — FAIL (routes missing).

- [ ] **Step 4: Write the implementation**

`apps/api/src/modules/auth/local.ts`:
```ts
import argon2 from 'argon2';
export const hashPassword = (pw: string): Promise<string> => argon2.hash(pw, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = async (hash: string | null, pw: string): Promise<boolean> => { if (!hash) return false; try { return await argon2.verify(hash, pw); } catch { return false; } };
```

`apps/api/src/modules/auth/routes.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MeSchema, PreferencesSchema } from '@wecom/shared';
import { HttpError } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { SESSION_COOKIE, cookieOptions } from '../../lib/session.js';
import { verifyPassword } from './local.js';
import { resolvePermissions } from './permissions.js';

const OIDC_COOKIE = 'kb_oidc';
const safeReturnTo = (v: unknown): string => (typeof v === 'string' && /^\/(?!\/)/.test(v) ? v : '/');

export default async function authRoutes(app: FastifyInstance) {
  const env = app.config.NODE_ENV;

  app.get('/providers', { config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['auth'], response: { 200: z.object({ providers: z.array(z.enum(['entra', 'local'])), fallback: z.enum(['none', 'paloalto']) }) } } }, async () => ({
    providers: [...(app.oidc ? ['entra' as const] : []), 'local' as const], fallback: app.config.AUTH_FALLBACK,
  }));

  app.get('/login', { config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['auth'], querystring: z.object({ returnTo: z.string().optional() }), hide: false } }, async (req, reply) => {
    if (!app.oidc) throw new HttpError(503, 'PROVIDER_UNAVAILABLE', 'כניסה עם חשבון Microsoft אינה מוגדרת');
    const start = await app.oidc.startLogin();
    reply.setCookie(OIDC_COOKIE, JSON.stringify({ state: start.state, codeVerifier: start.codeVerifier, nonce: start.nonce, returnTo: safeReturnTo(req.query.returnTo) }), { ...cookieOptions(env), maxAge: 600, signed: true });
    return reply.redirect(start.url, 302);
  });

  app.get('/callback', { config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['auth'], hide: true } }, async (req, reply) => {
    if (!app.oidc) throw new HttpError(503, 'PROVIDER_UNAVAILABLE', 'כניסה עם חשבון Microsoft אינה מוגדרת');
    const raw = req.cookies[OIDC_COOKIE]; const unsigned = raw ? req.unsignCookie(raw) : null;
    if (!unsigned || !unsigned.valid) throw new HttpError(401, 'UNAUTHENTICATED', 'תהליך הכניסה פג תוקף, נסה שוב');
    const st = JSON.parse(unsigned.value) as { state: string; codeVerifier: string; nonce: string; returnTo: string };
    const current = new URL(req.url, app.config.OIDC_REDIRECT_URI);
    current.search = new URL(req.url, 'http://x').search;
    let result;
    try { result = await app.oidc.finishLogin(current, st); }
    catch (e) { req.log.warn({ err: e }, 'oidc callback failed'); throw new HttpError(401, 'UNAUTHENTICATED', 'הכניסה נכשלה, נסה שוב'); }
    const groups = result.groupsOverflow ? await app.oidc.fetchGroupsFromGraph(result.subject) : result.groups;
    const { id } = await app.identity.upsertUser({ subject: result.subject, source: 'entra', email: result.email, displayName: result.displayName });
    const changes = await app.identity.applyGroupMap(id, groups);
    const s = await app.sessions.create(id, req.ip, req.headers['user-agent'] ?? null);
    await audit(app.db, { actorId: id, action: 'auth.login', entityType: 'user', entityId: id, before: null, after: { provider: 'entra', groups: groups.length, roles: changes }, requestId: req.id, ip: req.ip });
    reply.setCookie(SESSION_COOKIE, s.token, cookieOptions(env));
    reply.clearCookie(OIDC_COOKIE, { path: '/' });
    return reply.redirect(app.config.PUBLIC_URL.replace(/\/$/, '') + st.returnTo, 302);
  });

  app.post('/local', { config: { public: true, rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { tags: ['auth'], body: z.object({ email: z.string().email(), password: z.string().min(1) }), response: { 200: z.object({ ok: z.literal(true) }) } } }, async (req, reply) => {
    const r = await app.db.query<{ id: string; password_hash: string | null }>(`select id, password_hash from users where lower(email)=$1 and source='local' and active`, [req.body.email.toLowerCase()]);
    const u = r.rows[0];
    if (!u || !(await verifyPassword(u.password_hash, req.body.password))) throw new HttpError(401, 'INVALID_CREDENTIALS', 'אימייל או סיסמה שגויים');
    await app.db.query(`update users set last_login_at=now() where id=$1`, [u.id]);
    const s = await app.sessions.create(u.id, req.ip, req.headers['user-agent'] ?? null);
    await audit(app.db, { actorId: u.id, action: 'auth.login.local', entityType: 'user', entityId: u.id, before: null, after: null, requestId: req.id, ip: req.ip });
    reply.setCookie(SESSION_COOKIE, s.token, cookieOptions(env));
    return { ok: true as const };
  });

  app.post('/logout', { schema: { tags: ['auth'], response: { 200: z.object({ ok: z.literal(true) }) } } }, async (req, reply) => {
    if (req.user?.sessionId) await app.sessions.revoke(req.user.sessionId);
    await audit(app.db, { actorId: req.user!.id, action: 'auth.logout', entityType: 'user', entityId: req.user!.id, before: null, after: null, requestId: req.id, ip: req.ip });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true as const };
  });

  app.get('/me', { schema: { tags: ['auth'], response: { 200: MeSchema } } }, async (req) => {
    const u = req.user!;
    const row = (await app.db.query(`select u.id, u.subject, u.source, u.email, u.display_name, u.initials, u.active, u.last_login_at, p.prefs from users u left join user_preferences p on p.user_id=u.id where u.id=$1`, [u.id])).rows[0];
    const resolved = await resolvePermissions(app.db, u.id);
    return MeSchema.parse({
      user: { id: row.id, subject: row.subject, source: row.source, email: row.email, displayName: row.display_name, initials: row.initials, active: row.active, lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null },
      roles: resolved.roles, permissions: [...resolved.permissions], categoryScopes: resolved.categoryScopes, preferences: PreferencesSchema.parse(row.prefs ?? {}),
    });
  });
}
```

`apps/api/src/modules/auth/index.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { IdentityService } from './identity.js';
import { OidcProvider } from './oidc.js';
import { PaloAltoClient, makeFallbackIdentify, parseSubnets } from './paloalto.js';
import authRoutes from './routes.js';

declare module 'fastify' { interface FastifyInstance { identity: IdentityService; oidc: OidcProvider | null } }

export async function registerAuth(app: FastifyInstance) {
  const identity = new IdentityService(app.db, (id) => app.authCache.invalidate(id));
  app.decorate('identity', identity);
  let oidc: OidcProvider | null = null;
  if (OidcProvider.configured(app.config)) {
    oidc = OidcProvider.fromConfig(app.config);
    try { await oidc.init(); } catch (e) { app.log.error({ err: e }, 'OIDC discovery failed; Entra login disabled until restart'); oidc = null; }
  }
  app.decorate('oidc', oidc);
  if (app.config.AUTH_FALLBACK === 'paloalto' && app.config.PALOALTO_HOST && app.config.PALOALTO_API_KEY) {
    app.fallbackIdentify = makeFallbackIdentify({ db: app.db, client: new PaloAltoClient(app.config.PALOALTO_HOST, app.config.PALOALTO_API_KEY, fetch, app.config.PALOALTO_SCHEME), subnets: parseSubnets(app.config.PALOALTO_SUBNETS), identity, sessions: app.sessions, env: app.config.NODE_ENV, log: app.log });
  }
  await app.register(authRoutes, { prefix: '/auth' });
}
```

Modify `apps/api/src/app.ts`:
```ts
import rateLimit from '@fastify/rate-limit';
import { registerAuth } from './modules/auth/index.js';
// after cookie registration:
await app.register(rateLimit, { global: false, errorResponseBuilder: (req, ctx) => ({ code: 'RATE_LIMITED', message: 'יותר מדי ניסיונות, נסה שוב בעוד דקה', details: { retryAfterSec: Math.ceil(ctx.ttl / 1000) }, requestId: req.id }) });
// change the v1 registration to:
await app.register(async (v1) => { await v1.register(health); await registerAuth(v1); }, { prefix: '/api/v1' });
```
Because `registerAuth` decorates the encapsulated `v1` instance, move `app.decorate('identity'|'oidc')` calls to use `app` passed in — `registerAuth(v1)` receives the child; decorate on `v1` is fine as long as admin routes (Task 9) are registered inside the same `v1` context. Keep that convention: all `/api/v1` modules are registered inside the one `v1` callback. Also `declare` `fallbackIdentify` assignment happens on `v1` — the auth plugin's `onRequest` hook reads `app.fallbackIdentify` from its own (root) instance, so instead expose a setter: in `plugins/auth.ts` decorate `app.setFallbackIdentify(fn)` that assigns a module-level variable used by the hook, and call `app.setFallbackIdentify(...)` from `registerAuth`. Update the plugin's interface declaration accordingly (`setFallbackIdentify(fn: FallbackIdentify): void`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `RUN_INTEGRATION=1 pnpm --filter @wecom/api test -- test/int/auth-oidc.test.ts test/int/auth-local-session.test.ts test/int/enforcement.test.ts`
Expected: PASS. Then `pnpm --filter @wecom/api openapi` and commit the regenerated `docs/api/openapi.json`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src apps/api/test docs/api/openapi.json
git commit -m "feat(api): auth routes (Entra OIDC, local break-glass, logout, me), rate limits, Palo Alto fallback wiring"
```

---

### Task 9: Admin routes — users, roles, groups-map, sessions, audit

**Files:**
- Create: `apps/api/src/modules/admin/users.ts`, `roles.ts`, `groups-map.ts`, `sessions.ts`, `audit.ts`, `routes.ts`
- Modify: `apps/api/src/app.ts` (register inside the `v1` callback: `await v1.register(adminRoutes, { prefix: '/admin' })`)
- Test: `apps/api/test/int/admin.test.ts`

**Interfaces:**
- Produces routes (all require permissions as listed; every mutation audited and returns `auditId`):
  - `GET /admin/users?q=&page=&pageSize=` [`users.manage`] → `paginated(UserSchema.extend({ roles: z.array(UserRoleSchema) }))`.
  - `PATCH /admin/users/:id` [`users.manage`] body `AdminUserPatchSchema` → `{ ok: true, auditId }`; `active:false` also revokes sessions; `roles` replaces the full role set (with category scopes); invalidates cache. Actor cannot deactivate themselves (409 `SELF_DEACTIVATE`).
  - `GET /admin/roles` [`roles.manage`] → `{ items: Role[] }` (with permissions); `POST /admin/roles` body `RoleUpsertSchema` → `Role`; `PATCH /admin/roles/:id` body partial `RoleUpsertSchema` → `Role` — for the `admin` role, dropping any `ADMIN_LOCKED` permission → 409 `LOCKED_PERMISSION`; `DELETE /admin/roles/:id` → 409 `SYSTEM_ROLE` for system roles, else deletes (cascade to user_roles) and invalidates all cache.
  - `GET /admin/groups-map` [`roles.manage`] → `{ entries: GroupMap[] }`; `PUT /admin/groups-map` body `GroupMapPutSchema` → replaces the whole table in one transaction.
  - `GET /admin/sessions?userId=` [`users.manage`] → `{ items: SessionSchema[] }` (active only); `DELETE /admin/sessions/:id` → revokes.
  - `GET /admin/audit` [`audit.read`] query `AuditQuerySchema` → `paginated(AuditEntrySchema)` ordered by `at desc`, `actorName` joined from users.

- [ ] **Step 1: Write the failing test**

`apps/api/test/int/admin.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import { startTestDb, seedUser, createSession } from '../helpers/db.js';
import { hashToken } from '../../src/lib/session.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
run('admin routes', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>; let app: Awaited<ReturnType<typeof buildApp>>;
  let adminId: string; let editorId: string; const admin = { cookie: 'kb_session=adm' }; const editor = { cookie: 'kb_session=edt' };
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({ pool: db.pool, config: { DATABASE_URL: db.url, NODE_ENV: 'test' } }); await app.ready();
    adminId = await seedUser(db.pool, { email: 'admin@wecom.co.il', displayName: 'Admin', roles: ['admin'] });
    editorId = await seedUser(db.pool, { email: 'ed@wecom.co.il', displayName: 'ענבר ל.', roles: ['editor'] });
    await createSession(db.pool, adminId, hashToken('adm')); await createSession(db.pool, editorId, hashToken('edt'));
  }, 120000);
  afterAll(async () => { await app.close(); await db.stop(); });

  it('denies non-admins', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: editor });
    expect(r.statusCode).toBe(403); expect(r.json().details.permission).toBe('users.manage');
  });
  it('lists users with roles and searches', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/users?q=ענבר', headers: admin });
    expect(r.statusCode).toBe(200); expect(r.json().total).toBe(1); expect(r.json().items[0].roles[0].roleName).toBe('editor');
  });
  it('replaces roles with a category scope and writes audit', async () => {
    const leadId = (await db.pool.query(`select id from roles where name='lead'`)).rows[0].id;
    const r = await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${editorId}`, headers: admin, payload: { roles: [{ roleId: leadId, categoryScope: ['intl'] }] } });
    expect(r.statusCode).toBe(200); expect(r.json().auditId).toBeTruthy();
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: editor });
    expect(me.json().roles).toEqual(['lead']); expect(me.json().categoryScopes).toEqual(['intl']);
    const a = await db.pool.query(`select action, entity_id from audit_log where action='admin.user.patch'`);
    expect(a.rows[0].entity_id).toBe(editorId);
  });
  it('deactivation revokes sessions and self-deactivation is refused', async () => {
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${adminId}`, headers: admin, payload: { active: false } })).json().code).toBe('SELF_DEACTIVATE');
    await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${editorId}`, headers: admin, payload: { active: false } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: editor })).statusCode).toBe(401);
    await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${editorId}`, headers: admin, payload: { active: true } });
  });
  it('creates, edits and protects roles', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/v1/admin/roles', headers: admin, payload: { name: 'qa', description: 'בקרת איכות', permissions: ['docs.read', 'suggestions.review'] } });
    expect(c.statusCode).toBe(200); expect(c.json().permissions).toEqual(['docs.read', 'suggestions.review']);
    const adminRole = (await db.pool.query(`select id from roles where name='admin'`)).rows[0].id;
    const bad = await app.inject({ method: 'PATCH', url: `/api/v1/admin/roles/${adminRole}`, headers: admin, payload: { permissions: ['docs.read'] } });
    expect(bad.statusCode).toBe(409); expect(bad.json().code).toBe('LOCKED_PERMISSION');
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/admin/roles/${adminRole}`, headers: admin });
    expect(del.json().code).toBe('SYSTEM_ROLE');
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/admin/roles/${c.json().id}`, headers: admin })).statusCode).toBe(200);
  });
  it('replaces the group map', async () => {
    const editorRole = (await db.pool.query(`select id from roles where name='editor'`)).rows[0].id;
    const put = await app.inject({ method: 'PUT', url: '/api/v1/admin/groups-map', headers: admin, payload: { entries: [{ idpGroupId: 'g1', idpGroupName: 'KB-Editors', roleId: editorRole }] } });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/v1/admin/groups-map', headers: admin });
    expect(get.json().entries).toEqual([{ idpGroupId: 'g1', idpGroupName: 'KB-Editors', roleId: editorRole }]);
  });
  it('lists and revokes sessions', async () => {
    const list = await app.inject({ method: 'GET', url: `/api/v1/admin/sessions?userId=${editorId}`, headers: admin });
    expect(list.json().items.length).toBe(1);
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/admin/sessions/${list.json().items[0].id}`, headers: admin });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: editor })).statusCode).toBe(401);
  });
  it('queries the audit log', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/v1/admin/audit?entityType=user&entityId=${editorId}`, headers: admin });
    expect(r.statusCode).toBe(200); expect(r.json().total).toBeGreaterThan(0); expect(r.json().items[0].actorName).toBe('Admin');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL (404s).

- [ ] **Step 3: Write the implementation**

`apps/api/src/modules/admin/users.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AdminUserPatchSchema, PaginationQuerySchema, UserRoleSchema, UserSchema, paginated } from '@wecom/shared';
import { HttpError, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';

const UserWithRoles = UserSchema.extend({ roles: z.array(UserRoleSchema) });
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export default async function userRoutes(app: FastifyInstance) {
  app.get('/users', { config: { requires: ['users.manage'] }, schema: { tags: ['admin'], querystring: PaginationQuerySchema.extend({ q: z.string().optional() }), response: { 200: paginated(UserWithRoles) } } }, async (req) => {
    const { q, page, pageSize } = req.query;
    const where = q ? `where (u.display_name ilike $1 or u.email ilike $1)` : '';
    const params: unknown[] = q ? [`%${q}%`] : [];
    const total = (await app.db.query<{ n: string }>(`select count(*) as n from users u ${where}`, params)).rows[0].n;
    const rows = await app.db.query(`select u.* from users u ${where} order by u.display_name limit ${pageSize} offset ${(page - 1) * pageSize}`, params);
    const ids = rows.rows.map((u) => u.id);
    const roles = await app.db.query(`select ur.user_id, ur.role_id, r.name, ur.category_scope, ur.granted_by, ur.granted_at from user_roles ur join roles r on r.id=ur.role_id where ur.user_id = any($1::uuid[]) order by r.name`, [ids]);
    const items = rows.rows.map((u) => ({
      id: u.id, subject: u.subject, source: u.source, email: u.email, displayName: u.display_name, initials: u.initials, active: u.active, lastLoginAt: iso(u.last_login_at),
      roles: roles.rows.filter((r) => r.user_id === u.id).map((r) => ({ userId: r.user_id, roleId: r.role_id, roleName: r.name, categoryScope: r.category_scope, grantedBy: r.granted_by, grantedAt: new Date(r.granted_at).toISOString() })),
    }));
    return { items, total: Number(total), page, pageSize };
  });

  app.patch('/users/:id', { config: { requires: ['users.manage'] }, schema: { tags: ['admin'], params: z.object({ id: z.string().uuid() }), body: AdminUserPatchSchema, response: { 200: z.object({ ok: z.literal(true), auditId: z.string() }) } } }, async (req) => {
    const { id } = req.params;
    if (req.body.active === false && id === req.user!.id) throw new HttpError(409, 'SELF_DEACTIVATE', 'לא ניתן להשבית את המשתמש שלך');
    const client = await app.db.connect();
    try {
      await client.query('begin');
      const before = (await client.query(`select u.active, (select json_agg(json_build_object('roleId', ur.role_id, 'categoryScope', ur.category_scope)) from user_roles ur where ur.user_id=u.id) as roles from users u where u.id=$1`, [id])).rows[0];
      if (!before) throw notFound('המשתמש');
      if (req.body.active !== undefined) {
        await client.query(`update users set active=$2, updated_at=now() where id=$1`, [id, req.body.active]);
        if (!req.body.active) await client.query(`update sessions set revoked_at=now() where user_id=$1 and revoked_at is null`, [id]);
      }
      if (req.body.roles) {
        await client.query(`delete from user_roles where user_id=$1`, [id]);
        for (const r of req.body.roles) await client.query(`insert into user_roles(user_id, role_id, category_scope, granted_by) values ($1,$2,$3,$4)`, [id, r.roleId, r.categoryScope, req.user!.id]);
      }
      const auditId = await audit(client, { actorId: req.user!.id, action: 'admin.user.patch', entityType: 'user', entityId: id, before, after: req.body, requestId: req.id, ip: req.ip });
      await client.query('commit');
      app.authCache.invalidate(id);
      return { ok: true as const, auditId };
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  });
}
```

`apps/api/src/modules/admin/roles.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADMIN_LOCKED, RoleSchema, RoleUpsertSchema } from '@wecom/shared';
import { HttpError, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';

async function loadRole(app: FastifyInstance, id: string) {
  const r = (await app.db.query(`select r.*, coalesce((select array_agg(permission order by permission) from role_permissions where role_id=r.id), '{}') as permissions from roles r where r.id=$1`, [id])).rows[0];
  if (!r) throw notFound('התפקיד');
  return { id: r.id, name: r.name, description: r.description, system: r.system, permissions: r.permissions as string[] };
}

export default async function roleRoutes(app: FastifyInstance) {
  app.get('/roles', { config: { requires: ['roles.manage'] }, schema: { tags: ['admin'], response: { 200: z.object({ items: z.array(RoleSchema) }) } } }, async () => {
    const r = await app.db.query(`select r.id, r.name, r.description, r.system, coalesce((select array_agg(permission order by permission) from role_permissions where role_id=r.id), '{}') as permissions from roles r order by r.system desc, r.name`);
    return { items: r.rows };
  });

  app.post('/roles', { config: { requires: ['roles.manage'] }, schema: { tags: ['admin'], body: RoleUpsertSchema, response: { 200: RoleSchema.extend({ auditId: z.string() }) } } }, async (req) => {
    const client = await app.db.connect();
    try {
      await client.query('begin');
      const exists = await client.query(`select 1 from roles where name=$1`, [req.body.name]);
      if (exists.rowCount) throw new HttpError(409, 'ROLE_EXISTS', 'תפקיד בשם זה כבר קיים');
      const id = (await client.query<{ id: string }>(`insert into roles(name, description) values ($1,$2) returning id`, [req.body.name, req.body.description])).rows[0].id;
      for (const p of req.body.permissions) await client.query(`insert into role_permissions(role_id, permission) values ($1,$2)`, [id, p]);
      const auditId = await audit(client, { actorId: req.user!.id, action: 'admin.role.create', entityType: 'role', entityId: id, before: null, after: req.body, requestId: req.id, ip: req.ip });
      await client.query('commit');
      return { ...(await loadRole(app, id)), auditId };
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  });

  app.patch('/roles/:id', { config: { requires: ['roles.manage'] }, schema: { tags: ['admin'], params: z.object({ id: z.string().uuid() }), body: RoleUpsertSchema.partial(), response: { 200: RoleSchema.extend({ auditId: z.string() }) } } }, async (req) => {
    const before = await loadRole(app, req.params.id);
    if (before.name === 'admin' && req.body.permissions && ADMIN_LOCKED.some((p) => !req.body.permissions!.includes(p))) throw new HttpError(409, 'LOCKED_PERMISSION', 'תפקיד admin חייב לשמור על roles.manage ו-users.manage');
    if (before.system && req.body.name && req.body.name !== before.name) throw new HttpError(409, 'SYSTEM_ROLE', 'לא ניתן לשנות שם של תפקיד מערכת');
    const client = await app.db.connect();
    try {
      await client.query('begin');
      await client.query(`update roles set name=coalesce($2,name), description=coalesce($3,description) where id=$1`, [before.id, req.body.name ?? null, req.body.description ?? null]);
      if (req.body.permissions) { await client.query(`delete from role_permissions where role_id=$1`, [before.id]); for (const p of req.body.permissions) await client.query(`insert into role_permissions(role_id, permission) values ($1,$2)`, [before.id, p]); }
      const auditId = await audit(client, { actorId: req.user!.id, action: 'admin.role.patch', entityType: 'role', entityId: before.id, before, after: req.body, requestId: req.id, ip: req.ip });
      await client.query('commit');
      app.authCache.clear();
      return { ...(await loadRole(app, before.id)), auditId };
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  });

  app.delete('/roles/:id', { config: { requires: ['roles.manage'] }, schema: { tags: ['admin'], params: z.object({ id: z.string().uuid() }), response: { 200: z.object({ ok: z.literal(true), auditId: z.string() }) } } }, async (req) => {
    const before = await loadRole(app, req.params.id);
    if (before.system) throw new HttpError(409, 'SYSTEM_ROLE', 'לא ניתן למחוק תפקיד מערכת');
    const client = await app.db.connect();
    try {
      await client.query('begin');
      await client.query(`delete from roles where id=$1`, [before.id]);
      const auditId = await audit(client, { actorId: req.user!.id, action: 'admin.role.delete', entityType: 'role', entityId: before.id, before, after: null, requestId: req.id, ip: req.ip });
      await client.query('commit');
      app.authCache.clear();
      return { ok: true as const, auditId };
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  });
}
```

`apps/api/src/modules/admin/groups-map.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GroupMapPutSchema, GroupMapSchema } from '@wecom/shared';
import { audit } from '../../lib/audit.js';

export default async function groupsMapRoutes(app: FastifyInstance) {
  app.get('/groups-map', { config: { requires: ['roles.manage'] }, schema: { tags: ['admin'], response: { 200: z.object({ entries: z.array(GroupMapSchema) }) } } }, async () => {
    const r = await app.db.query(`select idp_group_id, idp_group_name, role_id from groups_map order by idp_group_name`);
    return { entries: r.rows.map((x) => ({ idpGroupId: x.idp_group_id, idpGroupName: x.idp_group_name, roleId: x.role_id })) };
  });
  app.put('/groups-map', { config: { requires: ['roles.manage'] }, schema: { tags: ['admin'], body: GroupMapPutSchema, response: { 200: z.object({ ok: z.literal(true), auditId: z.string() }) } } }, async (req) => {
    const client = await app.db.connect();
    try {
      await client.query('begin');
      const before = (await client.query(`select idp_group_id, idp_group_name, role_id from groups_map`)).rows;
      await client.query(`delete from groups_map`);
      for (const e of req.body.entries) await client.query(`insert into groups_map(idp_group_id, idp_group_name, role_id) values ($1,$2,$3)`, [e.idpGroupId, e.idpGroupName, e.roleId]);
      const auditId = await audit(client, { actorId: req.user!.id, action: 'admin.groups_map.put', entityType: 'groups_map', entityId: null, before, after: req.body.entries, requestId: req.id, ip: req.ip });
      await client.query('commit');
      return { ok: true as const, auditId };
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  });
}
```

`apps/api/src/modules/admin/sessions.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SessionSchema } from '@wecom/shared';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';

export default async function sessionRoutes(app: FastifyInstance) {
  app.get('/sessions', { config: { requires: ['users.manage'] }, schema: { tags: ['admin'], querystring: z.object({ userId: z.string().uuid().optional() }), response: { 200: z.object({ items: z.array(SessionSchema) }) } } }, async (req) => {
    const r = await app.db.query(`select id, user_id, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at from sessions where revoked_at is null and expires_at > now() ${req.query.userId ? 'and user_id=$1' : ''} order by last_seen_at desc limit 500`, req.query.userId ? [req.query.userId] : []);
    return { items: r.rows.map((s) => ({ id: s.id, userId: s.user_id, ip: s.ip, userAgent: s.user_agent, createdAt: new Date(s.created_at).toISOString(), lastSeenAt: new Date(s.last_seen_at).toISOString(), expiresAt: new Date(s.expires_at).toISOString(), revokedAt: null })) };
  });
  app.delete('/sessions/:id', { config: { requires: ['users.manage'] }, schema: { tags: ['admin'], params: z.object({ id: z.string().uuid() }), response: { 200: z.object({ ok: z.literal(true), auditId: z.string() }) } } }, async (req) => {
    const s = (await app.db.query(`select user_id from sessions where id=$1`, [req.params.id])).rows[0];
    if (!s) throw notFound('ההתחברות');
    await app.sessions.revoke(req.params.id);
    app.authCache.invalidate(s.user_id);
    const auditId = await audit(app.db, { actorId: req.user!.id, action: 'admin.session.revoke', entityType: 'session', entityId: req.params.id, before: { userId: s.user_id }, after: null, requestId: req.id, ip: req.ip });
    return { ok: true as const, auditId };
  });
}
```

`apps/api/src/modules/admin/audit.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { AuditEntrySchema, AuditQuerySchema, paginated } from '@wecom/shared';

export default async function auditRoutes(app: FastifyInstance) {
  app.get('/audit', { config: { requires: ['audit.read'] }, schema: { tags: ['admin'], querystring: AuditQuerySchema, response: { 200: paginated(AuditEntrySchema) } } }, async (req) => {
    const q = req.query; const cond: string[] = []; const params: unknown[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); cond.push(sql.replace('?', '$' + params.length)); };
    if (q.actorId) add('a.actor_id = ?', q.actorId); if (q.entityType) add('a.entity_type = ?', q.entityType); if (q.entityId) add('a.entity_id = ?', q.entityId); if (q.from) add('a.at >= ?', q.from); if (q.to) add('a.at <= ?', q.to);
    const where = cond.length ? 'where ' + cond.join(' and ') : '';
    const total = Number((await app.db.query<{ n: string }>(`select count(*) as n from audit_log a ${where}`, params)).rows[0].n);
    const rows = await app.db.query(`select a.*, u.display_name as actor_name from audit_log a left join users u on u.id=a.actor_id ${where} order by a.at desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);
    return { items: rows.rows.map((r) => ({ id: r.id, actorId: r.actor_id, actorName: r.actor_name, action: r.action, entityType: r.entity_type, entityId: r.entity_id, before: r.before, after: r.after, ip: r.ip, requestId: r.request_id, at: new Date(r.at).toISOString() })), total, page: q.page, pageSize: q.pageSize };
  });
}
```

`apps/api/src/modules/admin/routes.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import users from './users.js'; import roles from './roles.js'; import groupsMap from './groups-map.js'; import sessions from './sessions.js'; import auditR from './audit.js';
export default async function adminRoutes(app: FastifyInstance) { await app.register(users); await app.register(roles); await app.register(groupsMap); await app.register(sessions); await app.register(auditR); }
```

In `app.ts` inside the `v1` callback add `await v1.register(adminRoutes, { prefix: '/admin' });` (import from `./modules/admin/routes.js`).

- [ ] **Step 4: Run test to verify it passes** — `RUN_INTEGRATION=1 pnpm --filter @wecom/api test -- test/int/admin.test.ts` — PASS (8 tests). Regenerate `docs/api/openapi.json`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin apps/api/src/app.ts apps/api/test/int/admin.test.ts docs/api/openapi.json
git commit -m "feat(api): admin routes for users, roles, group map, sessions, audit"
```

---

### Task 10: Nightly `identity.sync` job (pg-boss)

**Files:**
- Create: `apps/api/src/jobs/identity-sync.ts`, `apps/api/src/plugins/boss.ts` (if L2 has not created a pg-boss plugin exposing `app.boss: PgBoss`, create it here with that exact decorator name)
- Test: `apps/api/test/int/identity-sync.test.ts`

**Interfaces:**
- Produces:
  - `runIdentitySync(deps: { db: pg.Pool; oidc: Pick<OidcProvider, 'listDisabledUsers' | 'listUserGroups'>; identity: IdentityService; log: { info: (o: unknown, m?: string) => void } }): Promise<{ checked: number; deactivated: number; roleChanges: number }>` — for every `active` user with `source='entra'`: groups via Graph → `applyGroupMap`; disabled/missing in Graph → `deactivate`. Writes one audit row `identity.sync` with the summary (actor null).
  - `registerIdentitySyncJob(app)` — `app.boss.schedule('identity.sync', '0 3 * * *', {}, { tz: 'Asia/Jerusalem' })` and `app.boss.work('identity.sync', …)`; skipped with a log line when `app.oidc` is null.
  - `plugins/boss.ts`: `app.boss` started with `connectionString`, `schema: 'pgboss'`; `onClose` stops it.

- [ ] **Step 1: Write the failing test**

`apps/api/test/int/identity-sync.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, seedUser } from '../helpers/db.js';
import { IdentityService } from '../../src/modules/auth/identity.js';
import { runIdentitySync } from '../../src/jobs/identity-sync.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
run('identity.sync', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => { db = await startTestDb(); }, 120000);
  afterAll(async () => { await db.stop(); });

  it('refreshes roles from groups and deactivates disabled users', async () => {
    await db.pool.query(`insert into groups_map(idp_group_id, idp_group_name, role_id) select 'grp-leads','KB-Leads', id from roles where name='lead'`);
    const keep = await seedUser(db.pool, { email: 'keep@wecom.co.il', displayName: 'K', subject: 'sub-keep', roles: ['editor'] });
    const gone = await seedUser(db.pool, { email: 'gone@wecom.co.il', displayName: 'G', subject: 'sub-gone', roles: ['agent'] });
    await db.pool.query(`insert into sessions(user_id, token_hash, expires_at) values ($1,'x',now()+interval '1 hour')`, [gone]);
    const oidc = { listDisabledUsers: async (subs: string[]) => new Set(subs.filter((s) => s === 'sub-gone')), listUserGroups: async (s: string) => (s === 'sub-keep' ? ['grp-leads'] : []) };
    const identity = new IdentityService(db.pool, () => undefined);
    const res = await runIdentitySync({ db: db.pool, oidc, identity, log: { info: () => undefined } });
    expect(res).toEqual({ checked: 2, deactivated: 1, roleChanges: 1 });
    expect((await db.pool.query('select active from users where id=$1', [gone])).rows[0].active).toBe(false);
    expect((await db.pool.query('select revoked_at from sessions where user_id=$1', [gone])).rows[0].revoked_at).not.toBeNull();
    const roles = (await db.pool.query('select r.name from user_roles ur join roles r on r.id=ur.role_id where ur.user_id=$1 order by 1', [keep])).rows.map((r) => r.name);
    expect(roles).toEqual(['editor', 'lead']);
    expect((await db.pool.query(`select count(*)::int as n from audit_log where action='identity.sync'`)).rows[0].n).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Write the implementation**

`apps/api/src/jobs/identity-sync.ts`:
```ts
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import type { OidcProvider } from '../modules/auth/oidc.js';
import type { IdentityService } from '../modules/auth/identity.js';
import { audit } from '../lib/audit.js';

export type SyncDeps = { db: pg.Pool; oidc: Pick<OidcProvider, 'listDisabledUsers' | 'listUserGroups'>; identity: IdentityService; log: { info: (o: unknown, m?: string) => void } };

export async function runIdentitySync(deps: SyncDeps): Promise<{ checked: number; deactivated: number; roleChanges: number }> {
  const users = (await deps.db.query<{ id: string; subject: string }>(`select id, subject from users where active and source='entra'`)).rows;
  const disabled = await deps.oidc.listDisabledUsers(users.map((u) => u.subject));
  let deactivated = 0, roleChanges = 0;
  for (const u of users) {
    if (disabled.has(u.subject)) { await deps.identity.deactivate(u.id, null); deactivated++; continue; }
    const groups = await deps.oidc.listUserGroups(u.subject);
    const ch = await deps.identity.applyGroupMap(u.id, groups);
    if (ch.added.length || ch.removed.length) roleChanges++;
  }
  const summary = { checked: users.length, deactivated, roleChanges };
  await audit(deps.db, { actorId: null, action: 'identity.sync', entityType: 'system', entityId: null, before: null, after: summary, requestId: null, ip: null });
  deps.log.info(summary, 'identity sync finished');
  return summary;
}

export async function registerIdentitySyncJob(app: FastifyInstance): Promise<void> {
  if (!app.oidc) { app.log.info('identity.sync not scheduled: OIDC not configured'); return; }
  const oidc = app.oidc;
  await app.boss.work('identity.sync', async () => { await runIdentitySync({ db: app.db, oidc, identity: app.identity, log: app.log }); });
  await app.boss.schedule('identity.sync', '0 3 * * *', {}, { tz: 'Asia/Jerusalem' });
}
```

`apps/api/src/plugins/boss.ts` (only if absent):
```ts
import fp from 'fastify-plugin';
import PgBoss from 'pg-boss';
declare module 'fastify' { interface FastifyInstance { boss: PgBoss } }
export default fp(async (app) => {
  const boss = new PgBoss({ connectionString: app.config.DATABASE_URL, schema: 'pgboss' });
  boss.on('error', (e) => app.log.error({ err: e }, 'pg-boss error'));
  if (app.config.NODE_ENV !== 'test') await boss.start();
  app.decorate('boss', boss);
  app.addHook('onClose', async () => { if (app.config.NODE_ENV !== 'test') await boss.stop({ graceful: true, timeout: 5000 }); });
});
```
Register `jobsPlugin` in `app.ts` after `authPlugin`, and inside the `v1` callback after `registerAuth`, call `await registerIdentitySyncJob(v1)` guarded by `if (app.config.NODE_ENV !== 'test')`.

- [ ] **Step 4: Run test to verify it passes** — `RUN_INTEGRATION=1 pnpm --filter @wecom/api test -- test/int/identity-sync.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jobs apps/api/src/plugins/boss.ts apps/api/src/app.ts apps/api/test/int/identity-sync.test.ts
git commit -m "feat(api): nightly identity.sync job refreshing roles and deactivating disabled users"
```

---

### Task 11: `create-admin` CLI

**Files:**
- Create: `apps/api/src/cli/create-admin.ts`
- Modify: `apps/api/package.json` (script `"create-admin": "tsx src/cli/create-admin.ts"`)
- Test: `apps/api/test/int/create-admin.test.ts`

**Interfaces:**
- Produces: `createAdmin(db: pg.Pool, email: string, password: string, displayName = 'Admin'): Promise<{ id: string; created: boolean }>` — upserts a `source='local'` user (subject = email), sets argon2 hash, ensures the `admin` role; CLI parses `--email`, `--password`, optional `--name`, refuses passwords shorter than 12 characters, prints the user id.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb } from '../helpers/db.js';
import { createAdmin } from '../../src/cli/create-admin.js';
import { verifyPassword } from '../../src/modules/auth/local.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
run('create-admin', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => { db = await startTestDb(); }, 120000);
  afterAll(async () => { await db.stop(); });
  it('creates a local admin, then rotates the password on re-run', async () => {
    const a = await createAdmin(db.pool, 'root@wecom.co.il', 'first-password-1');
    const b = await createAdmin(db.pool, 'root@wecom.co.il', 'second-password-2');
    expect(a.created).toBe(true); expect(b.created).toBe(false); expect(a.id).toBe(b.id);
    const row = (await db.pool.query('select password_hash, source from users where id=$1', [a.id])).rows[0];
    expect(row.source).toBe('local'); expect(await verifyPassword(row.password_hash, 'second-password-2')).toBe(true);
    const roles = (await db.pool.query('select r.name from user_roles ur join roles r on r.id=ur.role_id where ur.user_id=$1', [a.id])).rows.map((r) => r.name);
    expect(roles).toEqual(['admin']);
  });
  it('rejects short passwords', async () => { await expect(createAdmin(db.pool, 'x@y.z', 'short')).rejects.toThrow(/12/); });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Write the implementation**

`apps/api/src/cli/create-admin.ts`:
```ts
import pg from 'pg';
import { parseArgs } from 'node:util';
import { hashPassword } from '../modules/auth/local.js';
import { initials } from '../modules/auth/identity.js';

export async function createAdmin(db: pg.Pool, email: string, password: string, displayName = 'Admin'): Promise<{ id: string; created: boolean }> {
  if (password.length < 12) throw new Error('password must be at least 12 characters');
  const e = email.toLowerCase(); const hash = await hashPassword(password);
  const existing = (await db.query<{ id: string }>(`select id from users where subject=$1 and source='local'`, [e])).rows[0];
  let id: string; let created = false;
  if (existing) { id = existing.id; await db.query(`update users set password_hash=$2, active=true, updated_at=now() where id=$1`, [id, hash]); }
  else { id = (await db.query<{ id: string }>(`insert into users(subject, source, email, display_name, initials, password_hash) values ($1,'local',$1,$2,$3,$4) returning id`, [e, displayName, initials(displayName), hash])).rows[0].id; created = true; }
  await db.query(`insert into user_roles(user_id, role_id) select $1, id from roles where name='admin' on conflict do nothing`, [id]);
  await db.query(`insert into audit_log(actor_id, action, entity_type, entity_id, after) values (null, 'admin.create_admin', 'user', $1, $2)`, [id, JSON.stringify({ email: e, created })]);
  return { id, created };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { email: { type: 'string' }, password: { type: 'string' }, name: { type: 'string' } } });
  if (!values.email || !values.password) { console.error('usage: create-admin --email <email> --password <password> [--name <display name>]'); process.exit(2); }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  createAdmin(pool, values.email, values.password, values.name).then((r) => { console.log(`${r.created ? 'created' : 'updated'} admin ${r.id}`); return pool.end(); }).catch((e) => { console.error(e.message); process.exit(1); });
}
```

- [ ] **Step 4: Run test to verify it passes** — PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/cli apps/api/package.json apps/api/test/int/create-admin.test.ts
git commit -m "feat(api): create-admin CLI for the break-glass account"
```

---

### Task 12: Documentation and end-to-end verification

**Files:**
- Create: `docs/identity.md`
- Modify: `apps/api/.env.example` (add `PALOALTO_SCHEME=https`, comment each `OIDC_*` and `PALOALTO_*` key)

- [ ] **Step 1: Write `docs/identity.md`** covering: Entra app registration checklist (redirect URI `https://<host>/api/v1/auth/callback`, ID token `groups` claim enabled for security groups, API permissions `User.Read.All` + `GroupMember.Read.All` application, admin consent), `groups_map` setup through `PUT /admin/groups-map`, Palo Alto prerequisites (XML API key, `PALOALTO_SUBNETS`), break-glass procedure (`pnpm --filter @wecom/api create-admin`, login form at `/login/local`), session lifetime, how permission checks and category scopes work, and the nightly sync. Around 80 lines; every config key named exactly as in `ConfigSchema`.

- [ ] **Step 2: Run the complete suite**

Run: `pnpm lint && pnpm typecheck && pnpm --filter @wecom/api test && RUN_INTEGRATION=1 pnpm --filter @wecom/api test:int && pnpm openapi && git diff --exit-code -- docs/api/openapi.json`
Expected: all green, no OpenAPI drift.

- [ ] **Step 3: Commit**

```bash
git add docs/identity.md apps/api/.env.example
git commit -m "docs: identity and RBAC operations guide"
```

---

## Self-review

- **Spec coverage**: stage-1 §3 providers 1–3 → Tasks 6, 7, 8 (local); sessions (table, cookie, sliding, revocable) → Tasks 1, 4, 9; nightly Graph re-sync + deactivation → Task 10; permissions catalogue and default roles → consumed from L0 (Task 2 resolves them); admin-locked permissions → Task 9; category scopes → Tasks 2, 4; `requires(...)` enforcement in one middleware → Task 4; audit on every write → Tasks 8, 9, 10, 11; §4 auth routes (`providers`, `login`, `callback`, `logout`, `me`, `local`) → Task 8; admin routes (`users`, `roles`, `groups-map`, `sessions`, `audit`) → Task 9; rate limits on `/auth/*` → Task 8; `create-admin` → Task 11; error envelope codes → Task 4/8; tests with a local OIDC issuer and a Palo Alto stub → Tasks 3, 6, 8.
- **Placeholder scan**: none; each code step is complete. `docs/identity.md` content is described by an explicit outline with the exact keys to document.
- **Type consistency**: `AuthUser` (Task 2) is what `plugins/auth.ts`, `paloalto.ts` and routes attach to `req.user`; `SessionStore` method names (`create/find/touch/revoke/revokeAllForUser`) match their uses in Tasks 4, 7, 8, 9; `IdentityService.upsertUser/applyGroupMap/deactivate` match Tasks 8 and 10; `OidcProvider.listDisabledUsers/listUserGroups` match `SyncDeps`; `audit()` signature matches every call site; `app.authCache.invalidate/clear`, `app.sessions`, `app.identity`, `app.oidc`, `app.boss`, `app.setFallbackIdentify` are declared once each and used with those names.
- **Cross-lane notes**: `lib/audit.ts` and `lib/errors.ts` are created only if L2 has not; `plugins/boss.ts` likewise. `PALOALTO_SCHEME` is an addition to `ConfigSchema` (additive, no ADR needed). All `/api/v1` modules must be registered inside the single `v1` callback in `app.ts` so decorators resolve; L2 must follow the same convention.
