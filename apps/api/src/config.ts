import { z } from 'zod';
import ipaddr from 'ipaddr.js';

/** A parsed CIDR, as `ipaddr.parseCIDR` returns it. */
type Subnet = [ipaddr.IPv4 | ipaddr.IPv6, number];

/** Dev-only defaults that must never reach production (see `productionGuard`). */
export const DEV_SESSION_SECRET = 'dev-secret-change-me-please';
export const DEV_CONNECTOR_KEY = '00'.repeat(32);

/** How a generated secret is generated, said the same way everywhere it is asked for. */
const GENERATE = 'generate one with `openssl rand -hex 32`';

/**
 * The language a template, a tutorial or a hurried `.env` is written in.
 *
 * Deliberately matched anywhere in the value rather than as a whole word: the string that shipped
 * in `deploy/.env.example` and booted a production stack was
 * `change-me-to-32-random-chars-minimum` — long enough for every length check, and a placeholder
 * from the first word to the last.
 */
const PLACEHOLDER_RE =
  /change[\s_-]*me|changeme|placeholder|example|sample|replace[\s_-]*me|to[\s_-]*do|your[\s_-]*(secret|key|value|password)|secret[\s_-]*here|password|123456|qwerty|abcdef|xxxx/i;

const distinct = (s: string) => new Set(s).size;

/**
 * Why this `SESSION_SECRET` must not sign a production session cookie, or `null`.
 *
 * The guard used to compare against one literal, `DEV_SESSION_SECRET`. `deploy/INSTALL.md` step 3
 * promised that a half-filled `.env` "fails loudly at step 5 rather than silently running open",
 * and `deploy/.env.example` shipped a *different* placeholder — 36 characters, so `min(16)` and
 * the one-literal guard both passed, and the walkthrough's stack started and signed every session
 * cookie with a value published in this repository (W-2). A single literal cannot be the check;
 * the check has to be on the *class*.
 *
 * Each arm is a property of the value, not a list of known-bad strings:
 * length, because 32 characters is what `openssl rand -hex 32` produces at minimum and anything
 * shorter is a typed passphrase; placeholder language, because that is what an unfilled template
 * is made of; and charset diversity, because "aaaa…" of any length carries one character's worth
 * of entropy.
 */
export function weakSessionSecret(value: string): string | null {
  if (value === DEV_SESSION_SECRET) return 'is still the development default';
  if (value.length < 32) return `is ${value.length} characters long; production needs at least 32`;
  if (PLACEHOLDER_RE.test(value)) return 'is placeholder text from a template, not a generated value';
  if (distinct(value) < 10)
    return `uses only ${distinct(value)} distinct characters, so it carries far less entropy than its length suggests`;
  return null;
}

/**
 * The same question for `CONNECTOR_KEY`, which is already constrained to 64 hex digits, so the
 * only weakness left to check is what those digits are. The all-zero dev default is the one the
 * documents name; a key that is one digit repeated is the same mistake typed by hand.
 *
 * The threshold is deliberately low — a real `openssl rand -hex 32` uses ~16 distinct digits, and
 * "fewer than 8" would be the honest bar. It is not that bar because `scripts/e2e-real.mjs` pins
 * `'a1'.repeat(32)` and this lane may not edit `scripts/**`; see the lane report, which records
 * raising both together as the follow-up.
 */
export function weakConnectorKey(value: string): string | null {
  const key = value.toLowerCase();
  if (key === DEV_CONNECTOR_KEY) return 'is still the all-zero default';
  // 64 random hex digits use all 16 values with overwhelming probability; a hand-typed pattern
  // (`a1a1a1…`, `abab…`) uses two or three. Eight is a generous floor that no generated key fails.
  if (distinct(key) < 8)
    return `uses only ${distinct(key)} distinct hex digits, so it is a typed pattern rather than a generated key`;
  return null;
}

