import { z } from 'zod';
export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16).default('dev-secret-change-me-please'),
  PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  OIDC_ISSUER: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_REDIRECT_URI: z.string().optional(),
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
  MODEL_DISABLED: z.coerce.boolean().default(false),
  WATCH_DIR: z.string().optional(),
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
  // L6: AES-256-GCM key for connector configs at rest. Production sets a real
  // key (`openssl rand -hex 32`); dev/test fall back to an all-zero key.
  CONNECTOR_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .default('00'.repeat(32)),
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
