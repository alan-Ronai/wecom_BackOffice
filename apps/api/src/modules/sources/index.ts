import type { FastifyInstance } from 'fastify';
import { SourceRevisionService } from './revisions.js';
import { MappingService } from './mapping.js';
import { ProposalService } from './proposal.js';
import { SuggestionService, type EventSink } from './suggestions.js';
import { resolveContentApi } from './content-api.js';
import { registerPipelineJobs, type PipelineDeps } from '../../jobs/pipeline.js';
import sourcesRoutes from './routes.js';

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
  const revisions = new SourceRevisionService(app.db, {
    send: async (name, data, opts) => (app.boss ? app.boss.send(name, data, opts ?? {}) : null),
  });
  app.decorate('revisions', revisions); // W4: the sourcedocs module ingests through the same service
  const mapping = new MappingService(app.db);
  const deps: PipelineDeps = {
    revisions,
    mapping,
    proposal: new ProposalService(app.db, mapping, content),
    suggestions: new SuggestionService(app.db, content, eventSink(app)),
  };
  await app.register(sourcesRoutes(deps));
  await registerPipelineJobs(app, deps);
  return deps;
}
