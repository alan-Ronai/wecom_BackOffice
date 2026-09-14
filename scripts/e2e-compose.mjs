#!/usr/bin/env node
/**
 * The **Compose** end-to-end gate: Playwright against the stack a pilot actually runs.
 *
 * `pnpm e2e:real` proves the API and the SPA agree, but it reaches the API on a plain loopback
 * port with `vite preview` in front and no firewall anywhere — so nothing in it can see nginx's
 * TLS and security headers, nothing exercises `TRUST_PROXY`, and the whole LAN identity path
 * (`AUTH_FALLBACK=paloalto`) has never run outside a unit test. This gate runs:
 *
 *   1. `deploy/docker-compose.yml` + `.ci.yml` + `.e2e.yml` — nginx terminating TLS in front of
 *      the API, Postgres, and a real Ollama with a small model actually pulled
 *   2. `scripts/paloalto-stub.mjs` as the firewall's PAN-OS XML API, in its own container
 *   3. `scripts/wp-stub.mjs` as WordPress, in its own container
 *   4. the seeded library, a break-glass admin, and a LAN user the firewall knows about
 *   5. `apps/web/e2e/compose/` through nginx on https://localhost:8443
 *
 * ── how a browser on this machine arrives "from the LAN" ──────────────────────────────────────
 * The trusted subnet is 10.44.0.0/16 (`PALOALTO_SUBNETS` in deploy/e2e.env), and a browser on the
 * host reaches nginx from the docker bridge gateway, which is not in it. nginx forwards
 * `X-Forwarded-For $proxy_add_x_forwarded_for` — the client's own header with the connecting
 * address appended — and `TRUST_PROXY` names the bridge networks, so Fastify resolves `req.ip` to
 * the left-most address the bridge did not add. A context that sets `X-Forwarded-For: 10.44.0.7`
 * therefore reaches the API as a LAN client, which is exactly what a client one hop further out
 * would look like on the VM.
 *
 * Two consequences, both deliberate:
 *   - the *untrusted* case needs no such trick. A plain browser arrives as the bridge gateway,
 *     genuinely outside the trusted subnet, and the last test in `compose/lan-identity.spec.ts`
 *     asserts on that real address — no header anywhere.
 *   - a client that can reach nginx can therefore choose the `req.ip` the firewall is asked
 *     about, and become any user the firewall maps. That is a property of the shipped nginx.conf
 *     (`X-Forwarded-For $proxy_add_x_forwarded_for` preserves what the client sent), not of this
 *     gate; it is written up in docs/operations.md under "Trusting X-Forwarded-For". The day the
 *     deployment stops behaving this way, `lan-identity.spec.ts` goes red and wants rewriting
 *     around a client container with an address on the trusted network instead.
 *
 * Usage: pnpm e2e:compose [-- --grep <pattern>]
 *   KEEP_STACK=1        leave the stack up afterwards (`docker compose -p wecom-kb-e2e ps`)
 *   E2E_SKIP_BUILD=1    reuse the images from a previous run (saves ~6 min; wrong after a code change)
 *   E2E_COMPOSE_PROJECT rename the compose project (default `wecom-kb-e2e`, never the pilot's)
 *
 * Expect 15–25 minutes cold: the image build dominates, then the model pull, then ~4 minutes of
 * specs. `E2E_SKIP_BUILD=1` on an unchanged tree brings it to about 8.
 */
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runPlaywright } from './lib/playwright-run.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOY = join(ROOT, 'deploy');
const ENV_SOURCE = join(DEPLOY, 'e2e.env');
const ENV_TARGET = join(DEPLOY, '.env'); // what `env_file:` in docker-compose.yml reads
const ENV_BACKUP = join(DEPLOY, '.env.before-e2e');

/**
 * Its own compose project, so `down -v` can never take an operator's pilot stack (which uses the
 * `name: wecom-kb` declared in docker-compose.yml) and its database volume with it.
 */
const PROJECT = process.env.E2E_COMPOSE_PROJECT ?? 'wecom-kb-e2e';

/**
 * Fixed, not configurable: `deploy/docker-compose.ci.yml` hard-codes 8443/8080, and compose
 * concatenates `ports` across overlay files rather than replacing them — a second mapping would
 * publish the stack twice instead of moving it.
 */
const HTTPS_PORT = 8443;
const HTTP_PORT = 8080;
const PANOS_PORT = 8186; // the stub's control plane, published for the specs
const WP_PORT = 8085; // the WordPress stub, published so a spec can edit a post "in WordPress"
const BASE_URL = `https://localhost:${HTTPS_PORT}`;