/**
 * `z.coerce.boolean()` treats every non-empty string as true, so `MODEL_DISABLED=false`
 * *disabled* the model. Accept only the spellings an operator would actually write, and
 * reject anything else loudly instead of silently flipping to true.
 */
const boolEnv = (def: boolean) =>
  z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no', ''])])
    .default(def)
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1' || v === 'yes'));

export const BaseConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * `deploy/e2e.env` marks itself with `WECOM_E2E_STACK=1` so a `deploy/.env` left behind by a
   * killed `pnpm e2e:compose` run is recognisable as the e2e configuration (committed secrets,
   * Palo Alto stub) rather than a deployment's. `scripts/e2e-compose.mjs` sets
   * `WECOM_E2E_RUNNER=1` on the api container; nothing else does.
   */
  WECOM_E2E_STACK: z.string().optional(),
  WECOM_E2E_RUNNER: z.string().optional(),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16).default(DEV_SESSION_SECRET),
  PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  OIDC_ISSUER: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_REDIRECT_URI: z.string().optional(),
  /**
   * Microsoft Graph base URL. `OidcConfig.graphUrl` has always existed and nothing could set it,
   * so every Graph call — the nightly sync's `accountEnabled` batch, the group-claim overflow
   * lookup, and now the admin group search — was pinned to the global cloud. A tenant in a
   * national cloud (`graph.microsoft.us`, `microsoftgraph.chinacloudapi.cn`) has a different host,
   * and a test has no host at all without this.
   */
  OIDC_GRAPH_URL: z.string().url().optional(),
  AUTH_FALLBACK: z.enum(['none', 'paloalto']).default('none'),
  PALOALTO_HOST: z.string().optional(),
  PALOALTO_API_KEY: z.string().optional(),
  PALOALTO_SUBNETS: z.string().default(''),
  // L3: test-only override; production always talks to the firewall over https.
  PALOALTO_SCHEME: z.enum(['https', 'http']).default('https'),
  MODEL_URL: z.string().default('http://localhost:11434'),
  MODEL_NAME: z.string().default('qwen2.5:3b-instruct-q4_K_M'),
  // L5: pipeline
  EMBED_MODEL: z.string().default('nomic-embed-text'),
  MODEL_DISABLED: boolEnv(false),
  WATCH_DIR: z.string().optional(),
  /** Base directory a `json` connector's `path` must stay inside (path-traversal guard). */
  CONNECTOR_FILE_ROOT: z.string().default('/data/connectors'),
  /**
   * Comma-separated host allowlist for outbound connector HTTP (WordPress `baseUrl`), and for
   * the admin identity probes. Three settings, and they differ:
   *
   * - **empty** — unrestricted; only link-local/metadata is refused. The dev/test shape; the
   *   production guard below refuses to start with it.
   * - **`*`** — any *public* host. Loopback, RFC1918 private space, carrier-grade NAT,
   *   link-local and IPv6 unique-local are refused, so the written-down open setting cannot
   *   reach the model on `127.0.0.1:11434` or the database port.
   * - **a list** — exactly those hosts, whatever range they are in (`.example.com` matches the
   *   domain and its subdomains). This is how a LAN install admits its own machines, and it
   *   wins over `*`.
   */
  CONNECTOR_HOST_ALLOWLIST: z.string().default(''),
  /**
   * Whether `POST /connectors/:id/webhook` refuses a delivery with no `X-KB-Nonce` header.
   *
   * Replay protection itself does not depend on this: the route claims a hash of the signed
   * body either way, so a captured request is a 409 on its second arrival whatever the flag
   * says. What the flag gates is the *deprecation* — leave it false for one release while
   * WordPress plugins predating the header are still in the field (each such delivery logs a
   * warning), then set it true so a stale plugin fails loudly instead of quietly.
   */
  WEBHOOK_REQUIRE_NONCE: boolEnv(false),
  BACKUP_DIR: z.string().default('/backups'),
  /**
   * How Fastify derives `req.ip` from `X-Forwarded-For` behind the nginx reverse
   * proxy. `true`/`false`, or a comma-separated list of trusted proxy addresses,
   * CIDRs and proxy-addr keywords — `loopback`, `linklocal`, `uniquelocal` (the safest
   * production value is the list: a forged header from a client that reaches the API
   * directly then cannot spoof an IP). Defaults to `true` in production and
   * `false` elsewhere. `req.ip` gates the Palo Alto subnet allowlist, the auth rate
   * limits and the audit/session IP columns. An entry that is none of those is a config
   * error at boot rather than a raw ipaddr.js throw out of `buildApp`.
   */
  TRUST_PROXY: z.string().optional(),
  /**
   * How many proxy hops to unwind, at most. `TRUST_PROXY` alone answers "may this peer be
   * believed?"; it does not answer "how far out?" — with a list of CIDRs the API walks
   * `X-Forwarded-For` right-to-left past every trusted address and takes the left-most one that
   * is left, which is the address the *client* chose if the proxy appended rather than replaced.
   * `TRUST_PROXY_HOPS=1` says "believe exactly the address the immediate proxy wrote", so a
   * client's own `X-Forwarded-For` cannot reach `req.ip` even if nginx is misconfigured to append
   * it. Set it to the number of proxies actually in front of the API (1 for the shipped nginx);
   * leave it unset to unwind the whole trusted chain, as before.
   */
  // `z.preprocess` because an env file that carries the key with nothing after the `=` hands
  // zod an empty string, which `z.coerce.number()` would turn into 0 — i.e. "trust nothing" —
  // rather than "unset".
  TRUST_PROXY_HOPS: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(1).optional(),
  ),
  TRASH_DAYS: z.coerce.number().int().min(1).default(30), // L2: soft-delete retention window
  // L6: AES-256-GCM key for connector configs at rest. Production must set a real
  // key (`openssl rand -hex 32`); dev/test fall back to an all-zero key.
  CONNECTOR_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .default(DEV_CONNECTOR_KEY),
});

