import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ConnectorsRepo } from './repo.js';
import { buildRegistry } from './registry.js';
import { SyncService, type DocumentsService, type EventBus, type SourceRevisionService } from './sync.js';
import routes from './routes.js';
import {
  documentsOf,
  eventsOf,
  hasPermission,
  revisionsOf,
  userOf,
  type Enqueue,
} from './context.js';

declare module 'fastify' {
  interface FastifyInstance {
    connectors: { repo: ConnectorsRepo; registry: ReturnType<typeof buildRegistry>; sync: SyncService };
  }
}

export interface ConnectorsModuleOptions {
  /** Defaults to pg-boss when `app.boss` is available. */
  enqueue?: Enqueue;
  revisions?: SourceRevisionService;
  documents?: DocumentsService;
  events?: EventBus;
}

/**
 * Temporary stand-in for L3's auth plugin: enforces route
 * `config.requires` and captures `req.rawBody` for the webhook route. Scoped to
 * this module's routes and removed the moment L3 registers first.
 */
async function authShim(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    (_req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(null, {});
    }
  });
  app.addHook('onRequest', async (req, reply) => {
    const cfg = req.routeOptions?.config as { requires?: readonly string[]; public?: boolean } | undefined;
    if (!cfg?.requires?.length) return;
    const user = userOf(req);
    if (cfg.requires.every((p) => hasPermission(user, p))) return;
    await reply
      .status(403)
      .send({ code: 'FORBIDDEN', message: 'אין הרשאה לפעולה זו', requestId: req.id });
  });
}

export default fp(async (app: FastifyInstance, opts: ConnectorsModuleOptions = {}) => {
  const repo = new ConnectorsRepo(app.db, app.config.CONNECTOR_KEY);
  const registry = buildRegistry();
  const sync = new SyncService({
    repo,
    registry,
    db: app.db,
    revisions: opts.revisions ?? revisionsOf(app),
    documents: opts.documents ?? documentsOf(app),
    events: opts.events ?? eventsOf(app),
  });
  const enqueue: Enqueue =
    opts.enqueue ??
    (async (name, data) => (app.boss ? ((await app.boss.send(name, data as object)) ?? '') : ''));
  app.decorate('connectors', { repo, registry, sync });
  await app.register(async (scope) => {
    // L3 owns `app.audit` and `req.user`; keep the shim only until it lands.
    if (!app.hasDecorator('audit')) await authShim(scope);
    await scope.register(routes, { repo, registry, sync, enqueue });
  });
});
