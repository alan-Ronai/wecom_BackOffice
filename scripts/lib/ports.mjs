/**
 * "Is anything already listening on this TCP port?", asked so that a *missing tool* can never be
 * mistaken for a free port.
 *
 * Both e2e gates used to answer it with one `lsof -ti tcp:<port> -sTCP:LISTEN`, and trusted an
 * empty answer. That is wrong in three ways an operator never sees:
 *
 *   1. `lsof` is not installed on a plain Ubuntu image or a GitHub runner. `spawnSync` returns
 *      ENOENT, `stdout` is empty, and every port reads "free" — the guard is not weakened, it is
 *      *gone*, and the run fails later as a port collision inside docker with no explanation.
 *   2. Unprivileged `lsof` cannot see sockets owned by another user, and `docker-proxy` runs as
 *      root. A stack published by a different user, or by Docker Desktop's VM, is invisible.
 *   3. A non-zero exit from `lsof` means both "nothing is listening" and "I could not tell",
 *      and the old code could not distinguish them.
 *
 * So this asks up to three ways and takes the union. The first two name the culprit, which is what
 * the operator actually needs; the last cannot name anything but is always available and is the
 * one that makes a "free" answer mean something:
 *
 *   lsof -ti tcp:<port> -sTCP:LISTEN   pids, when it is installed and can see them
 *   ss -ltn                            same on any modern Linux, where lsof often is not
 *   net.createServer().listen()        bind it and see — no tool, no privileges, no parsing
 *
 * The bind probe is the authority on *whether* a port is taken: SO_REUSEADDR (which node sets)
 * still refuses a bind over an active listener, so EADDRINUSE is a real answer. It is tried on
 * 0.0.0.0 and then on 127.0.0.1, because a listener on either blocks the other and published
 * docker ports and loopback-only servers differ in which they hold.
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

/**
 * pids holding `port`, or `null` when lsof could not answer — which is not the same as "none",
 * and is the distinction the old guard lost. `status === null` is ENOENT (no such binary).
 */
function viaLsof(port) {
  const r = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (r.error || r.status === null) return null;
  // lsof exits 1 for "found nothing", which is an answer; anything above that is a failure to look.
  if (r.status > 1) return null;
  return (r.stdout ?? '').trim().split('\n').filter(Boolean);
}

/**
 * The same question for `ss`, which ships in iproute2 and is on essentially every Linux that has
 * no lsof. `-ltnH` is listening/tcp/numeric/no-header; the local address is the 4th column and
 * ends in `:<port>` (`0.0.0.0:8443`, `[::]:8443`, `127.0.0.1:8443`, `*:8443`).
 */
function viaSs(port) {
  const r = spawnSync('ss', ['-ltnH'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return (r.stdout ?? '')
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[3] ?? '')
    .filter((addr) => addr.endsWith(`:${port}`));
}

/** Can this process bind `host:port`? Resolves to the errno when it cannot, `null` when it can. */
function tryBind(port, host) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (e) => resolve(e.code ?? 'EUNKNOWN'));
    server.once('listening', () => server.close(() => resolve(null)));
    // `exclusive` so a bind is never shared with another listener in this process's cluster.
    server.listen({ port, host, exclusive: true });
  });
}

/**
 * True when something already holds `port`. Only EADDRINUSE counts: EACCES is "this process may
 * not bind here" (a privileged port), which says nothing about whether the port is free.
 */
async function viaBindProbe(port) {
  for (const host of ['0.0.0.0', '127.0.0.1']) {
    if ((await tryBind(port, host)) === 'EADDRINUSE') return true;
  }
  return false;
}

/**
 * Inspects one port every way available.
 * @returns {Promise<{busy: boolean, detail: string}>} `detail` names the holder when a tool could.
 */
export async function inspectPort(port) {
  const pids = viaLsof(port);
  if (pids?.length) return { busy: true, detail: `held by pid ${pids.join(', ')}` };

  const sockets = viaSs(port);
  if (sockets?.length) return { busy: true, detail: `listening on ${sockets.join(', ')} (ss)` };

  // Both tools were absent, blind, or saw nothing. The bind probe is the one that decides.
  if (await viaBindProbe(port)) {
    const blind = pids === null && sockets === null;
    return {
      busy: true,
      detail: blind
        ? 'in use — a bind probe was refused (neither lsof nor ss is available here, so the ' +
          'holder cannot be named; try `sudo lsof -i :PORT` or `docker ps`)'
        : 'in use — a bind probe was refused, but no listener is visible to this user ' +
          "(another user's process, or docker-proxy running as root)",
    };
  }
  return { busy: false, detail: '' };
}

/**
 * Throws unless every one of `entries` is free.
 * @param {Array<[string, number]>} entries `[label, port]` pairs.
 * @param {{ intro: string, remedy: string }} message the two halves of the error around the list.
 */
export async function assertPortsFree(entries, { intro, remedy }) {
  const busy = [];
  for (const [name, port] of entries) {
    const { busy: taken, detail } = await inspectPort(port);
    if (taken) busy.push(`  :${port} (${name}) ${detail}`);
  }
  if (busy.length) throw new Error(`${intro}\n${busy.join('\n')}\n${remedy}`);
}