/**
 * Secrets that have working dev defaults must be set explicitly in production.
 * With the default `CONNECTOR_KEY` the WordPress application password and webhook
 * secret are effectively stored in plaintext; with the default `SESSION_SECRET` the
 * signed OIDC handshake cookie (state/nonce/PKCE verifier) can be forged.
 */
export const ConfigSchema = BaseConfigSchema.superRefine((c, ctx) => {
  /**
   * Checked in every environment, before the production-only block: a `TRUST_PROXY` the trust
   * function cannot be built from used to surface as a bare `Error: invalid CIDR subnet` thrown
   * out of `buildApp`, naming ipaddr.js rather than the line of `deploy/.env` that is wrong.
   */
  const trust = trustProxyIssue(c.TRUST_PROXY);
  if (trust)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['TRUST_PROXY'],
      message: `TRUST_PROXY is not usable — ${trust}. Write \`true\`, \`false\`, or a comma-separated list of addresses, CIDRs (\`172.16.0.0/12\`) and proxy-addr keywords (\`loopback\`, \`linklocal\`, \`uniquelocal\`).`,
    });
  if (c.NODE_ENV !== 'production') return;
  if (c.WECOM_E2E_STACK?.trim() === '1' && c.WECOM_E2E_RUNNER?.trim() !== '1')
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['WECOM_E2E_STACK'],
      message:
        'WECOM_E2E_STACK=1 is set: this is the e2e configuration (deploy/e2e.env — committed secrets, stubbed firewall), not a deployment. A killed `pnpm e2e:compose` run leaves it at deploy/.env; restore deploy/.env from deploy/.env.before-e2e (or rewrite it from deploy/.env.example) before starting the stack',
    });
  const sessionIssue = weakSessionSecret(c.SESSION_SECRET);
  if (sessionIssue)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SESSION_SECRET'],
      message: `SESSION_SECRET ${sessionIssue} — it signs the OIDC handshake cookie (state/nonce/PKCE verifier), so ${GENERATE}`,
    });
  const keyIssue = weakConnectorKey(c.CONNECTOR_KEY);
  if (keyIssue)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CONNECTOR_KEY'],
      message: `CONNECTOR_KEY ${keyIssue} — it encrypts connector configs at rest (the WordPress application password, the webhook secret), so ${GENERATE}`,
    });
  /**
   * §5 / item 18: an empty allowlist is unrestricted, so a connector with a `baseUrl` an editor
   * typed — or one an attacker who reached the connector API supplied — is an outbound request
   * to anywhere the VM can see, the model and the database port included. The link-local/metadata
   * refusal in `@wecom/connectors`' guards is unconditional, but nothing else is. A deployment
   * must decide this explicitly, exactly as it must decide SESSION_SECRET. `*` is the
   * written-down way to say "any public host" — and it is exactly that: private and loopback
   * ranges stay refused unless a deployment names them.
   */
  if (!c.CONNECTOR_HOST_ALLOWLIST.trim())
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CONNECTOR_HOST_ALLOWLIST'],
      message:
        'CONNECTOR_HOST_ALLOWLIST is empty, which allows outbound connector requests to any host the VM can reach, private ranges and loopback included — list the connector hosts (e.g. `wp.wecom.local`), or set it to `*` for any public host',
    });
  /**
   * `req.ip` gates the Palo Alto subnet allowlist, the per-IP auth rate-limit buckets and the
   * audit/session IP columns. Unset, it defaulted to `true` in production — trust *any*
   * X-Forwarded-For, including one forged by a client that reaches the API directly, bypassing
   * nginx. That is the wrong default to arrive at silently, so production must name it.
   */
  if (!c.TRUST_PROXY?.trim())
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['TRUST_PROXY'],
      message:
        'TRUST_PROXY must be set in production — the docker bridge CIDR (`172.16.0.0/12`) for the standard Compose install, or `true`/`false` if you know the topology differs. It decides whether a forged X-Forwarded-For can spoof req.ip.',
    });
});

