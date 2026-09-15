import fp from 'fastify-plugin';
import { OllamaModel, RuleBasedModel, type ModelClient } from '@wecom/model';
import { EmbedStatusTracker, assertEmbeddingDimension, instrumentEmbedding } from '../lib/embedStatus.js';
import { resolveModelSlots } from '../lib/modelSlots.js';

declare module 'fastify' {
  interface FastifyInstance {
    model: ModelClient;
    /** The embedding path's running verdict; `GET /system/health` reports its snapshot. */
    embedStatus: EmbedStatusTracker;
  }
}

const CALL_TIMEOUT_MS = 120_000;

/**
 * Exposes `app.model` for the pipeline jobs and for L1's health route
 * (`app.model.available()`). CPU-only inference, so callers keep concurrency at 1.
 *
 * It also owns the two halves of "is the embedding path real", which nothing used to ask:
 *
 * 1. **At boot** — `EMBED_DIMENSION` is held against `documents.embedding`'s own declared width.
 *    The column is `vector(768)` and the number was hard-coded in a migration, so an install
 *    that configured a 384-dimensional `EMBED_MODEL` was misconfigured in a way no check could
 *    see. A disagreement is a config error here, named in both numbers, rather than a per-publish
 *    write that fails into a `catch {}`.
 * 2. **Per call** — `app.model.embed` is wrapped so the width the model actually returns is
 *    measured, warned about once per attempt, and kept for `embedStatus` in health. The
 *    best-effort swallow in `updateEmbedding` is untouched: publishing still never fails on an
 *    embedding, it just stops being silent about it.
 */
export default fp(async (app) => {
  const rules = new RuleBasedModel();
  // Wave 6 (X0): the generation slot's tag now comes from `resolveModelSlots` so a tier can
  // select it (spec §6). With `MODEL_TIER` unset — the default — this is `MODEL_NAME`, so
  // nothing about this plugin's behaviour changes. The chat slot gets its own client in X2.
  const slots = resolveModelSlots(app.config);
  const base: ModelClient = app.config.MODEL_DISABLED
    ? rules
    : new OllamaModel({
        url: app.config.MODEL_URL,
        model: slots.suggestModel,
        embedModel: app.config.EMBED_MODEL,
        timeoutMs: CALL_TIMEOUT_MS,
        fallback: rules,
      });
  const columnDimension = await assertEmbeddingDimension(app.db, app.config.EMBED_DIMENSION);
  const tracker = new EmbedStatusTracker(app.config.EMBED_MODEL, app.config.EMBED_DIMENSION);
  const model = instrumentEmbedding(base, tracker, app.log);
  app.decorate('model', model);
  app.decorate('embedStatus', tracker);
  app.log.info(
    {
      model: model.name,
      tier: slots.tier,
      suggestModel: slots.suggestModel,
      chatModel: slots.chatModel,
      embedModel: app.config.EMBED_MODEL,
      embedDimension: app.config.EMBED_DIMENSION,
      // null when the database could not be asked — see `readEmbeddingDimension`.
      embeddingColumn: columnDimension,
    },
    'model client ready',
  );
});
