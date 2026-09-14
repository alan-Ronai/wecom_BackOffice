import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ConflictViewSchema,
  ConnectorTypeInfoSchema,
  ErrorEnvelopeSchema,
  IdSchema,
  ResolveConflictBodySchema,
  SyncLinkRowSchema,
  SyncLinksQuerySchema,
  SyncQueueResponseSchema,
  paragraphText,
  type Document,
  type Paragraph,
  type Permission,
  type Phase,
} from '@wecom/shared';
import type { ConnectorRegistry } from '@wecom/connectors';
import type { ConnectorsRepo } from './repo.js';
import type { SyncService } from './sync.js';
import { describeConfigSchema } from './describe-config.js';
import { auditOf, userOf } from './context.js';

type SyncLinkRow = z.infer<typeof SyncLinkRowSchema>;

/** The shape `SyncService.reconcile` writes into `sync_links.conflict`. */
interface StoredConflict {
  base?: Document | null;
  remote?: Paragraph[];
  local?: Document;
  remoteHash?: string;
  remoteUpdatedAt?: string;
  detectedAt?: string;
}

const E = ErrorEnvelopeSchema;

/** Joined row behind `SyncLinkRowSchema`: the link plus the two names the UI shows. */
const LINK_SELECT = `
  select l.*, c.name as connector_name, d.title, d.current_version
    from sync_links l
    join connectors c on c.id = l.connector_id
    join documents d on d.id = l.document_id`;

const toLinkRow = (r: Record<string, unknown>): SyncLinkRow => {
  const state = r.state as SyncLinkRow['state'];
  const baseLocalVersion = (r.base_local_version as number | null) ?? null;
  const currentLocalVersion = (r.current_version as number) ?? 0;
  return {
    id: r.id as string,
    connectorId: r.connector_id as string,
    connectorName: r.connector_name as string,
    documentId: r.document_id as string,
    title: r.title as string,
    externalId: r.external_id as string,
    remoteUrl: (r.remote_url as string | null) ?? null,
    state,
    baseLocalVersion,
    currentLocalVersion,
    // The queue only ever records *why* a row left parity, so the two flags are read
    // back off the state plus the version baseline rather than re-fetching the remote.
    remoteChanged: state === 'pending_import' || state === 'conflict',
    localChanged: baseLocalVersion !== null && currentLocalVersion !== baseLocalVersion,
    lastSyncedAt: r.last_synced_at ? new Date(r.last_synced_at as Date).toISOString() : null,
  };
};

export interface SyncUiOptions {
  repo: ConnectorsRepo;
  registry: ConnectorRegistry;
  sync: SyncService;
}

/**
 * Stage 5 — the connectors and sync screens. Read models over the same tables the L6
 * engine writes: a queue with per-state counts, a three-way conflict view, and a
 * resolve that takes merged *phases* (what the editor produces) rather than a whole
 * assembled document.
 */