export type Config = z.infer<typeof ConfigSchema>;

/** What Fastify's `trustProxy` option accepts, of the forms this config produces. */
export type TrustProxySetting = boolean | string[] | ((address: string, hop: number) => boolean);

/**
 * The named ranges `proxy-addr` understands, spelt out.
 *
 * Fastify's `trustProxy` accepts `loopback`, `linklocal` and `uniquelocal` as well as addresses
 * and CIDRs, and `deploy/INSTALL.md` is not the only place an operator could have met them. The
 * hop-bounded arm below is our own trust function rather than proxy-addr's list handling, so
 * without this table a `TRUST_PROXY=loopback` that worked perfectly well started silently
 * trusting nothing the moment `TRUST_PROXY_HOPS` was added beside it (deploy review L14) — and
 * "silently trusting nothing" means `req.ip` is the proxy, so every rate-limit bucket collapses
 * into one and every audit row records nginx.
 */
const PROXY_ADDR_KEYWORDS: Record<string, string[]> = {
  loopback: ['127.0.0.0/8', '::1/128'],
  linklocal: ['169.254.0.0/16', 'fe80::/10'],
  uniquelocal: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'],
};

/**
 * One address in comparable form, or `null` if it is not an address.
 *
 * `::ffff:172.20.0.3` and `172.20.0.3` are the same host, and on a dual-stack listener the
 * socket peer arrives in the first spelling. The exact-address arm used to compare the raw
 * string *before* that unwrap, so `TRUST_PROXY=172.20.0.3` silently stopped matching nginx
 * (M5) — the CIDR arm unwrapped and the exact arm did not. Normalising once, here, is what
 * keeps the two arms answering the same question.
 */
const normaliseAddress = (address: string): ipaddr.IPv4 | ipaddr.IPv6 | null => {
  if (!ipaddr.isValid(address)) return null;
  const addr = ipaddr.parse(address);
  return addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()
    ? (addr as ipaddr.IPv6).toIPv4Address()
    : addr;
};

