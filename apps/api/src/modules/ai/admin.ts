import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { OllamaModel } from '@wecom/model';
import {
  AiSettingsPutSchema,
  AiSettingsSchema,
  AiSettingVersionsResponseSchema,
  EvalRunsResponseSchema,
  IsoDateSchema,
  JobQueuedSchema,
  ModelTestBodySchema,
  ModelTestResultSchema,
  type ModelSlot,
  type ModelTestResult,
} from '@wecom/shared';
import { currentPromptVersion, getAiSettings, putAiSettings } from '../../lib/aiSettings.js';
import { resolveModelSlots } from '../../lib/modelSlots.js';
import { withTransaction } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import { QUEUES } from '../../plugins/boss.js';
import { listEvalRuns, startEvalRun } from './eval.js';

/**
 * Wave 6 (X1), spec §4.1 — the admin surface for the model itself: the brief and the slots
 * (`/admin/ai/settings`), a reachability probe per slot before an admin commits to a tier
 * (`/admin/ai/models/test`), the re-embed after an embedder change (`/admin/ai/reindex`) and
 * the offline evaluation (`/admin/ai/eval`, `/admin/ai/eval/runs`).
 *
 * All of it is `ai.manage`, which only `admin` holds (0050): these change what the model *is*,
 * not what it said. Registered under the `/admin` prefix by `modules/admin/routes.ts`.
 */
const MODEL_TEST_TIMEOUT_MS = 30_000;
const PROBE_PROMPT = 'ענה במילה אחת: שלום';

/** The tag an admin's saved settings select for a slot, falling back to the deployed config. */
const tagFor = (
  slot: ModelSlot,
  settings: { models: { suggestModel: string; chatModel: string; embedModel: string } },
  fallback: { suggestModel: string; chatModel: string; embedModel: string },
): string => {
  const saved = { suggest: settings.models.suggestModel, chat: settings.models.chatModel, embed: settings.models.embedModel }[slot];
  const env = { suggest: fallback.suggestModel, chat: fallback.chatModel, embed: fallback.embedModel }[slot];
  return saved || env;
};

