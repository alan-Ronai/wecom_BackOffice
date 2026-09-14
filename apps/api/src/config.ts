import { z } from 'zod';

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
   * Comma-separated host allowlist for outbound connector HTTP (WordPress `baseUrl`).
   * Empty means "any public host"; private, loopback and link-local ranges are always
   * refused unless listed here explicitly.
   */
  CONNECTOR_HOST_ALLOWLIST: z.string().default(''),
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
   * §5 / item 18: an empty allowlist means "any public host", so a connector with a
   * `baseUrl` an editor typed — or one an attacker who reached the connector API supplied — is
   * an outbound request to anywhere the VM can see. The link-local/metadata refusal in
   * `@wecom/connectors`' guards is unconditional, but nothing else is. A deployment must decide
   * this explicitly, exactly as it must decide SESSION_SECRET. `*` is the written-down way to say
   * "yes, really, any public host".
   */
  if (!c.CONNECTOR_HOST_ALLOWLIST.trim())
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CONNECTOR_HOST_ALLOWLIST'],
      message:
        'CONNECTOR_HOST_ALLOWLIST is empty, which allows outbound connector requests to any public host — list the connector hosts (e.g. `wp.wecom.local`), or set it to `*` to accept that risk deliberately',
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

/** Resolves `TRUST_PROXY` into the value Fastify's `trustProxy` option accepts. */
export const trustProxySetting = (config: Config): boolean | string[] => {
  const raw = config.TRUST_PROXY?.trim();
  if (!raw) return config.NODE_ENV === 'production';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean); // trusted proxy addresses / CIDRs
};

export const loadConfig = (over: Partial<Config> = {}): Config =>
  ConfigSchema.parse({ ...process.env, ...over });
