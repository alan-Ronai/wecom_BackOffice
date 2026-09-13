import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ConnectorCreateBodySchema,
  ConnectorPatchBodySchema,
  ConnectorSchema,
  ErrorEnvelopeSchema,
  IdSchema,
  SyncLinkSchema,
  SyncResolveBodySchema,
  paginated,
} from '@wecom/shared';
import type { ConnectorRegistry } from '@wecom/connectors';
import { maskConfig, type ConnectorRow, type ConnectorsRepo, type SyncLinkRow } from './repo.js';
import type { SyncService } from './sync.js';
import { auditOf, userOf, type Enqueue } from './context.js';

const toApi = (row: ConnectorRow, repo: ConnectorsRepo, reg: ConnectorRegistry) => ({
  id: row.id,
  type: row.type,
  name: row.name,
  enabled: row.enabled,
  schedule: row.schedule,
  lastRunAt: row.last_run_at?.toISOString() ?? null,
  lastStatus: row.last_status,
  health: row.health,
  configMasked: maskConfig(repo.config(row)),
  capabilities: reg.get(row.type).describe().capabilities,
});

const linkToApi = (l: SyncLinkRow & { document_title?: string }) => ({
  id: l.id,
  documentId: l.document_id,
  documentTitle: l.document_title ?? '',
  connectorId: l.connector_id,
  externalId: l.external_id,
  remoteUrl: l.remote_url,
  state: l.state,
  baseRemoteHash: l.base_remote_hash,
  baseLocalVersion: l.base_local_version,
  lastSyncedAt: l.last_synced_at?.toISOString() ?? null,
  conflict: l.conflict ?? null,
});

export interface ConnectorRoutesOptions {
  repo: ConnectorsRepo;
  registry: ConnectorRegistry;
  sync: SyncService;
  enqueue: Enqueue;
  /** Re-sync pg-boss cron schedules after a connector is created, patched or deleted. */
  refresh?: () => Promise<void>;
}

const E = ErrorEnvelopeSchema;

