import { z } from 'zod';

export const WpConfigSchema = z.object({
  baseUrl: z
    .string()
    .url()
    .transform((u) => u.replace(/\/+$/, '')),
  username: z.string().min(1),
  applicationPassword: z.string().min(1),
  postTypes: z.array(z.string().min(1)).min(1).default(['posts']),
  /** WP category slug -> KB category (sim|tech|billing|plans|intl|ops) */
  categoryMap: z.record(z.string()).default({}),
  webhookSecret: z.string().min(8),
});
export type WpConfig = z.infer<typeof WpConfigSchema>;
