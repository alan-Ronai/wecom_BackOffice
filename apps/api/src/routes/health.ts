import type { FastifyInstance } from 'fastify';
import { HealthResponseSchema, VERSION } from '@wecom/shared';
import { probeModel, probeQueue } from '../services/probes.js';

const started = Date.now();
const MODEL_PROBE_MS = 2000;
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
      // L5 decorates app.model; ask the client itself so MODEL_DISABLED reports honestly.
      // Health must stay fast, so the model answer is capped at 2 s.
      const probe: Promise<boolean> = app.model
        ? Promise.race([
            app.model.available().catch(() => false),
            new Promise<boolean>((r) => setTimeout(() => r(false), MODEL_PROBE_MS)),
          ])
        : probeModel(app.config.MODEL_URL, app.config.MODEL_NAME).then((m) => m.up && m.hasModel);
      const [model, queue] = await Promise.all([probe, probeQueue(app.boss)]);
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
