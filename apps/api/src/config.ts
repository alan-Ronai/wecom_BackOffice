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
  TRASH_DAYS: z.coerce.number().int().min(1).default(30), // L2: soft-delete retention window
});
export type Config = z.infer<typeof ConfigSchema>;
export const loadConfig = (over: Partial<Config> = {}): Config =>
  ConfigSchema.parse({ ...process.env, ...over });
