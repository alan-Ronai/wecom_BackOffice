import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PreferencesPutSchema, PreferencesSchema } from '@wecom/shared';
import { withTransaction } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';

export default async function routes(app: FastifyInstance) {
  app.get(
    '/me/preferences',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['preferences'], response: { 200: PreferencesSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const r = await app.db.query('select prefs from user_preferences where user_id=$1', [user.id]);
      return PreferencesSchema.parse(r.rowCount ? r.rows[0].prefs : {});
    },
  );

  app.put(
    '/me/preferences',
    {
      config: { requires: ['docs.read'] },
      schema: {
        tags: ['preferences'],
        body: PreferencesPutSchema,
        response: { 200: PreferencesSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const body = req.body as z.infer<typeof PreferencesPutSchema>;
      return withTransaction(app.db, async (tx) => {
        const r = await tx.query(
          `insert into user_preferences(user_id, prefs) values ($1,$2)
           on conflict (user_id) do update set prefs = user_preferences.prefs || excluded.prefs returning prefs`,
          [user.id, JSON.stringify(body)],
        );
        return PreferencesSchema.parse(r.rows[0].prefs);
      });
    },
  );
}
