import type { FastifyInstance } from 'fastify';
import { OllamaModel, type ModelClient } from '@wecom/model';
import { QUEUES } from '../plugins/boss.js';
import { resolveModelSlots } from '../lib/modelSlots.js';
import { getAiSettings, currentPromptVersion } from '../lib/aiSettings.js';
import { reindexEmbeddings } from '../modules/ai/reindex.js';
import { evalCases, recordEvalRun, rulesModel, runEvalCases, startEvalRun } from '../modules/ai/eval.js';
import { reportFailure } from './index.js';

/**
 * Wave 6 (X1). Two admin-triggered background runs, neither scheduled: re-embedding the corpus
 * after an embedder change, and the offline evaluation. Both are long and both contend for the
 * single CPU inference slot, so they run only when an operator asks.
 */
const EVAL_TIMEOUT_MS = 180_000;

/**
 * Exported so the integration suite can run the worker body without pg-boss — which is disabled
 * in tests precisely so a live worker cannot steal a test's jobs.
 */
export async function runEvalJob(
  app: FastifyInstance,
  data: { runId?: string; useRules?: boolean },
): Promise<string> {
  const settings = await getAiSettings(app.db, resolveModelSlots(app.config));
  const slots = resolveModelSlots(app.config);
  const useRules = data.useRules || app.config.MODEL_DISABLED;
  const tag = settings.models.suggestModel || slots.suggestModel;
  /**
   * No fallback on the Ollama client here, unlike the pipeline: an evaluation that silently
   * scores the rule engine when the model times out reports the rule engine's numbers under the
   * model's name, which is worse than a failed run.
   */
  const model: ModelClient = useRules
    ? rulesModel()
    : new OllamaModel({
        url: app.config.MODEL_URL,
        model: tag,
        embedModel: settings.models.embedModel || slots.embedModel,
        timeoutMs: EVAL_TIMEOUT_MS,
      });
  const runId =
    data.runId ??
    (await startEvalRun(app.db, {
      model: model.name,
      promptVersion: currentPromptVersion(settings),
      embedModel: settings.models.embedModel || slots.embedModel,
      startedBy: null,
    }));
  const res = await runEvalCases(model, evalCases());
  await recordEvalRun(app.db, runId, res);
  app.log.info({ runId, ...res, model: model.name }, 'ai.eval done');
  return runId;
}

export async function startAiJobs(app: FastifyInstance): Promise<void> {
  const boss = app.boss;
  // Tests drive these directly (`reindexEmbeddings`, `runEvalJob`); a live worker would race them.
  if (!boss || app.config.NODE_ENV === 'test') return;

  await boss.work<{ since?: string | null }>(QUEUES.aiReindex, async (job) => {
    try {
      const data = [job].flat()[0]?.data as { since?: string | null } | undefined;
      const res = await reindexEmbeddings(
        {
          db: app.db,
          model: app.model,
          // The same resolved width `plugins/model.ts` held against the column at boot.
          expectedDim: resolveModelSlots(app.config).embedDimension,
          log: app.log,
        },
        { since: data?.since ?? null },
      );
      app.log.info(res, 'ai.reindex done');
    } catch (err) {
      await reportFailure(app, QUEUES.aiReindex, err);
      throw err;
    }
  });

  await boss.work<{ runId?: string; useRules?: boolean }>(QUEUES.aiEval, async (job) => {
    try {
      const data = [job].flat()[0]?.data as { runId?: string; useRules?: boolean } | undefined;
      await runEvalJob(app, data ?? {});
    } catch (err) {
      await reportFailure(app, QUEUES.aiEval, err);
      throw err;
    }
  });
}
