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
import { resolveModelSlots } from '../../lib/modelSlots.js';
import { ChatOrchestrator } from './chat.js';
import { aiChatHolder, initChatModel, type ChatModelHolder } from './chatModel.js';
import { runAdminRegistrar } from './adminHook.js';
import { useImpactService } from './impactService.js';
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
  /*
   * X6 seam: `read_impact` answers from X1's `ImpactService` — the same impact set the proposal
   * pipeline sees, embeddings included — instead of X2's graph-only fallback. The port keeps its
   * own visibility check; the service is also called by the queued job, which has no user.
   */
  useImpactService(app.db);

  const orchestrator = new ChatOrchestrator({
    db: app.db,
    chat: aiChatHolder,
    events: app.events,
    log: app.log,
    settings: () => getAiSettings(app.db, resolveModelSlots(app.config)),
  });

  await app.register(aiRoutes({ orchestrator }));
  // X1's admin routes, when that lane has landed; a no-op otherwise.
  await runAdminRegistrar(app);
}

export { aiChatHolder, ChatOrchestrator };
/**
 * A-M11: `registerAdmin` is deliberately **not** re-exported. X1 registered its admin routes
 * under `modules/admin/routes.ts` instead, so nothing ever called it; re-exporting it from the
 * module's public surface advertised a seam that does nothing. `adminHook.ts` itself stays — the
 * no-op registrar `runAdminRegistrar` drives is still the thing that lets this module boot with
 * the admin half absent — it is just no longer something another module is invited to call.
 */
