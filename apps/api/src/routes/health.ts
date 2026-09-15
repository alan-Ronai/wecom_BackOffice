import type { FastifyInstance } from 'fastify';
import { HealthResponseSchema, VERSION } from '@wecom/shared';
import { probeModel, probeQueue } from '../services/probes.js';
import { getRecordedBackupCheck } from '../services/backupCheck.js';

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
      /**
       * O-2: `app.model.available()` is a `GET /api/tags` that only checks the status code, so
       * health reported `model: true` against an Ollama with *nothing* pulled and `smoke.sh`
       * went green on a broken install. The probe reads the tag listing instead and answers the
       * two questions separately: is Ollama up, and is `MODEL_NAME` actually in it.
       *
       * `MODEL_DISABLED=true` selects `RuleBasedModel`, which needs no service and no tag — the
       * honest answer there is "the configured model is present", as it was before.
       * Health must stay fast, so the model answer is capped at 2 s.
       */
      const probe: Promise<{ reachable: boolean; tagPresent: boolean; name: string }> = app.config
        .MODEL_DISABLED
        ? Promise.resolve({ reachable: true, tagPresent: true, name: 'rules' })
        : probeModel(app.config.MODEL_URL, app.config.MODEL_NAME, MODEL_PROBE_MS).then((m) => ({
            reachable: m.up,
            tagPresent: m.hasModel,
            name: app.config.MODEL_NAME,
          }));
      const [modelStatus, queue, backup] = await Promise.all([
        probe,
        probeQueue(app.boss),
        db ? getRecordedBackupCheck(app.db).catch(() => null) : Promise.resolve(null),
      ]);
      // Kept for clients that read the old boolean — it now means "reachable *and* pulled".
      const model = modelStatus.reachable && modelStatus.tagPresent;
      /**
       * `plugins/model.ts` decorates the /api/v1 scope this route's own scope descends from, so
       * `app.embedStatus` resolves through the prototype chain — but it is registered *after*
       * this route, and a caller that builds the app without it (a bare `buildApp` in a unit
       * test) must still get a health body rather than a 500 out of the serializer. Hence the
       * fallback, which says "nothing has been asked of the embedding path" in the same shape.
       */
      const embedStatus = app.embedStatus?.snapshot() ?? {
        model: app.config.EMBED_MODEL,
        dimension: null,
        expected: app.config.EMBED_DIMENSION,
        lastOk: null,
        lastError: null,
      };
      return {
        ok: db && model,
        db,
        model,
        modelStatus,
        queue,
        version: VERSION,
        uptimeSec: Math.round((Date.now() - started) / 1000),
        lastBackupAt: backup?.latestAt ?? null,
        lastBackupOk: backup?.ok ?? null,
        /**
         * Deliberately **not** folded into `ok`. `ok` is the liveness probe nginx and
         * `deploy/smoke.sh` read; a stack whose embeddings are the wrong width still serves
         * every page and still searches, lexically. Failing liveness on it would take a
         * working pilot down over a ranking regression.
         */
        embedStatus,
      };
    },
  );
}
