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
 * It doesn't. It connects *through* something that is.
 *
 * deploy/nginx.conf sets `X-Forwarded-For $remote_addr` — it replaces the header rather than
 * appending to it — so `req.ip` is the address the connection to nginx actually came from and no
 * header a browser sends can change it. (It used to append, and `lan-identity.spec.ts` used to
 * exploit that by setting `X-Forwarded-For: 10.44.0.7` from the host. That was also how a real
 * client on the pilot LAN could have become any user the firewall maps; the note about it in
 * docs/operations.md is now a description of a fix.)
 *
 * So the gate gives itself real addresses. `deploy/docker-compose.e2e.yml` declares two extra
 * networks — `lan` (10.44.0.0/24, inside the /16 `PALOALTO_SUBNETS` names) and `offsite`
 * (198.51.100.0/24) — attaches nginx to both, and runs three one-file containers of
 * `scripts/lan-forwarder.mjs`, each pinned to a fixed address and publishing 443 to the host:
 *
 *   https://localhost:8444  →  10.44.0.7      the LAN user the firewall maps
 *   https://localhost:8445  →  10.44.0.9      on the LAN, unknown to the firewall
 *   https://localhost:8446  →  198.51.100.7   off the LAN entirely
 *   https://localhost:8443  →  the docker bridge gateway, i.e. this machine as it really is
 *
 * A Playwright context simply picks a `baseURL`. nginx sees the forwarder's address as
 * `$remote_addr`, writes exactly that into `X-Forwarded-For`, and the API identifies the request
 * the way it would identify an agent's laptop. Nothing forges a header anywhere in this gate —
 * and one spec asserts that a browser which tries to is still seen as what it is.
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
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runPlaywright } from './lib/playwright-run.mjs';
import { assertPortsFree as assertFree } from './lib/ports.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOY = join(ROOT, 'deploy');
const ENV_SOURCE = join(DEPLOY, 'e2e.env');
const ENV_TARGET = join(DEPLOY, '.env'); // what `env_file:` in docker-compose.yml reads
const ENV_BACKUP = join(DEPLOY, '.env.before-e2e');

/**
 * Its own compose project, so `down -v` can never take an operator's pilot stack (which uses the
 * `name: wecom-kb` declared in docker-compose.yml) and its database volume with it.
 *
 * It is also what scopes the *images*. `deploy/docker-compose.yml` tags them
 * `${COMPOSE_PROJECT_NAME}-api`/`-web`/`-backup`; they used to be unprefixed, so every project
 * built from that file wrote the same three tags and any `up --build` elsewhere on the machine —
 * a second clone, a walkthrough — silently replaced the images this run was using, mid-run. The
 * project name was already careful about the volumes; the tags were the hole left in it.
 */
const PROJECT = process.env.E2E_COMPOSE_PROJECT ?? 'wecom-kb-e2e';

/**
 * Fixed, not configurable: `deploy/e2e.env` pins WEB_HTTPS_PORT/WEB_HTTP_PORT to 127.0.0.1:8443/8080, and compose
 * concatenates `ports` across overlay files rather than replacing them — a second mapping would
 * publish the stack twice instead of moving it.
 */
const HTTPS_PORT = 8443;
const HTTP_PORT = 8080;
const PANOS_PORT = 8186; // the stub's control plane, published for the specs
const WP_PORT = 8085; // the WordPress stub, published so a spec can edit a post "in WordPress"
/**
 * The simulated clients — see the header comment. Each is a `lan-forwarder` container with a
 * fixed address on a compose network, so the port a browser opens decides the address nginx (and
 * therefore `req.ip`) sees. The values must match deploy/e2e.env, which is what publishes them.
 */
