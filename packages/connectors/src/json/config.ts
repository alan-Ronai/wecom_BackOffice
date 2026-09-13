import { z } from 'zod';

export const JsonConfigSchema = z
  .object({
    /** Absolute file path on the server. */
    path: z.string().min(1).optional(),
    /** Inline document text; used instead of `path` (tests, small data sets). */
    inline: z.string().optional(),
    format: z.enum(['json', 'csv']),
    mapping: z.object({
      id: z.string().optional(),
      title: z.string().min(1),
      description: z.string().optional(),
      category: z.string().optional(),
      wave: z.string().optional(),
      priority: z.string().optional(),
      /** Column holding newline-separated step lines. */
      steps: z.string().optional(),
    }),
  })
  .refine((c) => c.path || c.inline, { message: 'path or inline is required' });
export type JsonConfig = z.infer<typeof JsonConfigSchema>;
