import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { IdentityService } from './identity.js';
import { OidcProvider } from './oidc.js';
import { PaloAltoClient, makeFallbackIdentify, parseSubnets } from './paloalto.js';
import authRoutes from './routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    identity: IdentityService;
    oidc: OidcProvider | null;
  }
}

export async function registerAuth(app: FastifyInstance) {
  await app.register(rateLimit, {
    global: false,
    // The returned object is thrown, so it must carry statusCode for app.ts's error handler.
    errorResponseBuilder: (req, ctx) => ({
      statusCode: ctx.statusCode ?? 429,
      code: 'RATE_LIMITED',
      message: 'יותר מדי ניסיונות, נסה שוב בעוד דקה',
      details: { retryAfterSec: Math.ceil(ctx.ttl / 1000) },
      requestId: req.id,
    }),
  });
  const identity = new IdentityService(app.db, (id) => app.authCache.invalidate(id));
  app.decorate('identity', identity);
  let oidc: OidcProvider | null = null;
  if (OidcProvider.configured(app.config)) {
    oidc = OidcProvider.fromConfig(app.config);
    try {
      await oidc.init();
    } catch (e) {
      app.log.error({ err: e }, 'OIDC discovery failed; Entra login disabled until restart');
      oidc = null;
    }
  }
  app.decorate('oidc', oidc);
  if (app.config.AUTH_FALLBACK === 'paloalto' && app.config.PALOALTO_HOST && app.config.PALOALTO_API_KEY) {
    app.setFallbackIdentify(
      makeFallbackIdentify({
        db: app.db,
        client: new PaloAltoClient(
          app.config.PALOALTO_HOST,
          app.config.PALOALTO_API_KEY,
          fetch,
          app.config.PALOALTO_SCHEME,
        ),
        subnets: parseSubnets(app.config.PALOALTO_SUBNETS),
        identity,
        sessions: app.sessions,
        env: app.config.NODE_ENV,
        log: app.log,
      }),
    );
  }
  await app.register(authRoutes, { prefix: '/auth' });
}
