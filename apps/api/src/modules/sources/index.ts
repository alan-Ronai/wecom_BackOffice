import type { FastifyInstance } from 'fastify';
import { SourceRevisionService } from './revisions.js';
import { MappingService } from './mapping.js';
import { ProposalService } from './proposal.js';
import { SuggestionService, type EventSink } from './suggestions.js';
import { resolveContentApi } from './content-api.js';
import { registerPipelineJobs, type PipelineDeps } from '../../jobs/pipeline.js';
import sourcesRoutes from './routes.js';

/** `app.events` is decorated by L2; until then nothing listens and events are dropped. */
const eventSink = (app: FastifyInstance): EventSink =>
  (app as unknown as { events?: EventSink }).events ?? { publish: () => undefined };

export async function registerSourcesModule(app: FastifyInstance): Promise<PipelineDeps> {
  const content = await resolveContentApi();
  const revisions = new SourceRevisionService(app.db, {
    send: async (name, data, opts) => (app.boss ? app.boss.send(name, data, opts ?? {}) : null),
  });
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
