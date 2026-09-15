/**
 * Wave 6 — the `ai` module. One registration for the whole wave: X2's chat half here, X1's
 * admin half through `adminHook.ts`, so `modules/index.ts` gains a single line that neither
 * lane has to merge against the other.
 *
 * The chat model is initialised at registration (`initChatModel`) rather than lazily, so a
 * misconfigured `CHAT_MODEL` shows up in the boot log next to `plugins/model.ts`'s line instead
 * of in the first user's failed message. The holder is also a module-level singleton
 * (`aiChatHolder`): Fastify decorators do not travel out of the `/api/v1` scope, and a test
 * holding the root app has to be able to swap the model.
 */
import type { FastifyInstance } from 'fastify';
import { getAiSettings } from '../../lib/aiSettings.js';
import { ChatOrchestrator } from './chat.js';
import { aiChatHolder, initChatModel, type ChatModelHolder } from './chatModel.js';
import { runAdminRegistrar } from './adminHook.js';
import aiRoutes from './routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The swappable chat model. Same object as the exported `aiChatHolder`. */
    aiChat: ChatModelHolder;
  }
}

export default async function aiModule(app: FastifyInstance) {
  await initChatModel(app.config, app.log);
  if (!app.hasDecorator('aiChat')) app.decorate('aiChat', aiChatHolder);

  const orchestrator = new ChatOrchestrator({
    db: app.db,
    chat: aiChatHolder,
    events: app.events,
    log: app.log,
    settings: () => getAiSettings(app.db),
  });

  await app.register(aiRoutes({ orchestrator }));
  // X1's admin routes, when that lane has landed; a no-op otherwise.
  await runAdminRegistrar(app);
}

export { aiChatHolder, ChatOrchestrator };
export { registerAdmin } from './adminHook.js';
