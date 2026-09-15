import { z } from 'zod';

/** See `wordpress/config.ts` for the `.describe()` convention the wizard's labels come from. */
export const JsonConfigSchema = z
  .object({
    /** Absolute file path on the server. */
    path: z
      .string()
      .min(1)
      .optional()
      .describe('נתיב הקובץ\nנתיב מוחלט על השרת, בתוך CONNECTOR_FILE_ROOT\n/data/connectors/kb.csv'),
    /** Inline document text; used instead of `path` (tests, small data sets). */
    inline: z.string().optional().describe('תוכן ישיר\nבמקום נתיב — תוכן הקובץ עצמו'),
    format: z.enum(['json', 'csv']).describe('פורמט'),
    mapping: z
      .object({
        id: z.string().optional(),
        title: z.string().min(1),
        description: z.string().optional(),
        category: z.string().optional(),
        wave: z.string().optional(),
        priority: z.string().optional(),
        /** Column holding newline-separated step lines. */
        steps: z.string().optional(),
      })
      .describe('מיפוי עמודות\nאילו עמודות בקובץ הן הכותרת, התיאור, הקטגוריה והשלבים'),
  })
  .refine((c) => c.path || c.inline, { message: 'path or inline is required' });
export type JsonConfig = z.infer<typeof JsonConfigSchema>;
