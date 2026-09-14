#!/usr/bin/env node
/**
 * The no-mocks end-to-end gate.
 *
 * Every other suite in this repo runs against msw. That is the right harness for component
 * behaviour, but it cannot catch a contract mismatch — it *is* the contract, as the frontend
 * review demonstrated (login broken, SSE never connecting, nine pages throwing on first render,
 * all while 96 unit tests and 6 e2e specs were green).
 *
 * This gate runs the real thing:
 *   1. a throwaway `pgvector/pgvector:pg16` container
 *   2. `migrate`, `seed`, and `create-admin` (the break-glass local account)
 *   3. the real API, production-like: NODE_ENV=production, AUTH_FALLBACK=none, no model service
 *   4. the **built** SPA served by `vite preview`, proxying /api and /events to that API
 *   5. Playwright against all of it
 *
 * Everything is torn down on exit, including on Ctrl-C and on failure.
 *
 * Usage: pnpm e2e:real [-- --grep <pattern>]
 *   KEEP_STACK=1   leave the container and servers up after the run (for debugging)
 *   E2E_HEADED=1   run Playwright headed
 *   E2E_PG_CONTAINER / E2E_PG_PORT / E2E_API_PORT / E2E_WEB_PORT
 *                  run a second, isolated stack beside one that is already up
 *   E2E_OIDC=1     also stand up a real OIDC issuer, configure the API against it, and run the
 *                  SSO login spec. Off by default: the default run is the break-glass path, which
 *                  is what a deployment with no issuer configured actually does.
 */
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { E2E_OIDC_CLIENT, E2E_OIDC_USER } from './e2e-oidc-issuer.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Overridable because two worktrees do run this gate at once: without it the second run's
 * `docker rm -f` takes the first run's Postgres out from under it, and the failure reads as
 * "terminating connection due to unexpected postmaster exit" a minute later, nowhere near the
 * cause. The ports are already overridable for the same reason.
 */
const PG_PORT = Number(process.env.E2E_PG_PORT ?? 55432);
const API_PORT = Number(process.env.E2E_API_PORT ?? 3101);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 4174);
const CONTAINER = process.env.E2E_PG_CONTAINER ?? `wecom-e2e-pg-${PG_PORT}`;
const OIDC_PORT = Number(process.env.E2E_OIDC_PORT ?? 9401);
const WITH_OIDC = process.env.E2E_OIDC === '1';
const PG_PASSWORD = 'e2e-postgres';
const DATABASE_URL = `postgres://postgres:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/postgres`;

export const ADMIN_EMAIL = 'e2e-admin@wecom.co.il';
export const ADMIN_PASSWORD = 'e2e-break-glass-pw-2026';

const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

/* ── process bookkeeping ──────────────────────────────────────────────────── */

