import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ConnectorsRepo } from './repo.js';
import { buildRegistry } from './registry.js';
import { SyncService, type DocumentsService, type EventBus, type SourceRevisionService } from './sync.js';
import routes from './routes.js';
import syncUiRoutes from './sync-ui.js'; // stage 5: connectors & sync UI read models
import { bossAdapter, registerConnectorJobs } from './jobs.js';
import { documentsOf, eventsOf, hasPermission, revisionsOf, userOf, type Enqueue } from './context.js';
import { getAsset } from '../sourcedocs/assets.js'; // W4: asset bytes for WordPress media upload

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
 * The webhook verifies an HMAC over the exact request bytes, so the raw body
 * has to survive JSON parsing. Scoped to this module's routes; L3's auth plugin
 * does not provide it, so this is registered regardless of the shim below.
 */
async function rawBodyParser(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(null, {});
    }
  });
}

/**
 * Temporary stand-in for L3's auth plugin: enforces route `config.requires`.
 * Scoped to this module's routes and removed the moment L3 registers first.
 */
async function authShim(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req, reply) => {
    const cfg = req.routeOptions?.config as { requires?: readonly string[]; public?: boolean } | undefined;
    if (!cfg?.requires?.length) return;
    const user = userOf(req);
    if (cfg.requires.every((p) => hasPermission(user, p))) return;
    await reply.status(403).send({ code: 'FORBIDDEN', message: 'אין הרשאה לפעולה זו', requestId: req.id });
  });
}

export default fp(async (app: FastifyInstance, opts: ConnectorsModuleOptions = {}) => {
  const repo = new ConnectorsRepo(app.db, app.config.CONNECTOR_KEY);
  const registry = buildRegistry({
    fileRoot: app.config.CONNECTOR_FILE_ROOT,
    hostAllowlist: app.config.CONNECTOR_HOST_ALLOWLIST.split(',')
      .map((h) => h.trim())
      .filter(Boolean),
  });
  const sync = new SyncService({
    repo,
    registry,
    db: app.db,
    revisions: opts.revisions ?? revisionsOf(app),
    documents: opts.documents ?? documentsOf(app),
    events: opts.events ?? eventsOf(app),
    // W4: asset images in the source HTML are re-hosted on the remote during a push.
    assets: async (assetId) => {
      const a = await getAsset(app.db, assetId);
      return a
        ? {
            bytes: new Uint8Array(a.bytes),
            mime: a.mime,
            width: a.width ?? undefined,
            height: a.height ?? undefined,
          }
        : null;
    },
  });
  const enqueue: Enqueue =
    opts.enqueue ??
    (async (name, data) => (app.boss ? ((await app.boss.send(name, data as object)) ?? '') : ''));
  app.decorate('connectors', { repo, registry, sync });

  let refresh: (() => Promise<void>) | undefined;
  if (app.boss) {
    try {
      refresh = await registerConnectorJobs(bossAdapter(app.boss), {
        repo,
        registry,
        sync,
        events: opts.events ?? eventsOf(app),
        log: app.log,
      });
    } catch (err) {
      app.log.warn({ err }, 'could not register connector jobs');
    }
  }

  await app.register(async (scope) => {
    await rawBodyParser(scope);
    // L3 owns `app.audit` and `req.user`; keep the shim only until it lands.
    if (!app.hasDecorator('audit')) await authShim(scope);
    await scope.register(routes, { repo, registry, sync, enqueue, refresh });
    await scope.register(syncUiRoutes, { repo, registry, sync });
  });
});
