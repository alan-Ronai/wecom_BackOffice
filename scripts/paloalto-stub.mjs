#!/usr/bin/env node
/**
 * A stand-in for the PAN-OS XML API, for the Compose end-to-end stack (`pnpm e2e:compose`).
 *
 * The API's LAN fallback (`apps/api/src/modules/auth/paloalto.ts`) asks the firewall who is at an
 * IP address with exactly one operational command:
 *
 *   POST {scheme}://{PALOALTO_HOST}/api/
 *   content-type: application/x-www-form-urlencoded
 *   type=op&key={PALOALTO_API_KEY}&cmd=<show><user><ip-user-mapping><ip>10.44.0.7</ip></ip-user-mapping></user></show>
 *
 * and reads `response.result.entry.user` out of the answer. `key` travels in the body rather than
 * the query string so the credential never reaches the firewall's access log; PAN-OS itself takes
 * either, so this stub reads both and records which one was used — `GET /_control/state` reports
 * whether any call put the key in a query string, which is the assertion
 * `apps/web/e2e/compose/paloalto-identity.spec.ts` makes about the deployed API.
 *
 * It is deliberately a sibling of `apps/api/test/helpers/l3/paloalto.ts` (the in-process stub the
 * integration tests use) rather than a rewrite of it: that one is a TypeScript module a vitest
 * worker imports, this one is a standalone process with no dependencies, so it can run as a
 * container in `deploy/docker-compose.e2e.yml` from a bare `node:22-alpine` with the file
 * bind-mounted. The XML both emit is the same shape.
 *
 * Usage:
 *   node scripts/paloalto-stub.mjs
 *
 * Environment:
 *   PALOALTO_STUB_PORT       listen port (default 8086)
 *   PALOALTO_STUB_HOST       bind address (default 0.0.0.0 — it is reached from another container)
 *   PALOALTO_STUB_KEY        the XML API key calls must present (default `e2e-panos-key`)
 *   PALOALTO_STUB_MAPPINGS   seed mappings, `ip=DOMAIN\user` separated by commas or newlines
 *   PALOALTO_STUB_TLS_CERT   PEM certificate — set with …_TLS_KEY to serve HTTPS instead of HTTP
 *   PALOALTO_STUB_TLS_KEY    PEM private key
 *
 * Control plane (never part of PAN-OS; this is how a spec arranges the firewall's answers):
 *   GET  /_control/state       → { mappings, calls, keyInQuery }
 *   POST /_control/mappings    ← { "10.44.0.7": "WECOM\\e2e.agent", "10.44.0.9": null }  (merge)
 *   POST /_control/reset       → forget every mapping and every recorded call
 */
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.PALOALTO_STUB_PORT ?? 8086);
const HOST = process.env.PALOALTO_STUB_HOST ?? '0.0.0.0';
const KEY = process.env.PALOALTO_STUB_KEY ?? 'e2e-panos-key';

/** ip → `DOMAIN\user` (or a bare user name). A `null` value means "this IP is known to be unknown". */
const mappings = new Map();
/** Every `type=op` lookup, in order, for a spec to assert on. */
const calls = [];
/** True once any call has put the API key in the query string — see the header comment. */
let keyInQuery = false;

/** `10.44.0.7=WECOM\e2e.agent, 10.44.0.9=` → two entries, the second one null. */
function parseMappings(raw) {
  const out = [];
  for (const pair of (raw ?? '').split(/[,\n]/)) {
    const line = pair.trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const ip = line.slice(0, eq).trim();
    const user = line.slice(eq + 1).trim();
    if (ip) out.push([ip, user || null]);
  }
  return out;
}
for (const [ip, user] of parseMappings(process.env.PALOALTO_STUB_MAPPINGS)) mappings.set(ip, user);

const xmlEscape = (s) =>
  String(s).replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c],
  );

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