const LAN_CLIENT_PORT = 8444;
const LAN_UNKNOWN_CLIENT_PORT = 8445;
const OFFSITE_CLIENT_PORT = 8446;
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
 * A leftover `deploy/.env.before-e2e` is a *previous run's* rescued `deploy/.env` — the operator's
 * real one, with their real secrets — that never got put back: a SIGKILL, a crash, or a
 * `KEEP_STACK=1` run nobody tore down. This used to `rm -f` it and carry on, which destroyed the
 * only copy and left the e2e config installed as `deploy/.env` permanently. Refuse instead, and
 * say which file is which, because from the outside they are indistinguishable.
 */
function assertNoLeftoverEnvBackup() {
  if (!existsSync(ENV_BACKUP)) return;
  throw new Error(
    `${ENV_BACKUP} already exists — a previous e2e:compose run did not finish (SIGKILL, a crash,\n` +
      '  or KEEP_STACK=1 with no teardown), and that file is the deploy/.env it moved aside. It holds\n' +
      '  real secrets; this run will not overwrite or delete it.\n\n' +
      '  To recover, from the repo root:\n' +
      `    docker compose -p ${PROJECT} -f ${COMPOSE_FILES.join(' -f ')} down -v   # if a stack is still up\n` +
      `    mv ${ENV_BACKUP} ${ENV_TARGET}   # put the real deploy/.env back (it overwrites the e2e copy)\n` +
      '  Then re-run this gate. If deploy/.env is the one you want to keep and the backup is stale,\n' +
      `    rm ${ENV_BACKUP}\n` +
      '  but read it first — the two files look alike and only one has your production secrets.',
  );
}

/**
 * The key `deploy/e2e.env` uses to name itself as the end-to-end configuration, and the escape
 * hatch that lets this runner past the refusal it triggers.
 *
 * The configuration this gate installs is not a deployment: its SESSION_SECRET is committed to
 * git, its Postgres password is `e2e`, and it runs `AUTH_FALLBACK=paloalto` pointed at a stub. If
 * a run is hard-killed that file stays at `deploy/.env`, and nothing about the resulting stack
 * looks wrong from the outside — so the file says what it is, and `deploy/smoke.sh` refuses to
 * certify a stack configured from it unless `WECOM_E2E_RUNNER=1` is set, which only this script
 * sets, and the API's own production config check refuses to boot on `NODE_ENV=production`
 * together with this key unless `WECOM_E2E_RUNNER=1` reaches it (docker-compose.e2e.yml sets it).
 */
const E2E_SENTINEL = 'WECOM_E2E_STACK';
const SENTINEL_RE = /^[ \t]*WECOM_E2E_STACK[ \t]*=[ \t]*1[ \t]*$/m;

/**
 * If the sentinel is ever dropped from `deploy/e2e.env`, the refusal in `deploy/smoke.sh` silently
 * stops protecting anything — and a check that has quietly stopped working is worse than none.
 * Fail here, where it is one line to fix, rather than on the VM months later.
 */
function assertEnvSourceIsMarked() {
  if (SENTINEL_RE.test(readFileSync(ENV_SOURCE, 'utf8'))) return;
  throw new Error(
    `${ENV_SOURCE} no longer sets ${E2E_SENTINEL}=1.\n` +
      '  That line is how a deploy/.env left behind by a killed run is recognised as the e2e\n' +
      "  configuration rather than a deployment's — deploy/smoke.sh refuses to certify a stack\n" +
      '  built from it. Put it back, or this gate is installing an unmarked config over\n' +
      "  an operator's deploy/.env.",
  );
}

/**
 * `deploy/.env` is what `env_file:` reads, and an operator's own may be sitting there. Move it
 * aside rather than overwrite it, and put it back on the way out.
 */
