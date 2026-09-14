import type { FastifyInstance } from 'fastify';
import documents from './documents/routes.js';
import blocks from './blocks/routes.js';
import fields from './fields/routes.js';
import notes from './notes/routes.js';
import drafts from './drafts/routes.js';
import search from './search/routes.js';
import trash from './trash/routes.js';
import preferences from './preferences/routes.js';
import events from './events/routes.js';
import graph from './graph/routes.js';
import explorer from './explorer/routes.js';
import dashboards from './dashboards/routes.js';
import collab from './collab/routes.js'; // stage 5: collaboration
import sourcedocs from './sourcedocs/index.js'; // wave 4: source documents
import taxonomy from './taxonomy/index.js'; // wave 4 W1: worlds, topics, tags
import feedback from './feedback/index.js'; // wave 4 W3: agent feedback
import usage from './usage/index.js'; // wave 4 (W5): usage analytics + PgUsage
import learning from './learning/index.js'; // wave 5 V1: learning content
import { startJobs } from '../jobs/index.js';

/**
 * Single registration point for every `/api/v1` content module (L0-owned contract).
 * Other lanes add their module to this list — one line each, no changes to `app.ts`.
 */
export async function registerModules(v1: FastifyInstance) {
  for (const m of [
    documents,
    blocks,
    fields,
    notes,
    drafts,
    search,
    trash,
    preferences,
    events,
    graph,
    explorer,
    dashboards,
    collab,
    sourcedocs,
    taxonomy,
    feedback,
    usage,
    learning,
  ])
    await v1.register(m);
  // L2 background workers (trash.purge, search.reindex) bind to L1's `app.boss` once it is up.
  v1.addHook('onReady', async () => {
    await startJobs(v1);
  });
}