const routes: FastifyPluginAsyncZod<SyncUiOptions> = async (app, opts) => {
  const { repo, registry, sync } = opts;
  const audit = auditOf(app);
  const manage: { requires: Permission[] } = { requires: ['connectors.manage'] };
  const sources: { requires: Permission[] } = { requires: ['sources.manage'] };
  const params = z.object({ id: IdSchema });
  const missing = (req: { id: string }, message: string) => ({
    code: 'NOT_FOUND',
    message,
    requestId: req.id,
  });

  app.get(
    '/connectors/types',
    {
      config: manage,
      schema: {
        tags: ['connectors'],
        response: { 200: z.object({ items: z.array(ConnectorTypeInfoSchema) }), 403: E },
      },
    },
    async () => ({
      items: registry.list().map((info) => ({
        id: info.id,
        name: info.name,
        capabilities: info.capabilities,
        configSchema: describeConfigSchema(registry.get(info.id).configSchema),
      })),
    }),
  );

  app.get(
    '/sync/links',
    {
      config: sources,
      schema: {
        tags: ['connectors'],
        querystring: SyncLinksQuerySchema,
        response: { 200: SyncQueueResponseSchema, 403: E },
      },
    },
    async (req) => {
      const { page, pageSize, state, connectorId, q } = req.query;
      const cond: string[] = [];
      const p: unknown[] = [];
      const add = (sql: string, v: unknown) => {
        p.push(v);
        cond.push(sql.replace(/\?/g, '$' + p.length));
      };
      if (state) add('l.state = ?', state);
      if (connectorId) add('l.connector_id = ?', connectorId);
      if (q) add('(d.title ilike ? or l.external_id ilike ?)', `%${q}%`);
      const where = cond.length ? 'where ' + cond.join(' and ') : '';
      // Counts are over the whole queue, not the current page: the filter chips have to
      // keep showing how much work is left behind the filter the operator just applied.
      const [rows, total, counts] = await Promise.all([
        app.db.query(
          `${LINK_SELECT} ${where} order by
             case l.state when 'conflict' then 0 when 'pending_import' then 1 when 'pending_push' then 2 else 3 end,
             d.title limit $${p.length + 1} offset $${p.length + 2}`,
          [...p, pageSize, (page - 1) * pageSize],
        ),
        app.db.query<{ n: string }>(
          `select count(*) as n from sync_links l join documents d on d.id = l.document_id ${where}`,
          p,
        ),
        app.db.query<{ state: string; n: string }>(
          'select state, count(*) as n from sync_links group by state',
        ),
      ]);
      const by = new Map(counts.rows.map((c) => [c.state, Number(c.n)]));
      return {
        items: rows.rows.map(toLinkRow),
        total: Number(total.rows[0].n),
        page,
        pageSize,
        counts: {
          synced: by.get('synced') ?? 0,
          pendingImport: by.get('pending_import') ?? 0,
          pendingPush: by.get('pending_push') ?? 0,
          conflict: by.get('conflict') ?? 0,
        },
      };
    },
  );

  app.get(
    '/sync/links/:id/conflict',
    {
      config: sources,
      schema: { tags: ['connectors'], params, response: { 200: ConflictViewSchema, 403: E, 404: E } },
    },
    async (req, reply) => {
      const r = await app.db.query(`${LINK_SELECT} where l.id = $1`, [req.params.id]);
      if (!r.rowCount) return reply.status(404).send(missing(req, 'קישור סנכרון לא נמצא'));
      const row = r.rows[0];
      const link = toLinkRow(row);
      const stored = (row.conflict as StoredConflict | null) ?? {};
      if (!stored.local && link.state !== 'conflict')
        return reply.status(404).send(missing(req, 'אין קונפליקט פתוח לקישור זה'));
      // The snapshot taken when the conflict was detected is the honest "base": re-reading
      // the document now would show a third state neither side ever agreed on.
      return reply.send({
        link,
        base: {
          version: stored.base?.currentVersion ?? link.baseLocalVersion,
          phases: (stored.base?.phases as Phase[] | undefined) ?? null,
        },
        ours: {
          version: stored.local?.currentVersion ?? link.currentLocalVersion,
          phases: (stored.local?.phases as Phase[] | undefined) ?? [],
        },
        theirs: {
          hash: stored.remoteHash ?? (row.base_remote_hash as string | null) ?? '',
          updatedAt: stored.remoteUpdatedAt ? new Date(stored.remoteUpdatedAt).toISOString() : null,
          paragraphs: (stored.remote ?? []).map((para) => ({
            ref: para.ref,
            ...(para.heading ? { heading: para.heading } : {}),
            text: paragraphText(para),
          })),
        },
      });
    },
  );

  app.post(
    '/sync/links/:id/resolve',
    {
      config: { requires: ['suggestions.apply'] as Permission[] },
      schema: {
        tags: ['connectors'],
        params,
        body: ResolveConflictBodySchema,
        response: { 200: SyncLinkRowSchema, 400: E, 403: E, 404: E },
      },
    },
    async (req, reply) => {
      const link = await repo.linkById(req.params.id);
      if (!link) return reply.status(404).send(missing(req, 'קישור סנכרון לא נמצא'));
      if (req.body.resolution === 'merged' && !req.body.merged)
        return reply
          .status(400)
          .send({ code: 'MERGE_REQUIRED', message: 'נדרש מיזוג של השלבים', requestId: req.id });
      // The editor hands back phases, not a whole document: rebuild the document around
      // them so the engine's `replaceStructure` sees a complete, valid snapshot.
      let merged: Document | undefined;
      if (req.body.merged) {
        const stored = (link.conflict as StoredConflict | null)?.local;
        const base = stored ?? (await sync.documentOf(link.document_id));
        if (!base) return reply.status(404).send(missing(req, 'המסמך לא נמצא'));
        merged = { ...base, phases: req.body.merged.phases };
      }
      const updated = await sync.resolveConflict(
        link,
        { resolution: req.body.resolution, merged, label: req.body.label },
        userOf(req)?.id ?? null,
      );
      await audit(
        req,
        'sync.resolve',
        'sync_link',
        link.id,
        { state: link.state },
        { state: updated.state, resolution: req.body.resolution, label: req.body.label ?? null },
      );
      const fresh = await app.db.query(`${LINK_SELECT} where l.id = $1`, [updated.id]);
      return reply.send(toLinkRow(fresh.rows[0]));
    },
  );
};

export default routes;
