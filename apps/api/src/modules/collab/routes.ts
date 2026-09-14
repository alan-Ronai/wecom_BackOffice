import type { FastifyInstance } from 'fastify';
import notifications from './notifications.js';
import comments from './comments.js';
import reviews from './reviews.js';
import views from './views.js';
import templates from './templates.js';
import presence from './presence.js';
import bulk from './bulk.js';
import newDrafts from './drafts-new.js';

/**
 * Stage 5 — collaboration. Everything an agent or a lead does *around* a card rather
 * than inside it: the bell, inline comments with mentions, the review queue, saved
 * views, step templates, live presence, bulk actions and the `/edit/new` draft.
 *
 * Registered as one line in `modules/index.ts`; every route validates against the
 * schemas in `packages/shared/src/schemas/stage45.ts`.
 */
export default async function collabRoutes(app: FastifyInstance) {
  for (const m of [notifications, comments, reviews, views, templates, presence, bulk, newDrafts])
    await app.register(m);
}
