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
import { loadConfig, type Config } from './config.js';
import dbPlugin from './plugins/db.js';
import bossPlugin from './plugins/boss.js';
import { loggerOptions, REQUEST_ID_HEADER } from './plugins/logging.js';
import health from './routes/health.js';
import { ErrorEnvelopeSchema } from '@wecom/shared';
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
  } = {},
): Promise<FastifyInstance> {
  const config = loadConfig(opts.config);
  const app = Fastify({
    logger: loggerOptions(config),
    requestIdHeader: REQUEST_ID_HEADER,
    genReqId: () => crypto.randomUUID(),
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
      details: status === 400 ? (err as { validation?: unknown }).validation : undefined,
      requestId: req.id,
    });
    if (status === 500) req.log.error(err);
    reply.status(status).send(body);
  });
  await app.register(
    async (v1) => {
      await v1.register(health);
      // L2: content modules
      await registerModules(v1);
    },
    { prefix: '/api/v1' },
  );
  app.get('/api/docs/json', { schema: { hide: true } }, async () => app.swagger());
  return app;
}
