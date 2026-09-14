import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ConnectorRegistry } from '@wecom/connectors';
import {
  ErrorEnvelopeSchema,
  ParityQuerySchema,
  ParityResponseSchema,
  SyncLinkCreateBodySchema,
  SyncLinkRowSchema,
  type Permission,
} from '@wecom/shared';
import type { ConnectorsRepo } from '../connectors/repo.js';
import { parityFor } from './parity.js';
import { createRemoteCache, type RemoteCache } from './remote-cache.js';

export interface SyncModuleOptions {
  repo: ConnectorsRepo;
  registry: ConnectorRegistry;
  /** Injected by the integration tests so the 60 s window can be driven rather than waited out. */
  cache?: RemoteCache;
}

const E = ErrorEnvelopeSchema;

/**
 * Wave-3 closure: the parity report (design 4d) and the "קשר" action it needs.
 *
 * These live in their own module rather than beside the queue in `modules/connectors/sync-ui.ts`
 * for one concrete reason: the parity report reads a connector's *whole* remote listing, which the
 * queue never does, and it does so through a cache with its own lifetime. Folding a cached,
 * connector-wide read into a module whose other routes are all per-row and always-fresh is how a
 * "run now" ends up quietly answering from a minute-old snapshot.
 */
const routes: FastifyPluginAsyncZod<SyncModuleOptions> = async (app, opts) => {
  const { repo, registry } = opts;
  const cache = opts.cache ?? createRemoteCache();
  const sources: { requires: Permission[] } = { requires: ['sources.manage'] };

  app.get(
    '/sync/parity',
    {
      config: sources,
      schema: {
        tags: ['connectors'],
        querystring: ParityQuerySchema,
        response: { 200: ParityResponseSchema, 403: E, 404: E },
      },
    },
    async (req, reply) => {
      if (req.query.connectorId) {
        const c = await repo.get(req.query.connectorId);
        if (!c)
          return reply.status(404).send({ code: 'NOT_FOUND', message: 'המחבר לא נמצא', requestId: req.id });
        return reply.send({ connectors: [await parityFor({ db: app.db, repo, registry, cache }, c)] });
      }
      // Whole-report mode is what the screen opens with. Connectors are walked in sequence rather
      // than in parallel: each one is an outbound HTTP walk over somebody else's CMS, and firing
      // them all at once is the one shape of this request that a remote would be right to refuse.
      const out = [];
      for (const c of await repo.list()) out.push(await parityFor({ db: app.db, repo, registry, cache }, c));
      return reply.send({ connectors: out });
    },
  );

  /**
   * `POST /sync/links` — the parity report's "קשר": pair a published library document with a remote
   * item so the next run reconciles them.
   *
   * The link is created **unsynced on purpose**: `base_remote_hash` null, `last_synced_at` null,
   * state `pending_import`. Nothing has been compared yet, and writing a baseline here would be a
   * claim that the two sides agree — which is precisely what nobody has checked. The honest row
   * says "linked, never synced", and the first run establishes the baseline the way every other
   * link gets one.
   *
   * `sources.manage` and not `connectors.manage`: this is a statement about which *document* a
   * remote item belongs to, which is the source-mapping permission, not connector administration.
   */
  app.post(
    '/sync/links',
    {
      config: sources,
      schema: {
        tags: ['connectors'],
        body: SyncLinkCreateBodySchema,
        response: { 201: SyncLinkRowSchema, 403: E, 404: E, 409: E },
      },
    },
    async (req, reply) => {
      const { connectorId, documentId, externalId } = req.body;
      const connector = await repo.get(connectorId);
      if (!connector)
        return reply.status(404).send({ code: 'NOT_FOUND', message: 'המחבר לא נמצא', requestId: req.id });
      const doc = await app.db.query<{ id: string }>(
        `select id from documents where id=$1 and deleted_at is null`,
        [documentId],
      );
      if (!doc.rowCount)
        return reply.status(404).send({ code: 'NOT_FOUND', message: 'המסמך לא נמצא', requestId: req.id });

      // Two unique constraints guard this row — (connector, external_id) and (document, connector) —
      // and either one being hit means the same thing to the operator: one of these two ends is
      // already spoken for. Checking first gives a message that says which.
      const [byRemote, byDoc] = await Promise.all([
        repo.linkByRemote(connectorId, externalId),
        repo.linkByDocument(connectorId, documentId),
      ]);
      if (byRemote || byDoc)
        return reply.status(409).send({
          code: 'ALREADY_LINKED',
          message: byRemote ? 'הפריט המרוחק כבר מקושר למסמך אחר' : 'המסמך כבר מקושר לפריט אחר במחבר הזה',
          details: { linkId: (byRemote ?? byDoc)!.id },
          requestId: req.id,
        });

      const created = await app.db.query<{ id: string }>(
        `insert into sync_links(document_id, connector_id, external_id, base_remote_hash, base_local_version, state)
         values ($1,$2,$3,null,0,'pending_import') returning id`,
        [documentId, connectorId, externalId],
      );
      // `app.audit` is L3's decorator. The L6 test harness builds a scope without it, and a
      // missing audit log must not be the reason a link cannot be created.
      if (app.hasDecorator('audit'))
        await app.audit(req, 'sync.link.create', 'sync_link', created.rows[0].id, null, {
          connectorId,
          documentId,
          externalId,
        });
      const row = (
        await app.db.query(
          `select l.*, c.name as connector_name, d.title, d.current_version
             from sync_links l join connectors c on c.id=l.connector_id join documents d on d.id=l.document_id
            where l.id=$1`,
          [created.rows[0].id],
        )
      ).rows[0] as Record<string, unknown>;
      return reply.status(201).send({
        id: row.id as string,
        connectorId: row.connector_id as string,
        connectorName: row.connector_name as string,
        documentId: row.document_id as string,
        title: row.title as string,
        externalId: row.external_id as string,
        remoteUrl: (row.remote_url as string | null) ?? null,
        state: 'pending_import' as const,
        baseLocalVersion: (row.base_local_version as number | null) ?? null,
        currentLocalVersion: (row.current_version as number) ?? 0,
        remoteChanged: true,
        localChanged: ((row.current_version as number) ?? 0) !== ((row.base_local_version as number) ?? 0),
        lastSyncedAt: null,
      });
    },
  );
};

export default routes;
