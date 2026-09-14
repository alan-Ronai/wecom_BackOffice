import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type pg from 'pg';
import { loadConfig, trustProxySetting, type Config } from './config.js';
import dbPlugin from './plugins/db.js';
import bossPlugin from './plugins/boss.js';
import wave4Plugin from './plugins/wave4.js';
import authPlugin from './plugins/auth.js'; // L3: identity
import { registerAuth } from './modules/auth/index.js'; // L3: identity
import adminRoutes from './modules/admin/routes.js'; // L3: identity
import { registerIdentitySyncJob } from './jobs/identity-sync.js'; // L3: identity
import { loggerOptions, REQUEST_ID_HEADER } from './plugins/logging.js';
import health from './routes/health.js';
import connectorsModule from './modules/connectors/index.js';
import { documentsAdapter } from './modules/connectors/documents-adapter.js';
import { ErrorEnvelopeSchema } from '@wecom/shared';
// L5: pipeline
import multipart from '@fastify/multipart';
import modelPlugin from './plugins/model.js';
import testUserPlugin, { type TestUserOption } from './plugins/testUser.js';
import { registerSourcesModule } from './modules/sources/index.js';
// end L5: pipeline
// L2: content modules
import { registerModules } from './modules/index.js';
import { EventBus } from './lib/events.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
  }
}

export async function buildApp(
  opts: {
    config?: Partial<Config>;
    pool?: pg.Pool;
    boss?: boolean;
    plugins?: FastifyPluginAsync[];
    testUser?: TestUserOption;
  } = {},
): Promise<FastifyInstance> {
  const config = loadConfig(opts.config);
  const app = Fastify({
    logger: loggerOptions(config),
    requestIdHeader: REQUEST_ID_HEADER,
    genReqId: () => crypto.randomUUID(),
    // Behind nginx every request's `req.ip` would otherwise be the proxy's own
    // address, which silently defeats the Palo Alto subnet allowlist, collapses
    // the per-IP auth rate limits into one bucket and blanks the audit trail.
    trustProxy: trustProxySetting(config),
  }).withTypeProvider<ZodTypeProvider>();
  app.addHook('onSend', async (req, reply) => {
    reply.header(REQUEST_ID_HEADER, req.id);
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('config', config);
  await app.register(cors, { origin: config.PUBLIC_URL, credentials: true });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  // Registration order per L1 plan: logging (constructor, above) -> db -> boss -> swagger -> routes.
  await app.register(dbPlugin, { pool: opts.pool });
  await app.register(bossPlugin, { boss: opts.boss });
  await app.register(wave4Plugin); // W0: app.notifier / app.taxonomy / app.usage defaults
  // L3: identity — session resolution into req.user and `config.requires` enforcement.
  await app.register(authPlugin);
  // L2: content modules — caller-supplied plugins (fake auth in tests, L3's auth in production)
  // must register before the route scopes so their hooks apply to every module route.
  for (const p of opts.plugins ?? []) await app.register(p);
  // L2: content modules — `app.events` (Postgres LISTEN/NOTIFY bus) used by every write path.
  const events = new EventBus();
  events.onError = (err) => app.log.error({ err }, 'event bus error');
  app.decorate('events', events);
  app.addHook('onReady', async () => {
    if (config.NODE_ENV !== 'test') await events.start(config.DATABASE_URL);
  });
  app.addHook('onClose', async () => {
    await events.stop();
  });
  await app.register(swagger, {
    openapi: { info: { title: 'wecom KB API', version: '1.0.0' }, servers: [{ url: '/' }] },
    transform: jsonSchemaTransform,
  });
  app.setErrorHandler((err, req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    const body = ErrorEnvelopeSchema.parse({
      code: (err as { code?: string }).code ?? (status === 500 ? 'INTERNAL' : 'ERROR'),
      message: status === 500 ? 'שגיאה פנימית' : (err as Error).message,
      details:
        status === 400
          ? (err as { validation?: unknown }).validation
          : (err as { details?: unknown }).details, // L3: identity — HttpError details
      requestId: req.id,
    });
    if (status === 500) req.log.error(err);
    reply.status(status).send(body);
  });
  // `connectorsModule` decorates the /api/v1 scope it is registered in; mirror the
  // services onto the root so jobs, the CLI and tests can reach them the way L2's
  // publish hook does (it sees them through the scope's prototype chain).
  let v1Scope: FastifyInstance | undefined;
  await app.register(
    async (v1) => {
      v1Scope = v1;
      await v1.register(health);
      await registerAuth(v1); // L3: identity
      await v1.register(adminRoutes, { prefix: '/admin' }); // L3: identity
      if (config.NODE_ENV !== 'test') await registerIdentitySyncJob(v1); // L3: identity
      // L2: content modules
      await registerModules(v1);
      // L5: pipeline
      await v1.register(modelPlugin);
      await v1.register(testUserPlugin, { testUser: opts.testUser });
      await v1.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
      const pipeline = await registerSourcesModule(v1);
      // end L5: pipeline
      // L6: connectors — both cross-lane services are supplied explicitly; the
      // module throws at boot rather than degrading to a silent no-op without them.
      await v1.register(connectorsModule, {
        revisions: pipeline.revisions,
        documents: documentsAdapter(v1.db),
      });
      // Closes the two-way sync loop: L5 applies a connector-backed source's
      // accepted suggestions -> L6 creates/refreshes the `sync_links` row. Runs
      // after the apply has committed, so a remote outage cannot roll it back.
      pipeline.suggestions.setAfterApplied(async (sourceId, documentId, version) => {
        try {
          await v1.connectors.sync.afterSuggestionsApplied(sourceId, documentId, version);
        } catch (err) {
          v1.log.error({ err, sourceId, documentId }, 'afterSuggestionsApplied failed');
        }
      });
    },
    { prefix: '/api/v1' },
  );
  if (v1Scope?.hasDecorator('connectors')) app.decorate('connectors', v1Scope.connectors);
  app.get('/api/docs/json', { schema: { hide: true } }, async () => app.swagger());
  return app;
}
