import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ConnectorCreateBodySchema,
  ConnectorPatchBodySchema,
  ConnectorRowSchema,
  ConnectorTestBodySchema,
  ErrorEnvelopeSchema,
  IdSchema,
  SyncLinkSchema,
  SyncResolveBodySchema,
  SyncRunResultSchema,
  paginated,
  type Permission,
} from '@wecom/shared';
import type { ConnectorRegistry } from '@wecom/connectors';
import {
  MASKED_VALUE,
  maskConfig,
  type ConnectorRow,
  type ConnectorsRepo,
  type SyncLinkRow,
} from './repo.js';
import type { SyncService } from './sync.js';
import { auditOf, userOf, type Enqueue } from './context.js';

/**
 * `lastStatus` on the row is free text the engine writes (`ok`, `test-ok`, `error`…);
 * the UI contract narrows it to the three states a status pill can actually draw.
 */
const statusOf = (s: string | null): 'ok' | 'error' | 'never' =>
  !s ? 'never' : s === 'ok' || s === 'test-ok' ? 'ok' : 'error';

const toRow = (
  row: ConnectorRow & { links?: number; conflicts?: number },
  repo: ConnectorsRepo,
): z.infer<typeof ConnectorRowSchema> => ({
  id: row.id,
  type: row.type,
  name: row.name,
  enabled: row.enabled,
  schedule: row.schedule ?? null,
  lastRunAt: row.last_run_at?.toISOString() ?? null,
  lastStatus: statusOf(row.last_status),
  health: row.health ?? null,
  config: maskConfig(repo.config(row)),
  links: Number(row.links ?? 0),
  conflicts: Number(row.conflicts ?? 0),
});

/**
 * `GET /connectors` and the three single-connector routes answer the *same* resource, so they
 * answer the same schema. They used to disagree — the list returned `ConnectorRowSchema`
 * (`config`, `links`, `conflicts`, nullable `schedule`) and `GET`/`POST`/`PATCH` on one
 * connector returned the older `ConnectorSchema` (`configMasked`, `capabilities`, no counts) —
 * which forced `apps/web/src/api/stage5.ts` to bypass the generated client for all three.
 * `capabilities` is no loss: it is per *type*, and the screens already read it from
 * `GET /connectors/types`.
 */
