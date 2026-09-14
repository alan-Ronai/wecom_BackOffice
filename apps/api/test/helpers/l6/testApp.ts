import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import swagger from '@fastify/swagger';
import type pg from 'pg';
import { ErrorEnvelopeSchema } from '@wecom/shared';
import { loadConfig } from '../../../src/config.js';
import connectorsModule, { type ConnectorsModuleOptions } from '../../../src/modules/connectors/index.js';
import syncModule from '../../../src/modules/sync/routes.js';
import type { RemoteCache } from '../../../src/modules/sync/remote-cache.js';

export interface L6TestUser {
  id: string;
  permissions: string[];
}

/**
 * A minimal stand-in for `buildApp` while L2 and L3 are unlanded: the same
 * plugin order and error envelope, an injected pool, and a fake `req.user`.
 * `buildApp` itself is exercised separately (registration + 403 without a user).
 */
export async function buildL6TestApp(
  opts: {
    pool: pg.Pool;
    databaseUrl: string;
    testUser?: L6TestUser;
    /** Wave 3: injected so the parity report's 60 s remote-listing window can be driven in tests. */
    remoteCache?: RemoteCache;
  } & ConnectorsModuleOptions,
): Promise<FastifyInstance> {
  const config = loadConfig({ DATABASE_URL: opts.databaseUrl, NODE_ENV: 'test' });
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('config', config);
  app.decorate('db', opts.pool);
  app.decorate('boss', null);
  await app.register(swagger, {
    openapi: { info: { title: 'test', version: '1.0.0' }, servers: [] },
    transform: jsonSchemaTransform,
  });
  if (opts.testUser) {
    const user = { id: opts.testUser.id, permissions: new Set(opts.testUser.permissions) };
    app.addHook('onRequest', async (req) => {
      (req as typeof req & { user?: unknown }).user = user;
    });
  }
  app.setErrorHandler((err, req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    reply.status(status).send(
      ErrorEnvelopeSchema.parse({
        code: (err as { code?: string }).code ?? (status === 500 ? 'INTERNAL' : 'ERROR'),
        message: status === 500 ? 'שגיאה פנימית' : (err as Error).message,
        details: status === 400 ? (err as { validation?: unknown }).validation : undefined,
        requestId: req.id,
      }),
    );
  });
  // `connectorsModule` decorates the scope it is registered in (the /api/v1
  // scope, where L2's publish hook also lives); mirror it onto the root so
  // tests can reach the services the way that hook will.
  let scope: FastifyInstance | undefined;
  await app.register(
    async (v1) => {
      scope = v1;
      await v1.register(connectorsModule, {
        enqueue: opts.enqueue,
        revisions: opts.revisions,
        documents: opts.documents,
        events: opts.events,
      });
      // Wave 3: the parity report and `POST /sync/links`, registered where `app.ts` registers them.
      await v1.register(syncModule, {
        repo: v1.connectors.repo,
        registry: v1.connectors.registry,
        cache: opts.remoteCache,
      });
    },
    { prefix: '/api/v1' },
  );
  app.decorate('connectors', scope!.connectors);
  await app.ready();
  return app;
}