export default async function aiAdminRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/ai/settings',
    {
      config: { requires: ['ai.manage'] },
      schema: { tags: ['admin'], response: { 200: AiSettingsSchema } },
    },
    async (req) => {
      requireUser(req);
      return getAiSettings(app.db);
    },
  );

  app.put(
    '/ai/settings',
    {
      config: { requires: ['ai.manage'] },
      schema: { tags: ['admin'], body: AiSettingsPutSchema, response: { 200: AiSettingsSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const patch = req.body;
      const after = await withTransaction(app.db, (tx) => putAiSettings(tx, patch, user.id));
      await app.audit(req, 'admin.ai.settings.update', 'app_settings', 'ai', null, {
        promptVersion: currentPromptVersion(after),
      });
      return after;
    },
  );

  app.get(
    '/ai/settings/versions',
    {
      config: { requires: ['ai.manage'] },
      schema: {
        tags: ['admin'],
        querystring: z.object({ key: z.string().optional() }),
        response: { 200: AiSettingVersionsResponseSchema },
      },
    },
    async (req) => {
      requireUser(req);
      const { key } = req.query;
      const r = await app.db.query(
        `select v.key, v.version, v.value, v.updated_by, u.display_name as updated_by_name, v.updated_at
           from ai_setting_versions v left join users u on u.id = v.updated_by
          ${key ? 'where v.key = $1' : ''}
          order by v.updated_at desc limit 200`,
        key ? [key] : [],
      );
      return {
        items: r.rows.map((x) => ({
          key: x.key,
          version: x.version,
          value: x.value,
          updatedBy: x.updated_by ?? null,
          updatedByName: x.updated_by_name ?? null,
          updatedAt: (x.updated_at as Date).toISOString(),
        })),
      };
    },
  );

  /**
   * A slot probe, not a health check: it answers for the tag the admin is about to select, which
   * may be one Ollama has never pulled. Nothing here throws — an unreachable daemon, a missing
   * tag and a model that returns the wrong width are all `reachable: false` plus an `error` an
   * operator can act on, because a 500 on a "test" button tells them nothing.
   */
  app.post(
    '/ai/models/test',
    {
      config: { requires: ['ai.manage'] },
      schema: { tags: ['admin'], body: ModelTestBodySchema, response: { 200: ModelTestResultSchema } },
    },
    async (req) => {
      requireUser(req);
      const { slot } = req.body;
      const settings = await getAiSettings(app.db);
      const tag = tagFor(slot, settings, resolveModelSlots(app.config));
      const base: ModelTestResult = { slot, tag, reachable: false };
      if (app.config.MODEL_DISABLED)
        return { ...base, error: 'MODEL_DISABLED=true — אין חיבור למודל בהתקנה הזו' };
      const probe = new OllamaModel({
        url: app.config.MODEL_URL,
        model: tag,
        embedModel: tag,
        timeoutMs: MODEL_TEST_TIMEOUT_MS,
      });
      const tags = await probe.listTags();
      if (!tags.length) return { ...base, error: 'שרת המודל אינו מגיב בכתובת ' + app.config.MODEL_URL };
      const present = tags.find((t) => t.name === tag);
      if (!present) return { ...base, error: 'התג אינו קיים ב-Ollama — הרץ ollama pull ' + tag };
      const details = await probe.showModel(tag);
      const out: ModelTestResult = {
        ...base,
        reachable: true,
        ...(present.size ? { sizeBytes: present.size } : {}),
      };
      try {
        if (slot === 'embed') {
          // The width the model actually returns, not the one `/api/show` advertises — that is
          // the number `EMBED_DIMENSION` has to equal, and the two have been known to differ.
          const dims = (await probe.embed('בדיקה')).length || details?.embeddingLength;
          return { ...out, ...(dims ? { dims } : {}) };
        }
        const { tokens, ms } = await probe.generateProbe(tag, PROBE_PROMPT);
        return { ...out, tokensPerSec: ms > 0 ? Number(((tokens * 1000) / ms).toFixed(2)) : 0 };
      } catch (e) {
        return { ...out, reachable: false, error: (e as Error).message };
      }
    },
  );

  app.post(
    '/ai/reindex',
    {
      config: { requires: ['ai.manage'] },
      schema: {
        tags: ['admin'],
        body: z.object({ since: IsoDateSchema.optional() }).default({}),
        response: { 202: JobQueuedSchema },
      },
    },
    async (req, reply) => {
      requireUser(req);
      const since = req.body?.since;
      // `singletonKey` so an impatient admin pressing the button twice does not run two passes
      // over the whole corpus against a single CPU inference slot.
      const jobId = app.boss
        ? await app.boss.send(QUEUES.aiReindex, { since: since ?? null }, { singletonKey: 'ai.reindex' })
        : null;
      await app.audit(req, 'admin.ai.reindex', 'job', QUEUES.aiReindex, null, { since: since ?? null, jobId });
      reply.code(202);
      return { queued: true as const, jobId };
    },
  );

  app.post(
    '/ai/eval',
    {
      config: { requires: ['ai.manage'] },
      schema: {
        tags: ['admin'],
        body: z.object({ useRules: z.boolean().default(false) }).default({}),
        response: { 202: JobQueuedSchema },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const useRules = req.body?.useRules ?? false;
      const settings = await getAiSettings(app.db);
      const slots = resolveModelSlots(app.config);
      // The row is created here, pending, so the admin page shows a run in flight rather than
      // nothing until the worker happens to pick the job up.
      const runId = await startEvalRun(app.db, {
        model: useRules || app.config.MODEL_DISABLED ? 'rules' : tagFor('suggest', settings, slots),
        promptVersion: currentPromptVersion(settings),
        embedModel: tagFor('embed', settings, slots),
        startedBy: user.id,
      });
      const jobId = app.boss ? await app.boss.send(QUEUES.aiEval, { runId, useRules }) : null;
      await app.audit(req, 'admin.ai.eval', 'ai_eval_run', runId, null, { useRules, jobId });
      reply.code(202);
      return { queued: true as const, jobId };
    },
  );

  app.get(
    '/ai/eval/runs',
    {
      config: { requires: ['ai.manage'] },
      schema: { tags: ['admin'], response: { 200: EvalRunsResponseSchema } },
    },
    async (req) => {
      requireUser(req);
      return { items: await listEvalRuns(app.db) };
    },
  );
}
