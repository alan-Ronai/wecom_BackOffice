import fp from 'fastify-plugin';
import { OllamaModel, RuleBasedModel, type ModelClient } from '@wecom/model';

declare module 'fastify' {
  interface FastifyInstance {
    model: ModelClient;
  }
}

const CALL_TIMEOUT_MS = 120_000;

/**
 * Exposes `app.model` for the pipeline jobs and for L1's health route
 * (`app.model.available()`). CPU-only inference, so callers keep concurrency at 1.
 */
export default fp(async (app) => {
  const rules = new RuleBasedModel();
  const model: ModelClient = app.config.MODEL_DISABLED
    ? rules
    : new OllamaModel({
        url: app.config.MODEL_URL,
        model: app.config.MODEL_NAME,
        embedModel: app.config.EMBED_MODEL,
        timeoutMs: CALL_TIMEOUT_MS,
        fallback: rules,
      });
  app.decorate('model', model);
  app.log.info({ model: model.name }, 'model client ready');
});
