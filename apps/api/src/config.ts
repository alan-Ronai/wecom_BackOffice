import { z } from 'zod';
import ipaddr from 'ipaddr.js';

/** A parsed CIDR, as `ipaddr.parseCIDR` returns it. */
type Subnet = [ipaddr.IPv4 | ipaddr.IPv6, number];

/** Dev-only defaults that must never reach production (see `productionGuard`). */
export const DEV_SESSION_SECRET = 'dev-secret-change-me-please';
export const DEV_CONNECTOR_KEY = '00'.repeat(32);

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
   * proxy. `true`/`false`, or a comma-separated list of trusted proxy addresses /
   * CIDRs (the safest production value: a forged header from a client that reaches
   * the API directly then cannot spoof an IP). Defaults to `true` in production and
   * `false` elsewhere. `req.ip` gates the Palo Alto subnet allowlist, the auth rate
   * limits and the audit/session IP columns.
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
  if (c.NODE_ENV !== 'production') return;
  if (c.SESSION_SECRET === DEV_SESSION_SECRET)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SESSION_SECRET'],
      message: 'SESSION_SECRET is still the development default — set it (`openssl rand -hex 32`)',
    });
  if (c.CONNECTOR_KEY.toLowerCase() === DEV_CONNECTOR_KEY)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CONNECTOR_KEY'],
      message: 'CONNECTOR_KEY is still the all-zero default — set it (`openssl rand -hex 32`)',
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
  const subnets = peers.map((s) => (s.includes('/') ? ipaddr.parseCIDR(s) : null) as Subnet | null);
  const exact = peers.filter((s) => !s.includes('/'));
  return (address, hop) => {
    if (hop >= hops) return false;
    if (exact.includes(address)) return true;
    if (!ipaddr.isValid(address)) return false;
    let addr = ipaddr.parse(address);
    if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress())
      addr = (addr as ipaddr.IPv6).toIPv4Address();
    return subnets.some((net) => net !== null && net[0].kind() === addr.kind() && addr.match(net as never));
  };
};

export const loadConfig = (over: Partial<Config> = {}): Config =>
  ConfigSchema.parse({ ...process.env, ...over });
