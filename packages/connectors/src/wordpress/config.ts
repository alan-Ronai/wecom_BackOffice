import { z } from 'zod';

/**
 * Every field carries a `.describe()` of up to three newline-separated parts — title,
 * description, example — which `describeConfigSchema` in the API publishes as the JSON-Schema
 * `title`/`description`/`examples` the connector wizard renders. The labels live here, beside
 * the validation they belong to, so a field added to this object arrives in the form with its
 * label and its rules together rather than as an unnamed input.
 */
export const WpConfigSchema = z.object({
  baseUrl: z
    .string()
    .url()
    .transform((u) => u.replace(/\/+$/, ''))
    .describe('כתובת האתר\nכתובת הבסיס של אתר ה-WordPress, ללא /wp-json\nhttps://kb.example.com'),
  username: z.string().min(1).describe('שם משתמש\nמשתמש WordPress שה-Application Password שייך לו'),
  applicationPassword: z
    .string()
    .min(1)
    .describe('סיסמת אפליקציה\nApplication Password מתוך פרופיל המשתמש ב-WordPress'),
  postTypes: z
    .array(z.string().min(1))
    .min(1)
    .default(['posts'])
    .describe('סוגי תוכן\nנתיבי ה-REST של סוגי התוכן לייבוא, מופרדים בפסיק\nposts, pages'),
  /** WP category slug -> KB category (sim|tech|billing|plans|intl|ops) */
  categoryMap: z
    .record(z.string())
    .default({})
    .describe('מיפוי קטגוריות\nקטגוריית WordPress = קטגוריה במאגר (sim, tech, billing, plans, intl, ops)'),
  webhookSecret: z
    .string()
    .min(8)
    .describe('סוד ה-webhook\nלפחות 8 תווים; אותו ערך מוגדר בתוסף שבאתר (openssl rand -hex 16)'),
});
export type WpConfig = z.infer<typeof WpConfigSchema>;
