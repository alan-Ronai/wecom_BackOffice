import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ErrorEnvelopeSchema, GroupSearchQuerySchema, GroupSearchResponseSchema } from '@wecom/shared';

/**
 * `GET /admin/groups/search?q=` — design 3d's "⌕ חפש קבוצה ב-Entra…".
 *
 * Before this, the group-map screen asked an operator to paste an Entra **object id** into a text
 * box. Nobody knows a group's object id; they know its name. So the mapping was in practice built
 * by copying GUIDs out of the Azure portal, and a typo produced a mapping that silently matched
 * nobody — the one failure mode in this screen that nothing else can detect, because "no user is in
 * this group" and "this id does not exist" look identical from here.
 *
 * The lookup uses the client-credentials token the identity module already holds for the nightly
 * `identity.sync` job (`OidcProvider.searchGroups`), so it needs no new credential and no new
 * consent: the same `Group.Read.All` application permission that sync already requires.
 */
export default async function groupsSearchRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/groups/search',
    {
      config: { requires: ['roles.manage'] },
      schema: {
        tags: ['admin'],
        querystring: GroupSearchQuerySchema,
        response: {
          200: GroupSearchResponseSchema,
          403: ErrorEnvelopeSchema,
          502: ErrorEnvelopeSchema,
          503: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      // Not a 500: "this deployment has no SSO issuer" is a configuration state the screen should
      // explain ("הגדירו את Entra ID כדי לחפש קבוצות"), not an outage it should apologise for.
      if (!app.oidc)
        return reply.status(503).send({
          code: 'OIDC_NOT_CONFIGURED',
          message: 'חיפוש קבוצות דורש חיבור ל-Entra ID; הגדירו אותו במסך הזהויות',
          requestId: req.id,
        });
      try {
        return reply.send({ items: await app.oidc.searchGroups(req.query.q) });
      } catch (err) {
        // A Graph outage, a throttle, or a missing `Group.Read.All` consent. The operator can still
        // type an id by hand, so this must not read as "the screen is broken".
        req.log.warn({ err, q: req.query.q }, 'graph group search failed');
        return reply.status(502).send({
          code: 'GRAPH_UNAVAILABLE',
          message: 'החיפוש ב-Entra ID נכשל; אפשר להזין מזהה קבוצה ידנית',
          requestId: req.id,
        });
      }
    },
  );
}
