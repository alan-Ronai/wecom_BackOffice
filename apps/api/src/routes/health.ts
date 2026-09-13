import type { FastifyInstance } from 'fastify';
import { HealthResponseSchema } from '@wecom/shared';
import { VERSION } from '@wecom/shared';
const started = Date.now();
export default async function routes(app: FastifyInstance) {
  app.get('/system/health', { schema: { tags: ['system'], response: { 200: HealthResponseSchema } } }, async () => {
    let db = false;
    try { await app.db.query('select 1'); db = true; } catch { db = false; }
    return { ok: db, db, model: null, queue: null, version: VERSION, uptimeSec: Math.round((Date.now() - started) / 1000) };
  });
}