const routes: FastifyPluginAsyncZod<ConnectorRoutesOptions> = async (app, opts) => {
  const { repo, registry, sync } = opts;
  const audit = auditOf(app);
  const manage = { requires: ['connectors.manage'] as const };
  const params = z.object({ id: IdSchema });
  const notFound = (req: FastifyRequest, message: string) => ({
    code: 'NOT_FOUND',
    message,
    requestId: req.id,
  });
  const refresh = async () => {
    if (opts.refresh) await opts.refresh();
  };

  app.get(
    '/connectors',
    {
      config: manage,
      schema: { tags: ['connectors'], response: { 200: paginated(ConnectorSchema), 403: E } },
    },
    async () => {
      const rows = await repo.list();
      return {
        items: rows.map((r) => toApi(r, repo, registry)),
        total: rows.length,
        page: 1,
        pageSize: rows.length,
      };
    },
  );

  app.post(
    '/connectors',
    {
      config: manage,
      schema: {
        tags: ['connectors'],
        body: ConnectorCreateBodySchema,
        response: { 201: ConnectorSchema, 400: E, 403: E },
      },
    },
    async (req, reply) => {
      const conn = registry.get(req.body.type);
      const parsed = conn.configSchema.safeParse(req.body.config);
      if (!parsed.success)
        return reply.status(400).send({
          code: 'INVALID_CONFIG',
          message: 'הגדרות המחבר אינן תקינות',
          details: parsed.error.flatten(),
          requestId: req.id,
        });
      const row = await repo.create(
        { ...req.body, config: parsed.data as Record<string, unknown> },
        userOf(req)?.id ?? null,
      );
      await audit(req, 'connectors.create', 'connector', row.id, null, { type: row.type, name: row.name });
      await refresh();
      return reply.status(201).send(toApi(row, repo, registry));
    },
  );

  app.get(
    '/connectors/:id',
    {
      config: manage,
      schema: { tags: ['connectors'], params, response: { 200: ConnectorSchema, 403: E, 404: E } },
    },
    async (req, reply) => {
      const row = await repo.get(req.params.id);
      if (!row) return reply.status(404).send(notFound(req, 'מחבר לא נמצא'));
      return reply.send(toApi(row, repo, registry));
    },
  );

  app.patch(
    '/connectors/:id',
    {
      config: manage,
      schema: {
        tags: ['connectors'],
        params,
        body: ConnectorPatchBodySchema,
        response: { 200: ConnectorSchema, 400: E, 403: E, 404: E },
      },
    },
    async (req, reply) => {
      const row = await repo.get(req.params.id);
      if (!row) return reply.status(404).send(notFound(req, 'מחבר לא נמצא'));
      let config: Record<string, unknown> | undefined;
      if (req.body.config) {
        const merged = { ...(repo.config(row) as Record<string, unknown>), ...req.body.config };
        const parsed = registry.get(row.type).configSchema.safeParse(merged);
        if (!parsed.success)
          return reply.status(400).send({
            code: 'INVALID_CONFIG',
            message: 'הגדרות המחבר אינן תקינות',
            details: parsed.error.flatten(),
            requestId: req.id,
          });
        config = parsed.data as Record<string, unknown>;
      }
      const updated = await repo.update(row.id, {
        name: req.body.name,
        schedule: req.body.schedule,
        enabled: req.body.enabled,
        config,
      });
      if (!updated) return reply.status(404).send(notFound(req, 'מחבר לא נמצא'));
      await audit(
        req,
        'connectors.update',
        'connector',
        row.id,
        { name: row.name, enabled: row.enabled },
        { name: updated.name, enabled: updated.enabled },
      );
      await refresh();
      return reply.send(toApi(updated, repo, registry));
    },
  );

  app.delete(
    '/connectors/:id',
    {
      config: manage,
      schema: { tags: ['connectors'], params, response: { 204: z.null(), 403: E, 404: E } },
    },
    async (req, reply) => {
      const ok = await repo.remove(req.params.id);
      if (!ok) return reply.status(404).send(notFound(req, 'מחבר לא נמצא'));
      await audit(req, 'connectors.delete', 'connector', req.params.id, null, null);
      await refresh();
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/connectors/:id/test',
    {
      config: manage,
      schema: {
        tags: ['connectors'],
        params,
        response: { 200: z.object({ ok: z.boolean(), message: z.string() }), 403: E, 404: E },
      },
    },
    async (req, reply) => {
      const row = await repo.get(req.params.id);
      if (!row) return reply.status(404).send(notFound(req, 'מחבר לא נמצא'));
      const res = await registry.get(row.type).testConnection(repo.config(row) as never);
      await repo.setRun(row.id, res.ok ? 'test-ok' : 'test-failed', { lastTest: res });
      return reply.send(res);
    },
  );

  app.post(
    '/connectors/:id/run',
    {
      config: manage,
      schema: {
        tags: ['connectors'],
        params,
        response: { 202: z.object({ jobId: z.string() }), 403: E, 404: E },
      },
    },
    async (req, reply) => {
      const row = await repo.get(req.params.id);
      if (!row) return reply.status(404).send(notFound(req, 'מחבר לא נמצא'));
      const jobId = await opts.enqueue('connector.run', {
        connectorId: row.id,
        actorId: userOf(req)?.id ?? null,
      });
      return reply.status(202).send({ jobId });
    },
  );

  app.get(
    '/connectors/:id/links',
    {
      config: manage,
      schema: { tags: ['connectors'], params, response: { 200: paginated(SyncLinkSchema), 403: E } },
    },
    async (req, reply) => {
      const rows = await repo.links(req.params.id);
      return reply.send({ items: rows.map(linkToApi), total: rows.length, page: 1, pageSize: rows.length });
    },
  );

  // Webhook: raw body, signature verified by the connector, no session required.
  app.post(
    '/connectors/:id/webhook',
    {
      config: { public: true, rawBody: true },
      schema: {
        tags: ['connectors'],
        params,
        response: {
          202: z.object({ jobId: z.string(), changes: z.number().int() }),
          400: E,
          401: E,
          404: E,
        },
      },
    },
    async (req, reply) => {
      const row = await repo.get(req.params.id);
      if (!row || !row.enabled) return reply.status(404).send(notFound(req, 'מחבר לא נמצא'));
      const conn = registry.get(row.type);
      if (!conn.parseWebhook)
        return reply
          .status(400)
          .send({ code: 'NO_WEBHOOKS', message: 'המחבר אינו תומך ב-webhook', requestId: req.id });
      try {
        const raw = (req as FastifyRequest & { rawBody?: string }).rawBody ?? '';
        const changes = await conn.parseWebhook(
          repo.config(row) as never,
          req.headers as Record<string, string>,
          { raw },
        );
        const jobId = await opts.enqueue('connector.webhook', { connectorId: row.id, changes });
        return reply.status(202).send({ jobId, changes: changes.length });
      } catch {
        return reply.status(401).send({ code: 'BAD_SIGNATURE', message: 'חתימה שגויה', requestId: req.id });
      }
    },
  );

  app.post(
    '/sync-links/:id/resolve',
    {
      config: { requires: ['suggestions.apply'] as const },
      schema: {
        tags: ['connectors'],
        params,
        body: SyncResolveBodySchema,
        response: { 200: SyncLinkSchema, 403: E, 404: E },
      },
    },
    async (req, reply) => {
      const link = await repo.linkById(req.params.id);
      if (!link) return reply.status(404).send(notFound(req, 'קישור סנכרון לא נמצא'));
      const updated = await sync.resolveConflict(link, req.body, userOf(req)?.id ?? null);
      await audit(
        req,
        'sync.resolve',
        'sync_link',
        link.id,
        { state: link.state },
        { state: updated.state, resolution: req.body.resolution },
      );
      return reply.send(linkToApi(updated));
    },
  );
};

export default routes;