const WITH_COUNTS = `
  select c.*,
         (select count(*)::int from sync_links l where l.connector_id = c.id) as links,
         (select count(*)::int from sync_links l where l.connector_id = c.id and l.state = 'conflict') as conflicts
    from connectors c`;

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
  const manage: { requires: Permission[] } = { requires: ['connectors.manage'] };
  const params = z.object({ id: IdSchema });
  const notFound = (req: FastifyRequest, message: string) => ({
    code: 'NOT_FOUND',
    message,
    requestId: req.id,
  });
  const refresh = async () => {
    if (opts.refresh) await opts.refresh();
  };
  /** One connector in the exact shape `GET /connectors` answers, counts included. */
  const rowById = async (id: string) => {
    const r = await app.db.query<ConnectorRow & { links: number; conflicts: number }>(
      `${WITH_COUNTS} where c.id = $1`,
      [id],
    );
    return r.rows[0] ? toRow(r.rows[0], repo) : null;
  };

  app.get(
    '/connectors',
    {
      config: manage,
      schema: {
        tags: ['connectors'],
        response: { 200: z.object({ items: z.array(ConnectorRowSchema) }), 403: E },
      },
    },
    // The admin list carries the two counts the cards show, so opening the page is one
    // request rather than one per connector.
    async () => {
      const rows = await app.db.query<ConnectorRow & { links: number; conflicts: number }>(
        `${WITH_COUNTS} order by c.created_at`,
      );
      return { items: rows.rows.map((r) => toRow(r, repo)) };
    },
  );

  app.post(
    '/connectors',
    {
      config: manage,
      schema: {
        tags: ['connectors'],
        body: ConnectorCreateBodySchema,
        response: { 201: ConnectorRowSchema, 400: E, 403: E },
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
      return reply.status(201).send((await rowById(row.id))!);
    },
  );

  app.get(
    '/connectors/:id',
    {
      config: manage,
      schema: { tags: ['connectors'], params, response: { 200: ConnectorRowSchema, 403: E, 404: E } },
    },
    async (req, reply) => {
      const row = await rowById(req.params.id);
      if (!row) return reply.status(404).send(notFound(req, 'מחבר לא נמצא'));
      return reply.send(row);
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
        response: { 200: ConnectorRowSchema, 400: E, 403: E, 404: E },
      },
    },
    async (req, reply) => {
      const row = await repo.get(req.params.id);
      if (!row) return reply.status(404).send(notFound(req, 'מחבר לא נמצא'));
      let config: Record<string, unknown> | undefined;
      if (req.body.config) {
        // A PATCH sends only the keys it means to change, so absent keys must survive
        // untouched (including secrets the client was never handed back). Per key:
        //   - the masked placeholder (`••••`) means "unchanged" — merging it in literally
        //     would overwrite the real, stored secret with the placeholder itself;
        //   - an explicit `null` means "clear this key" — delete it from the merged config
        //     rather than writing a literal null, so the connector's schema can re-apply
        //     its own default (or reject the now-missing required key with a 400).
        const merged: Record<string, unknown> = { ...(repo.config(row) as Record<string, unknown>) };
        for (const [k, v] of Object.entries(req.body.config)) {
          if (v === MASKED_VALUE) continue;
          if (v === null) {
            delete merged[k];
            continue;
          }
          merged[k] = v;
        }
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
      // `schedule` is tri-state: omitted means "leave it alone", so only forward the key
      // to the repo when the client actually sent it (including an explicit `null`, which
      // means "ללא תזמון" — clear it). Spreading `req.body.schedule` unconditionally would
      // always add the key, turning every "not sent" into "clear it".
      const updated = await repo.update(row.id, {
        name: req.body.name,
        ...('schedule' in req.body ? { schedule: req.body.schedule } : {}),
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
      return reply.send((await rowById(updated.id))!);
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

  /**
   * The wizard's step-3 dry run: no connector exists yet, so there is no id to test
   * against and nothing is persisted (no row, no `lastTest` health write).
   */
  app.post(
    '/connectors/test',
    {
      config: manage,
      schema: {
        tags: ['connectors'],
        body: ConnectorTestBodySchema,
        response: { 200: z.object({ ok: z.boolean(), message: z.string() }), 400: E, 403: E },
      },
    },
    async (req, reply) => {
      if (!registry.list().some((t) => t.id === req.body.type))
        return reply.status(400).send({
          code: 'UNKNOWN_TYPE',
          message: 'סוג מחבר לא ידוע',
          requestId: req.id,
        });
      const conn = registry.get(req.body.type);
      const parsed = conn.configSchema.safeParse(req.body.config);
      if (!parsed.success)
        return reply.status(400).send({
          code: 'INVALID_CONFIG',
          message: 'הגדרות המחבר אינן תקינות',
          details: parsed.error.flatten(),
          requestId: req.id,
        });
      const res = await conn.testConnection(parsed.data as never);
      return reply.send(res);
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
      await audit(req, 'connectors.test', 'connector', row.id, null, res);
      return reply.send(res);
    },
  );

  /**
   * Stage-5 contract: "run now" answers with what the run actually did, because the
   * operator pressing it is watching for the numbers. The run is synchronous for that
   * reason; the scheduled path still goes through pg-boss.
   */
  app.post(
    '/connectors/:id/run',
    {
      config: manage,
      schema: { tags: ['connectors'], params, response: { 200: SyncRunResultSchema, 403: E, 404: E } },
    },
    async (req, reply) => {
      const row = await repo.get(req.params.id);
      if (!row) return reply.status(404).send(notFound(req, 'מחבר לא נמצא'));
      const errors: string[] = [];
      let result = { imported: 0, pushed: 0, conflicts: 0 };
      try {
        const r = await sync.runConnector(row.id, userOf(req)?.id ?? null);
        result = { imported: r.imported + r.linked, pushed: r.pushed, conflicts: r.conflicts };
      } catch (err) {
        // A remote that is down is a result to show, not a 500: the rest of the page
        // still has to render, and the message is what the operator needs.
        errors.push((err as Error).message);
        await repo.setRun(row.id, 'error', { lastError: (err as Error).message });
      }
      // A run writes to the remote system, so it is at least as audit-worthy as a patch.
      await audit(req, 'connectors.run', 'connector', row.id, null, { ...result, errors });
      return reply.status(200).send({ ...result, errors });
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
  // Public and unauthenticated until the HMAC is checked — and each call costs a
  // connector lookup plus an AES-GCM decrypt before that — so it carries its own
  // per-IP limit. A real WordPress sends one request per post save.
  app.post(
    '/connectors/:id/webhook',
    {
      config: { public: true, rateLimit: { max: 60, timeWindow: '1 minute' } },
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

  /**
   * @deprecated Superseded by `POST /sync/links/:id/resolve` (`sync-ui.ts`), which is the one
   * the stage-5 contract names and the one the web calls. Both are registered and take
   * different bodies (`SyncResolveBodySchema` vs `ResolveConflictBodySchema`), which is one
   * resolve endpoint too many; this one is kept for the L6-era callers and marked `deprecated`
   * in the OpenAPI so a client sees it before it is removed.
   */
  app.post(
    '/sync-links/:id/resolve',
    {
      config: { requires: ['suggestions.apply'] as Permission[] },
      schema: {
        tags: ['connectors'],
        deprecated: true,
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