function swapEnv() {
  assertNoLeftoverEnvBackup();
  assertEnvSourceIsMarked();
  if (existsSync(ENV_TARGET)) {
    renameSync(ENV_TARGET, ENV_BACKUP);
    // Immediately, and not after the copy below. `envSwapped` is what teardown consults to decide
    // whether there is anything to put back; between this rename and that assignment the
    // operator's deploy/.env existed *only* as the backup, so a copyFileSync that threw (a full
    // disk, a read-only mount, a missing e2e.env) left them with no deploy/.env at all and a
    // restoreEnv() that returned immediately.
    envSwapped = true;
    console.log(`  deploy/.env moved aside to ${ENV_BACKUP}`);
  }
  // True before the copy for the same reason from the other side: a copy that throws part-written
  // leaves a truncated deploy/.env that teardown still has to remove.
  envSwapped = true;
  copyFileSync(ENV_SOURCE, ENV_TARGET);
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

/**
 * See scripts/lib/ports.mjs: `lsof`, then `ss`, then an actual bind — so that a runner without
 * `lsof` (a plain Ubuntu image, a GitHub runner) cannot read every port as free and fail later as
 * an unexplained collision inside docker.
 */
function assertPortsFree() {
  return assertFree(
    [
      ['nginx https', HTTPS_PORT],
      ['nginx http', HTTP_PORT],
      ['paloalto stub control', PANOS_PORT],
      ['wordpress stub', WP_PORT],
      ['lan client', LAN_CLIENT_PORT],
      ['lan client (unknown address)', LAN_UNKNOWN_CLIENT_PORT],
      ['offsite client', OFFSITE_CLIENT_PORT],
    ],
    {
      intro: 'ports already in use — the pilot stack, or a leftover run:',
      remedy: '  stop whatever holds them (the ports are fixed by deploy/e2e.env) and retry',
    },
  );
}

function teardown() {
  if (tornDown) return;
  tornDown = true;
  if (process.env.KEEP_STACK === '1') {
    console.log(
      `\nKEEP_STACK=1 — leaving the stack up:\n` +
        `  app        ${BASE_URL}\n` +
        `  as a LAN client   https://localhost:${LAN_CLIENT_PORT} (arrives as ${LAN.ip})\n` +
        `  …unknown to it    https://localhost:${LAN_UNKNOWN_CLIENT_PORT} (${LAN_UNKNOWN_IP})\n` +
        `  …from offsite     https://localhost:${OFFSITE_CLIENT_PORT} (${OFFSITE_IP})\n` +
        `  admin      ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}\n` +
        `  firewall   http://127.0.0.1:${PANOS_PORT}/_control/state\n` +
        `  wordpress  http://127.0.0.1:${WP_PORT}/wp-json/wp/v2/posts/101\n` +
        `  logs       docker compose -p ${PROJECT} logs\n` +
        `  down       docker compose -p ${PROJECT} -f ${COMPOSE_FILES.join(' -f ')} down -v\n` +
        `  (deploy/.env is still the e2e one — it sets ${E2E_SENTINEL}=1, so deploy/smoke.sh will\n` +
        `   refuse to certify anything brought up from it; ${ENV_BACKUP} holds what was there,\n` +
        '   and `mv` it back when you are done here)\n',
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
  // Before anything is built, minted or started: a leftover backup means an operator's real
  // deploy/.env is sitting unrestored, and nothing here should run until they have it back.
  assertNoLeftoverEnvBackup();
  // This process, and everything it spawns, is the one context in which a deploy/.env marked
  // `WECOM_E2E_STACK=1` is expected — see the comment on E2E_SENTINEL.
  process.env.WECOM_E2E_RUNNER = '1';
  ensureCerts();
  swapEnv();
  /**
   * W-8: every service in the base compose file caps its container log. Asserted here rather
   * than only in CI because it is the cheapest possible check — `docker compose config` renders
   * the file and nothing is started — and because the failure it catches is a *new* service that
   * never referenced the shared anchor, which is silent until a pilot VM's disk fills. Run after
   * `swapEnv()` so deploy/.env is in place for the api service's `env_file:`.
   */
  if (spawnSync('bash', [join(DEPLOY, 'compose-check.sh')], { stdio: 'inherit' }).status !== 0)
    throw new Error('deploy/compose-check.sh failed — see above (W-8: container logs are capped)');
  // `./backups` is bind-mounted read-only into the api container; compose would create it as
  // root, which is a surprise to find in a worktree afterwards.
  mkdirSync(join(DEPLOY, 'backups'), { recursive: true });
  // Any stack left by a previous run, volumes included: the seed below assumes an empty database.
  compose(['down', '-v', '--remove-orphans'], { stdio: 'ignore' });
  await assertPortsFree();

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
    /**
     * 30 minutes, doubled from 15. Preflight's `down -v` destroys the `ollama` volume — which is
     * deliberate and load-bearing: a cached volume would satisfy the two-tag assertion below
     * without `ollama-pull` having done anything, which is precisely the W-3 bug — so **both
     * models are fetched from scratch on every run**. That is now ~671 MB rather than ~443 MB,
     * because `EMBED_MODEL` moved to the 768-dimensional `nomic-embed-text` so the embedding path
     * can actually store a vector (deploy/e2e.env). The old budget was ~30 s per 10 MB of
     * headroom; on a 1–4 MB/s link the larger pull ran past it and the gate failed here with the
     * stack healthy and nothing wrong with it.
     */
    { timeoutMs: 1_800_000, everyMs: 5_000 },
  );
  const pullCode = spawnSync('docker', ['inspect', '-f', '{{.State.ExitCode}}', pullId], {
    encoding: 'utf8',
  }).stdout?.trim();
  if (pullCode !== '0') {
    compose(['logs', '--tail', '20', 'ollama-pull']);
    throw new Error(`ollama-pull exited ${pullCode}`);
  }
  /**
   * W-3: exit 0 is not the assertion. `ollama-pull` exited 0 on every install that shipped with
   * `EMBED_MODEL` configured and never fetched — one tag in `ollama list`, no error anywhere, and
   * search silently demoted to lexical ranking. `deploy/e2e.env` configures two different tags so
   * this can be asked, and this asks it.
   */
  const listing = composeOut(['exec', '-T', 'ollama', 'ollama', 'list']);
  const present = listing
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(/\s+/)[0])
    .filter(Boolean);
  const envText = readFileSync(ENV_SOURCE, 'utf8');
  for (const key of ['MODEL_NAME', 'EMBED_MODEL']) {
    const tag = envText.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim();
    if (!tag) throw new Error(`deploy/e2e.env sets no ${key} — the W-3 coverage needs both`);
    if (!present.includes(tag))
      throw new Error(
        `${key}='${tag}' is not in \`ollama list\` (${present.join(', ') || 'nothing'}) — ` +
          'deploy/ollama-pull.sh did not pull it',
      );
  }
  console.log(`✓ both configured model tags are pulled: ${present.join(', ')}`);

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
  // The simulated clients. Each must reach the *API* through nginx, not merely accept a socket:
  // a forwarder whose upstream name does not resolve answers and then closes, which would
  // otherwise surface four specs later as a navigation failure.
  for (const [label, port] of [
    ['10.44.0.7 (the LAN user)', LAN_CLIENT_PORT],
    ['10.44.0.9 (on the LAN, unknown)', LAN_UNKNOWN_CLIENT_PORT],
    ['198.51.100.7 (offsite)', OFFSITE_CLIENT_PORT],
  ])
    await waitFor(
      `a client at ${label} reaches the API through nginx`,
      () => curlJson(`https://localhost:${port}/api/v1/system/health`).db === true,
      { timeoutMs: 60_000 },
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
        // The four front doors. Which one a context opens *is* the address it arrives from;
        // there is no header involved. See the header comment.
        E2E_LAN_BASE_URL: `https://localhost:${LAN_CLIENT_PORT}`,
        E2E_LAN_UNKNOWN_BASE_URL: `https://localhost:${LAN_UNKNOWN_CLIENT_PORT}`,
        E2E_OFFSITE_BASE_URL: `https://localhost:${OFFSITE_CLIENT_PORT}`,
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
