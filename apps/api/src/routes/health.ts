import type { FastifyInstance } from 'fastify';
import { HealthResponseSchema, VERSION } from '@wecom/shared';
import { probeModel, probeQueue } from '../services/probes.js';

const started = Date.now();
export default async function routes(app: FastifyInstance) {
  app.get(
    '/system/health',
    { schema: { tags: ['system'], response: { 200: HealthResponseSchema } } },
    async () => {
      let db = false;
      try {
        await app.db.query('select 1');
        db = true;
      } catch {
        db = false;
      }
      const [m, queue] = await Promise.all([
        probeModel(app.config.MODEL_URL, app.config.MODEL_NAME),
        probeQueue(app.boss),
      ]);
      const model = m.up && m.hasModel;
      return {
        ok: db && model,
        db,
        model,
        queue,
        version: VERSION,
        uptimeSec: Math.round((Date.now() - started) / 1000),
      };
    },
  );
}