export const ADMIN_EMAIL = 'e2e-compose-admin@wecom.co.il';
export const ADMIN_PASSWORD = 'e2e-compose-break-glass-2026';

/**
 * The LAN identity the firewall reports. The row is seeded with the `agent` role *before* anyone
 * signs in: `makeFallbackIdentify` upserts a `source='paloalto'` user with no roles at all
 * (docs/identity.md §3), so "the mapped role" is a role the deployment already granted — which is
 * how the fallback is meant to be used, and what the spec asserts arrives with the session.
 */
const LAN = {
  ip: '10.44.0.7',
  subject: 'WECOM\\e2e.agent',
  user: 'e2e.agent',
  role: 'agent',
};
/** Inside the trusted subnet, but the firewall has no mapping for it. */
const LAN_UNKNOWN_IP = '10.44.0.9';
/** Outside it (TEST-NET-2), the way a client off the corporate LAN looks. */
const OFFSITE_IP = '198.51.100.7';

const COMPOSE_FILES = [
  join(DEPLOY, 'docker-compose.yml'),
  join(DEPLOY, 'docker-compose.ci.yml'),
  join(DEPLOY, 'docker-compose.e2e.yml'),
];

let envSwapped = false;
let tornDown = false;

/* ── shelling out ─────────────────────────────────────────────────────────── */

function compose(args, opts = {}) {
  const base = ['compose', '-p', PROJECT, '--env-file', ENV_SOURCE];
  for (const f of COMPOSE_FILES) base.push('-f', f);
  const stdio = opts.input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'];
  return spawnSync('docker', [...base, ...args], { cwd: ROOT, stdio, ...opts });
}

function composeOrThrow(args, opts) {
  const r = compose(args, opts);
  if (r.status !== 0) throw new Error(`docker compose ${args.join(' ')} exited ${r.status ?? r.signal}`);
  return r;
}

const composeOut = (args) =>
  (compose(args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).stdout ?? '').trim();

function run(cmd, args, opts = {}) {
  const stdio = opts.input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'];
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status ?? r.signal}`);
  return r;
}

/**
 * `curl`, not `fetch`: the stack's certificate is self-signed, and node's fetch offers no
 * per-request way to accept one short of turning TLS verification off for the whole process.
 */
function curl(url, args = []) {
  const r = spawnSync('curl', ['-ksS', '-m', '15', ...args, url], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}
function curlJson(url, args = []) {
  const r = curl(url, args);
  if (r.status !== 0) throw new Error(`curl ${url} failed: ${r.err.trim()}`);
  return JSON.parse(r.out);
}

async function waitFor(label, check, { timeoutMs = 300_000, everyMs = 2_000 } = {}) {
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

/* ── setup and teardown of things outside compose ─────────────────────────── */

/**
 * `deploy/.env` is what `env_file:` reads, and an operator's own may be sitting there. Move it
 * aside rather than overwrite it, and put it back on the way out.
 */
function swapEnv() {
  rmSync(ENV_BACKUP, { force: true });
  if (existsSync(ENV_TARGET)) {
    renameSync(ENV_TARGET, ENV_BACKUP);
    console.log(`  deploy/.env moved aside to ${ENV_BACKUP}`);
  }
  copyFileSync(ENV_SOURCE, ENV_TARGET);
  envSwapped = true;
}
function restoreEnv() {
  if (!envSwapped) return;
  envSwapped = false;
  rmSync(ENV_TARGET, { force: true });
  if (existsSync(ENV_BACKUP)) renameSync(ENV_BACKUP, ENV_TARGET);
}

/** A throwaway self-signed certificate, exactly as .github/workflows/deploy-smoke.yml mints one. */
function ensureCerts() {
  const dir = join(DEPLOY, 'certs');
  mkdirSync(dir, { recursive: true });
  if (existsSync(join(dir, 'cert.pem')) && existsSync(join(dir, 'key.pem'))) {
    console.log('✓ deploy/certs already has a certificate');
    return;
  }
  run('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    join(dir, 'key.pem'),
    '-out',
    join(dir, 'cert.pem'),
    '-days',
    '2',
    '-subj',
    '/CN=localhost',
  ]);
  console.log('✓ minted a self-signed certificate in deploy/certs');
}

function assertPortsFree() {
  const busy = [];
  for (const [name, port] of [
    ['nginx https', HTTPS_PORT],
    ['nginx http', HTTP_PORT],
    ['paloalto stub control', PANOS_PORT],
    ['wordpress stub', WP_PORT],
  ]) {
    const r = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    const pids = (r.stdout ?? '').trim().split('\n').filter(Boolean);
    if (pids.length) busy.push(`  :${port} (${name}) held by pid ${pids.join(', ')}`);
  }
  if (busy.length)
    throw new Error(
      `ports already in use — the pilot stack, or a leftover run:\n${busy.join('\n')}\n` +
        '  stop whatever holds them (the ports are fixed by deploy/docker-compose.ci.yml) and retry',
    );
}

function teardown() {
  if (tornDown) return;
  tornDown = true;
  if (process.env.KEEP_STACK === '1') {
    console.log(
      `\nKEEP_STACK=1 — leaving the stack up:\n` +
        `  app        ${BASE_URL}\n` +
        `  admin      ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}\n` +
        `  firewall   http://127.0.0.1:${PANOS_PORT}/_control/state\n` +
        `  wordpress  http://127.0.0.1:${WP_PORT}/wp-json/wp/v2/posts/101\n` +
        `  logs       docker compose -p ${PROJECT} logs\n` +
        `  down       docker compose -p ${PROJECT} -f ${COMPOSE_FILES.join(' -f ')} down -v\n` +
        `  (deploy/.env is still the e2e one; ${ENV_BACKUP} holds what was there)\n`,
    );
    return;
  }
  compose(['down', '-v', '--remove-orphans'], { stdio: 'ignore' });
  restoreEnv();
}

