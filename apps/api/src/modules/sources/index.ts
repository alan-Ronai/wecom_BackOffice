import type { FastifyInstance } from 'fastify';
import { SourceRevisionService } from './revisions.js';
import { MappingService } from './mapping.js';
import { ProposalService } from './proposal.js';
import { ImpactService } from './impact.js';
import { getAiSettings } from '../../lib/aiSettings.js';
import { resolveModelSlots } from '../../lib/modelSlots.js';
import { SuggestionService, type EventSink } from './suggestions.js';
import { resolveContentApi } from './content-api.js';
import { registerPipelineJobs, type PipelineDeps } from '../../jobs/pipeline.js';
import sourcesRoutes from './routes.js';
import { withTransaction } from '../../lib/sql.js';
import { documentsForSource, markSourceReviewNeeded } from '../documents/sourceReview.js';

/**
 * L2's `app.events` bus. Required, not optional: a missing bus used to degrade to a
 * silent no-op, which is exactly the unwired-seam failure mode this lane shipped with.
 */
const eventSink = (app: FastifyInstance): EventSink => {
  const bus = (app as unknown as { events?: EventSink }).events;
  if (!bus) throw new Error('app.events is not decorated — register the event bus before the sources module');
  return bus;
};

export async function registerSourcesModule(app: FastifyInstance): Promise<PipelineDeps> {
  const content = resolveContentApi();
  const revisions = new SourceRevisionService(
    app.db,
    { send: async (name, data, opts) => (app.boss ? app.boss.send(name, data, opts ?? {}) : null) },
    {
      // W2: a new source revision puts every document fed by that source back "under review".
      onIngested: async ({ sourceId, revisionId, actorId }) => {
        const src = await app.db.query('select title from sources where id=$1', [sourceId]);
        const who = actorId
          ? ((await app.db.query('select display_name from users where id=$1', [actorId])).rows[0]
              ?.display_name as string | undefined)
          : undefined;
        const reason = `גרסת מקור חדשה · ${src.rows[0]?.title ?? sourceId} · ${who ?? 'סנכרון'} · ${revisionId.slice(0, 8)}`;
        for (const docId of await documentsForSource(app.db, sourceId))
          await withTransaction(app.db, (tx) =>
            markSourceReviewNeeded(tx, app.notifier, docId, reason, actorId),
          );
      },
    },
  );
  app.decorate('revisions', revisions); // W4: the sourcedocs module ingests through the same service
  /**
   * Wave 6 (X1): the mapping service gets the model so paragraph→step matching can use
   * embeddings (spec §1.10), and the proposal service gets the impact reader and the AI
   * settings so the prompt is briefed and impact-aware (spec §1.6/§1.7). Both degrade to the
   * pre-wave-6 behaviour when the model has no `embed` and nothing is configured.
   */
  const mapping = new MappingService(app.db, app.model);
  const impact = new ImpactService(app.db);
  const deps: PipelineDeps = {
    revisions,
    mapping,
    proposal: new ProposalService(app.db, mapping, content, impact, () =>
      getAiSettings(app.db, resolveModelSlots(app.config)),
    ),
    suggestions: new SuggestionService(app.db, content, eventSink(app)),
    impact,
  };
  await app.register(sourcesRoutes(deps));
  await registerPipelineJobs(app, deps);
  return deps;
}