const children = [];
/** The OIDC issuer's origin, when `E2E_OIDC=1`. The process itself is one of `children`. */
let issuerUrl = null;
let tornDown = false;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status ?? r.signal}`);
  return r;
}

/**
 * Starts a long-lived process, prefixing its output so interleaved logs stay readable.
 *
 * `detached: true` puts it in its own process group: `pnpm --filter … exec tsx` spawns the real
 * server as a *grandchild*, and signalling only `pnpm` orphans it — which is how an earlier run
 * leaked an API holding port 3101, so a later run's health check passed against a zombie pointing
 * at a database that no longer existed. Teardown signals the whole group.
 */
function start(label, cmd, args, opts = {}, onLine) {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...opts });
  children.push({ label, child });
  const pipe = (stream, to) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) {
        if (!l.trim()) continue;
        // The reader has to sit inside the pipe: attaching a second `data` listener afterwards
        // races the one above, which has already consumed the first chunk.
        onLine?.(l);
        to.write(`  [${label}] ${l}\n`);
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stdout);
  child.on('exit', (code, signal) => {
    if (tornDown || signal === 'SIGKILL' || signal === 'SIGTERM') return;
    // Never let the run continue against a half-dead stack: a dead API plus a stale one still
    // listening is exactly how this gate produces a confusing, wrong failure.
    console.error(`\n✗ [${label}] exited unexpectedly (code ${code}, signal ${signal}) — aborting\n`);
    teardown();
    process.exit(1);
  });
  return child;
}

function teardown() {
  if (tornDown) return;
  tornDown = true;
  if (process.env.KEEP_STACK === '1') {
    console.log(
      `\nKEEP_STACK=1 — leaving the stack up:\n  db  ${DATABASE_URL}\n  api ${API_URL}\n  web ${WEB_URL}\n`,
    );
    return;
  }
  killChildren();
  spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
}

/**
 * SIGKILL, not SIGTERM.
 *
 * The API's SIGTERM handler awaits `app.close()`, which blocks on the open SSE streams (a 1 h
 * read timeout) — so a polite shutdown left the API alive, holding :3101, and the *next* run's
 * health check then passed against a zombie wired to a dropped database. There is nothing to
 * flush in a throwaway test stack, so it is killed outright.
 *
 * The negative pid targets the process group: `pnpm --filter … exec tsx` runs the real server as
 * a grandchild, and signalling only `pnpm` orphans it.
 */
function killChildren() {
  for (const { child } of children) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
}

process.on('exit', teardown);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    teardown();
    process.exit(130);
  });
}

/* ── waiting ──────────────────────────────────────────────────────────────── */

async function waitFor(label, check, { timeoutMs = 120_000, everyMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      if (await check()) {
        console.log(`✓ ${label}`);
        return;
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(everyMs);
  }
  throw new Error(`timed out waiting for ${label}${lastErr ? `: ${lastErr.message}` : ''}`);
}

const httpOk = (url) => async () => {
  const res = await fetch(url).catch(() => null);
  return !!res && res.status < 500;
};

/**
 * Refuses to start if anything already holds a port we are about to bind.
 *
 * Without this the gate is dangerously misleading: a leftover API on :3101 answers the health
 * check, so the run proceeds and every spec fails against a server wired to a database that no
 * longer exists. Better to stop and say so.
 */
function assertPortsFree() {
  const busy = [];
  for (const [name, port] of [
    ['api', API_PORT],
    ['web', WEB_PORT],
    ['postgres', PG_PORT],
    ...(WITH_OIDC ? [['oidc', OIDC_PORT]] : []),
  ]) {
    const r = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    const pids = (r.stdout ?? '').trim().split('\n').filter(Boolean);
    if (pids.length) busy.push(`  :${port} (${name}) held by pid ${pids.join(', ')}`);
  }
  if (busy.length)
    throw new Error(
      `ports already in use — a previous run probably leaked a process:\n${busy.join('\n')}\n` +
        '  kill them (or set E2E_API_PORT / E2E_WEB_PORT / E2E_PG_PORT) and retry',
    );
}

/* ── the gate ─────────────────────────────────────────────────────────────── */

async function main() {
  const passthrough = process.argv.slice(2);

  assertPortsFree();

  console.log('\n── 1. postgres (pgvector/pgvector:pg16) ──────────────────────');
  spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
  run('docker', [
    'run',
    '-d',
    '--name',
    CONTAINER,
    '-e',
    `POSTGRES_PASSWORD=${PG_PASSWORD}`,
    '-e',
    'POSTGRES_DB=postgres',
    '-p',
    `${PG_PORT}:5432`,
    'pgvector/pgvector:pg16',
  ]);
  await waitFor(`postgres accepting connections on :${PG_PORT}`, () => {
    const r = spawnSync('docker', ['exec', CONTAINER, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' });
    return r.status === 0;
  });
  // pg_isready goes green a moment before the server finishes its first-boot restart.
  await sleep(1000);

  const dbEnv = { ...process.env, DATABASE_URL };

  console.log('\n── 2. migrate, seed, create-admin ───────────────────────────');
  run('pnpm', ['--filter', '@wecom/api', 'migrate'], { env: dbEnv });
  run('pnpm', ['--filter', '@wecom/api', 'seed'], { env: dbEnv });
  // No `--` separator: pnpm forwards these already, and a literal `--` reaches `parseArgs`.
  run(
    'pnpm',
    [
      '--filter',
      '@wecom/api',
      'create-admin',
      '--email',
      ADMIN_EMAIL,
      '--password',
      ADMIN_PASSWORD,
      '--name',
      'E2E Admin',
    ],
    { env: dbEnv },
  );

  console.log('\n── 2b. wordpress stub ───────────────────────────────────────');
  // The real connector talks to a real HTTP server here — the same stub the connector unit tests
  // use — so W4-E2E-3 exercises fetch, auth, pagination and the push, not a mock of them.
  let WP_URL = '';
  start('wp', 'pnpm', ['--filter', '@wecom/api', 'exec', 'tsx', '../../scripts/wp-stub.mjs'], {}, (line) => {
    const m = /WP_STUB_URL=(\S+)/.exec(line);
    if (m) WP_URL = m[1];
  });
  await waitFor('wordpress stub url', () => !!WP_URL);
  // The issuer has to exist before the API boots: `registerAuth` runs OIDC discovery once at
  // startup and permanently disables Entra login if it fails, so a later start would leave the
  // API configured for SSO and refusing it.
  let oidcEnv = {};
  if (WITH_OIDC) {
    console.log('\n── 2c. oidc test issuer ─────────────────────────────────────');
    const redirectUri = `${WEB_URL}/api/v1/auth/callback`;
    issuerUrl = `http://127.0.0.1:${OIDC_PORT}`;
    // Its own process, not this one: every step here runs through `spawnSync`, which blocks this
    // event loop for the whole of the Playwright run. An in-process issuer answers the discovery
    // probe and then goes deaf the moment the browser is redirected to it.
    start('oidc', process.execPath, [
      resolve(ROOT, 'scripts/e2e-oidc-issuer.mjs'),
      '--port',
      String(OIDC_PORT),
      '--redirect-uri',
      redirectUri,
    ]);
    await waitFor(
      `oidc issuer discovery at ${issuerUrl}`,
      httpOk(`${issuerUrl}/.well-known/openid-configuration`),
    );
    // The group the id token carries, mapped to the `lead` role — this is the assertion the login
    // spec ends on, and it is the whole point of routing login through a real issuer.
    run('docker', [
      'exec',
      CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-c',
      `insert into groups_map(idp_group_id, idp_group_name, role_id) select '${E2E_OIDC_USER.group}','${E2E_OIDC_USER.group}', id from roles where name='lead'`,
    ]);
    oidcEnv = {
      OIDC_ISSUER: issuerUrl,
      OIDC_CLIENT_ID: E2E_OIDC_CLIENT.id,
      OIDC_CLIENT_SECRET: E2E_OIDC_CLIENT.secret,
      // As the *browser* reaches the callback: through the web origin, not the API's own port.
      // It is also what the client registration declares, and the two must match exactly.
      OIDC_REDIRECT_URI: redirectUri,
    };
  }

  console.log('\n── 3. api (production-like) ─────────────────────────────────');
  start('api', 'pnpm', ['--filter', '@wecom/api', 'exec', 'tsx', 'src/server.ts'], {
    env: {
      ...dbEnv,
      NODE_ENV: 'production',
      PORT: String(API_PORT),
      // Without `E2E_OIDC=1` no SSO issuer is configured, so the local break-glass account is the
      // only way in — which is what the default gate exercises. `none` means no Palo Alto
      // fallback either, in both modes.
      AUTH_FALLBACK: 'none',
      ...oidcEnv,
      SESSION_SECRET: 'e2e-session-secret-at-least-16-chars',
      PUBLIC_URL: WEB_URL,
      // Requests arrive straight from Playwright, not through nginx, so there is no forwarded
      // header to trust — and trusting one here would let a client spoof `req.ip`, which gates
      // the auth rate limits and the audit/session IP columns. `TRUST_PROXY` defaults to true
      // under NODE_ENV=production, so it has to be set off explicitly.
      TRUST_PROXY: 'false',
      // Production refuses the dev defaults for these two, and there is no Ollama in CI.
      CONNECTOR_KEY: 'a1'.repeat(32),
      MODEL_DISABLED: 'true',
      MIGRATE_ON_START: 'false',
      BACKUP_DIR: '/tmp/wecom-e2e-backups',
      // The stub is on loopback, and an empty allowlist would let a connector reach anything —
      // so the gate also proves the allowlist admits a host it is told to admit.
      CONNECTOR_HOST_ALLOWLIST: '127.0.0.1,localhost',
    },
  });
  await waitFor(`api healthy at ${API_URL}/api/v1/system/health`, httpOk(`${API_URL}/api/v1/system/health`));

  console.log('\n── 4. web (built dist via vite preview) ─────────────────────');
  run('pnpm', ['--filter', '@wecom/web', 'build']);
  start(
    'web',
    'pnpm',
    ['--filter', '@wecom/web', 'exec', 'vite', 'preview', '--port', String(WEB_PORT), '--strictPort'],
    {
      env: { ...process.env, E2E_API_URL: API_URL },
    },
  );
  await waitFor(`web serving at ${WEB_URL}`, httpOk(WEB_URL));
  await waitFor('web proxying /api to the real api', async () => {
    const res = await fetch(`${WEB_URL}/api/v1/system/health`);
    const body = await res.json();
    return res.ok && body.ok === true;
  });

  console.log('\n── 5. playwright (no mocks) ─────────────────────────────────\n');
  run(
    'pnpm',
    [
      '--filter',
      '@wecom/web',
      'exec',
      'playwright',
      'test',
      '--config',
      'playwright.real.config.ts',
      ...passthrough,
    ],
    {
      env: {
        ...process.env,
        E2E_REAL_BASE_URL: WEB_URL,
        E2E_ADMIN_EMAIL: ADMIN_EMAIL,
        E2E_ADMIN_PASSWORD: ADMIN_PASSWORD,
        E2E_WP_URL: WP_URL,
        // Read by `playwright.real.config.ts` (to add the SSO project) and by the specs: with an
        // issuer configured the login screen leads with the Microsoft button and folds the local
        // form behind a disclosure, so even the break-glass setup takes a different path.
        ...(WITH_OIDC
          ? {
              E2E_OIDC: '1',
              E2E_OIDC_ISSUER: issuerUrl,
              E2E_OIDC_USER: E2E_OIDC_USER.id,
              E2E_OIDC_NAME: E2E_OIDC_USER.name,
              E2E_OIDC_ROLE: 'lead',
            }
          : {}),
        ...(process.env.E2E_HEADED === '1' ? { PWDEBUG: '0' } : {}),
      },
    },
  );

  console.log(
    `\n✓ e2e:real passed against a real Postgres, a real API and the built SPA${
      WITH_OIDC ? ', with a real OIDC issuer' : ''
    }.\n`,
  );

  // Tear down and exit explicitly. The started children are detached with piped stdio, which
  // keeps this process's event loop alive forever — so on the success path node never exits on
  // its own, the `exit` handler never fires, and the stack is left running. That is how a passing
  // run still leaked an API on :3101 for the next one to trip over.
  teardown();
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n✗ e2e:real failed: ${e.message}\n`);
  teardown();
  process.exit(1);
});