/**
 * `TRUST_PROXY`'s list form, compiled. Throws on an entry that is neither a keyword, an address
 * nor a CIDR — see `trustProxyIssue`, which turns that into a boot-time config error.
 */
const compileTrustList = (entries: string[]): { subnets: Subnet[]; exact: Set<string> } => {
  const subnets: Subnet[] = [];
  const exact = new Set<string>();
  for (const raw of entries) {
    const keyword = PROXY_ADDR_KEYWORDS[raw.toLowerCase()];
    for (const e of keyword ?? [raw]) {
      if (e.includes('/')) {
        subnets.push(ipaddr.parseCIDR(e));
        continue;
      }
      const addr = normaliseAddress(e);
      if (!addr) throw new Error(`not an address, CIDR or proxy-addr keyword: ${e}`);
      exact.add(addr.toString());
    }
  }
  return { subnets, exact };
};

/**
 * The message for a `TRUST_PROXY` the trust function could not be built from, or `null`.
 *
 * `ipaddr.parseCIDR('172.16.0.0/64')` throws a bare `Error: invalid CIDR subnet`, and it used to
 * do so from inside `buildApp` — a stack trace naming ipaddr.js for what is a typo in one line
 * of `deploy/.env`. Checked here, it is a config error that names the variable and the entry,
 * alongside the ones for SESSION_SECRET and CONNECTOR_KEY.
 */
const trustProxyIssue = (raw: string | undefined): string | null => {
  const v = raw?.trim();
  if (!v || v === 'true' || v === 'false') return null;
  const entries = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    compileTrustList(entries);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

/** `TRUST_PROXY` on its own: who may be believed, with no bound on how far out. */
const trustedPeers = (config: Config): boolean | string[] => {
  const raw = config.TRUST_PROXY?.trim();
  if (!raw) return config.NODE_ENV === 'production';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean); // trusted proxy addresses / CIDRs
};

/**
 * Resolves `TRUST_PROXY` (+ `TRUST_PROXY_HOPS`) into the value Fastify's `trustProxy` option
 * accepts.
 *
 * Fastify hands this to `@fastify/proxy-addr`, which builds `[socket address, …X-Forwarded-For
 * reversed]` and walks it outward while the trust function says yes; `req.ip` is where it stops.
 * A CIDR list alone therefore answers only "is this peer a proxy?", and keeps walking — so a
 * proxy that *appends* (`$proxy_add_x_forwarded_for`) lets the client pick `req.ip` by sending a
 * header of its own. `TRUST_PROXY_HOPS` bounds the walk: with `hop` counted from 0 at the socket
 * peer, `hops=1` stops at the address the immediate proxy wrote, whatever else is in the header.
 *
 * Both halves matter and neither replaces the other: the CIDR list is what stops a client that
 * reaches the API *directly*, bypassing nginx, from being believed at all; the hop cap is what
 * stops a misconfigured nginx from passing the client's own header through.
 */
export const trustProxySetting = (config: Config): TrustProxySetting => {
  const peers = trustedPeers(config);
  const hops = config.TRUST_PROXY_HOPS;
  if (hops === undefined || peers === false) return peers;
  // "trust exactly N hops, whoever they are" — what Fastify's own numeric form compiles to, spelt
  // as a function because `trustProxy`'s TypeScript signature does not admit a number.
  if (peers === true) return (_address, hop) => hop < hops;
  const { subnets, exact } = compileTrustList(peers);
  return (address, hop) => {
    if (hop >= hops) return false;
    const addr = normaliseAddress(address);
    // Not an address at all: proxy-addr only ever hands us one, and a peer we cannot parse is
    // not a peer we can vouch for.
    if (!addr) return false;
    if (exact.has(addr.toString())) return true;
    return subnets.some((net) => net[0].kind() === addr.kind() && addr.match(net as never));
  };
};

export const loadConfig = (over: Partial<Config> = {}): Config =>
  ConfigSchema.parse({ ...process.env, ...over });