process.on('exit', teardown);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    teardown();
    process.exit(130);
  });
}

/* ── the gate ─────────────────────────────────────────────────────────────── */

async function main() {
  const passthrough = process.argv.slice(2);

  console.log('\n── 1. preflight ─────────────────────────────────────────────');
  if (spawnSync('docker', ['version'], { stdio: 'ignore' }).status !== 0)
    throw new Error('docker is not available — this gate runs the real Compose stack');
  ensureCerts();
  swapEnv();
  // `./backups` is bind-mounted read-only into the api container; compose would create it as
  // root, which is a surprise to find in a worktree afterwards.
  mkdirSync(join(DEPLOY, 'backups'), { recursive: true });
  // Any stack left by a previous run, volumes included: the seed below assumes an empty database.
  compose(['down', '-v', '--remove-orphans'], { stdio: 'ignore' });
  assertPortsFree();

  if (process.env.E2E_SKIP_BUILD === '1') {
    console.log('\n── 2. build (skipped: E2E_SKIP_BUILD=1) ─────────────────────');
  } else {
    console.log('\n── 2. build the api and web images ──────────────────────────');
    composeOrThrow(['build']);
  }

  console.log('\n── 3. up ────────────────────────────────────────────────────');
  composeOrThrow(['up', '-d']);

  console.log('\n── 4. the model pull ────────────────────────────────────────');
  // A one-shot service, so `up -d` returns before it has finished. Waiting here means a pull
  // failure reads as itself instead of as an unexplained health timeout ten minutes later.
  const pullId = composeOut(['ps', '-aq', 'ollama-pull']);
  if (!pullId) throw new Error('the ollama-pull service did not start');
  await waitFor(
    'the model pull finished',
    () =>
      spawnSync('docker', ['inspect', '-f', '{{.State.Status}}', pullId], {
        encoding: 'utf8',
      }).stdout?.trim() === 'exited',
    { timeoutMs: 900_000, everyMs: 5_000 },
  );
  const pullCode = spawnSync('docker', ['inspect', '-f', '{{.State.ExitCode}}', pullId], {
    encoding: 'utf8',
  }).stdout?.trim();
  if (pullCode !== '0') {
    compose(['logs', '--tail', '20', 'ollama-pull']);
    throw new Error(`ollama-pull exited ${pullCode}`);
  }

  console.log('\n── 5. health through nginx ──────────────────────────────────');
  /**
   * The same bar `deploy/smoke.sh` holds the VM to, and the reason the stack pulls a real (if
   * tiny) model: `tagPresent` is false whenever MODEL_NAME is merely a typo, which `model: true`
   * used to hide.
   */
  await waitFor(`${BASE_URL}/api/v1/system/health reports db and the model tag`, () => {
    const h = curlJson(`${BASE_URL}/api/v1/system/health`);
    if (!h.db) return false;
    if (!h.modelStatus?.reachable) return false;
    if (!h.modelStatus?.tagPresent)
      throw new Error(`ollama is up but '${h.modelStatus?.name}' is not pulled`);
    return true;
  });
  await waitFor(
    'the WordPress stub answers',
    () => curl(`http://127.0.0.1:${WP_PORT}/wp-json/`).status === 0,
  );
  await waitFor(
    'the Palo Alto stub answers',
    () => !!curlJson(`http://127.0.0.1:${PANOS_PORT}/_control/state`).mappings,
  );

  console.log('\n── 6. seed, admin, and the LAN user ─────────────────────────');
  composeOrThrow(['exec', '-T', 'api', 'pnpm', '--filter', '@wecom/api', 'seed']);
  // The password arrives on stdin, never on a command line (acceptance review O-6).
  composeOrThrow(
    [
      'exec',
      '-T',
      'api',
      'pnpm',
      '--filter',
      '@wecom/api',
      'create-admin',
      '--email',
      ADMIN_EMAIL,
      '--password-stdin',
      '--name',
      'E2E Compose Admin',
    ],
    { input: ADMIN_PASSWORD },
  );
  /**
   * The LAN user, with its role, before anyone signs in — see the comment on `LAN`. The subject
   * is the `DOMAIN\user` the firewall reports, which is the key the fallback upserts on.
   */
  composeOrThrow([
    'exec',
    '-T',
    'db',
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'kb',
    '-d',
    'kb',
    '-c',
    `insert into users(subject, source, email, display_name, initials)
     values ('${LAN.subject}', 'paloalto', null, '${LAN.user}', 'e2')
     on conflict (subject, source) do nothing;
     insert into user_roles(user_id, role_id)
     select u.id, r.id from users u, roles r
      where u.subject = '${LAN.subject}' and u.source = 'paloalto' and r.name = '${LAN.role}'
     on conflict do nothing;`,
  ]);
  const state = curlJson(`http://127.0.0.1:${PANOS_PORT}/_control/state`);
  if (state.mappings[LAN.ip] !== LAN.subject)
    throw new Error(
      `the firewall stub does not map ${LAN.ip} to ${LAN.subject} (PALOALTO_STUB_MAPPINGS in deploy/e2e.env): ${JSON.stringify(state.mappings)}`,
    );
  console.log(`✓ the firewall stub maps ${LAN.ip} → ${state.mappings[LAN.ip]}`);

  console.log('\n── 7. playwright against the compose stack ──────────────────\n');
  const jsonReport = join(tmpdir(), `wecom-e2e-compose-${process.pid}.json`);
  runPlaywright(
    [
      '--filter',
      '@wecom/web',
      'exec',
      'playwright',
      'test',
      '--config',
      'playwright.compose.config.ts',
      '--reporter=list,json',
      ...passthrough,
    ],
    jsonReport,
    {
      cwd: ROOT,
      env: {
        ...process.env,
        PLAYWRIGHT_JSON_OUTPUT_NAME: jsonReport,
        E2E_COMPOSE_BASE_URL: BASE_URL,
        E2E_ADMIN_EMAIL: ADMIN_EMAIL,
        E2E_ADMIN_PASSWORD: ADMIN_PASSWORD,
        E2E_PANOS_CONTROL: `http://127.0.0.1:${PANOS_PORT}`,
        E2E_LAN_IP: LAN.ip,
        E2E_LAN_SUBJECT: LAN.subject,
        E2E_LAN_USER: LAN.user,
        E2E_LAN_ROLE: LAN.role,
        E2E_LAN_UNKNOWN_IP: LAN_UNKNOWN_IP,
        E2E_OFFSITE_IP: OFFSITE_IP,
        // As the api container reaches it, and as the host does — the connector is configured
        // with the first and the spec edits "WordPress" through the second.
        E2E_WP_URL: 'http://wp:8085',
        E2E_WP_HOST_URL: `http://127.0.0.1:${WP_PORT}`,
      },
    },
  );

  console.log(
    `\n✓ e2e:compose passed against the Compose stack: nginx TLS, the real API and Postgres, a` +
      ` pulled model, a Palo Alto User-ID stub and a WordPress stub.\n`,
  );
  teardown();
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n✗ e2e:compose failed: ${e.message}\n`);
  if (process.env.KEEP_STACK !== '1') compose(['logs', '--tail', '60']);
  teardown();
  process.exit(1);
});
