import Fastify, { type FastifyInstance } from 'fastify';
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
import health from './routes/health.js';
import { ErrorEnvelopeSchema } from '@wecom/shared';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
  }
}

export async function buildApp(
  opts: { config?: Partial<Config>; pool?: pg.Pool } = {},
): Promise<FastifyInstance> {
  const config = loadConfig(opts.config);
  const app = Fastify({
    logger: config.NODE_ENV !== 'test',
    genReqId: () => crypto.randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('config', config);
  await app.register(cors, { origin: config.PUBLIC_URL, credentials: true });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(swagger, {
    openapi: { info: { title: 'wecom KB API', version: '1.0.0' }, servers: [{ url: '/' }] },
    transform: jsonSchemaTransform,
  });
  await app.register(dbPlugin, { pool: opts.pool });
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
    },
    { prefix: '/api/v1' },
  );
  app.get('/api/docs/json', { schema: { hide: true } }, async () => app.swagger());
  return app;
}