function xml(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/xml; charset=utf-8' });
  res.end(`<?xml version="1.0"?>\n${body}`);
}
function json(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://paloalto-stub');
  const raw = await readBody(req);

  /* ── control plane ────────────────────────────────────────────────────── */
  if (url.pathname.startsWith('/_control/')) {
    if (url.pathname === '/_control/state')
      return json(res, { mappings: Object.fromEntries(mappings), calls, keyInQuery });
    if (url.pathname === '/_control/mappings' && req.method === 'POST') {
      let patch;
      try {
        patch = JSON.parse(raw || '{}');
      } catch {
        return json(res, { error: 'body is not JSON' }, 400);
      }
      for (const [ip, user] of Object.entries(patch)) mappings.set(ip, user ?? null);
      return json(res, { mappings: Object.fromEntries(mappings) });
    }
    if (url.pathname === '/_control/reset' && req.method === 'POST') {
      mappings.clear();
      calls.length = 0;
      keyInQuery = false;
      return json(res, { ok: true });
    }
    return json(res, { error: 'unknown control endpoint' }, 404);
  }

  /* ── the PAN-OS XML API ───────────────────────────────────────────────── */
  if (!/^\/api\/?$/.test(url.pathname))
    return xml(res, '<response status="error"><msg>not found</msg></response>', 404);

  const body = new URLSearchParams(raw);
  const param = (k) => body.get(k) ?? url.searchParams.get(k);
  if (url.searchParams.has('key')) keyInQuery = true;

  // `type=keygen` is how an operator mints the key in the first place. It is the one call that
  // cannot present one, so it is answered before the key check.
  if (param('type') === 'keygen')
    return xml(res, `<response status="success"><result><key>${xmlEscape(KEY)}</key></result></response>`);

  if (param('key') !== KEY)
    return xml(res, '<response status="error" code="403"><msg>Invalid credentials.</msg></response>', 403);

  if (param('type') !== 'op')
    return xml(res, '<response status="error"><msg>unsupported type</msg></response>', 400);

  const cmd = param('cmd') ?? '';
  const m = /<ip>([^<]+)<\/ip>/.exec(cmd);
  if (!/<show>\s*<user>\s*<ip-user-mapping>/.test(cmd) || !m)
    return xml(res, '<response status="error"><msg>unsupported command</msg></response>', 400);

  const ip = m[1];
  const user = mappings.get(ip) ?? null;
  calls.push({ ip, user, at: new Date().toISOString() });

  // PAN-OS answers a successful lookup of an IP it has no mapping for with an empty result — not
  // with an error — and the client reads that as "stay unauthenticated".
  if (!user) return xml(res, '<response status="success"><result></result></response>');

  return xml(
    res,
    `<response status="success"><result><entry><ip>${xmlEscape(ip)}</ip><vsys>vsys1</vsys><type>GP</type>` +
      `<user>${xmlEscape(user)}</user><idle_timeout>3600</idle_timeout><timeout>3600</timeout></entry>` +
      `<count>1</count></result></response>`,
  );
}

const listener = (req, res) => {
  handle(req, res).catch((e) => {
    console.error(`paloalto-stub: ${e?.stack ?? e}`);
    if (!res.headersSent) xml(res, '<response status="error"><msg>stub failure</msg></response>', 500);
  });
};

const certPath = process.env.PALOALTO_STUB_TLS_CERT;
const keyPath = process.env.PALOALTO_STUB_TLS_KEY;
const tls = !!(certPath && keyPath);
const server = tls
  ? https.createServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, listener)
  : http.createServer(listener);

server.listen(PORT, HOST, () => {
  // The first line is machine-readable: `scripts/e2e-compose.mjs` picks the origin up from it.
  console.log(`PALOALTO_STUB_URL=${tls ? 'https' : 'http'}://${HOST}:${PORT}`);
  console.log(
    `paloalto-stub: ${mappings.size} seeded mapping(s)${
      mappings.size ? `: ${[...mappings].map(([i, u]) => `${i}→${u ?? '(unknown)'}`).join(', ')}` : ''
    }`,
  );
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
