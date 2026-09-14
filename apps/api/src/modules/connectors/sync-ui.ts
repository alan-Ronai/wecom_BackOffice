import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ConflictViewSchema,
  ConnectorTypeInfoSchema,
  ErrorEnvelopeSchema,
  IdSchema,
  ResolveConflictBodySchema,
  SyncLinkRowSchema,
  SyncLinkSyncBodySchema,
  SyncLinksQuerySchema,
  SyncQueueResponseSchema,
  SyncRunResultSchema,
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
import { auditOf, hasPermission, userOf } from './context.js';

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

/**
 * "The remote is down / refusing / not allowed" — the failures a queue row exists to *show*, as
 * distinct from a bug in this process, which must reach the error handler and the logs. A
 * transport failure from `fetch` surfaces as a `TypeError` whose `cause` carries the libuv code;
 * connector and guard failures carry a `code`/`statusCode` of their own.
 */
export function isRemoteFailure(err: unknown): boolean {
  const e = err as { name?: string; code?: unknown; statusCode?: unknown; cause?: { code?: unknown } };
  if (typeof e?.statusCode === 'number') return true;
  if (typeof e?.code === 'string') return true;
  if (typeof e?.cause?.code === 'string') return true;
  return e?.name === 'AbortError' || e?.name === 'TimeoutError' || err instanceof TypeError;
}

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

  /**
   * Stage-5 contract: the per-row "ייבא עכשיו" / "דחוף עכשיו" — one link, one
   * direction, synchronous like "run now" for the same reason. The permission
   * required depends on which way data would move: importing writes a source
   * revision (`sources.manage`), pushing writes the published document out to the
   * remote (`docs.publish`) — so the precise check stays in the handler. `config.requires`
   * still declares the floor both directions share, so the route is not invisible to a sweep
   * of `config.requires` (which is how this review's route audit read it as ungated) and a
   * refactor that reorders the handler cannot silently drop the gate to "authenticated".
   */
  app.post(
    '/sync/links/:id/sync',
    {
      config: { requires: ['docs.read'] as Permission[] },
      schema: {
        tags: ['connectors'],
        params,
        body: SyncLinkSyncBodySchema,
        response: { 200: SyncRunResultSchema, 403: E, 404: E, 409: E },
      },
    },
    async (req, reply) => {
      const link = await repo.linkById(req.params.id);
      if (!link) return reply.status(404).send(missing(req, 'קישור סנכרון לא נמצא'));
      const permission = req.body.direction === 'import' ? 'sources.manage' : 'docs.publish';
      if (!hasPermission(userOf(req), permission))
        return reply.status(403).send({
          code: 'FORBIDDEN',
          message: 'אין לך הרשאה לפעולה זו',
          details: { permission },
          requestId: req.id,
        });
      const actorId = userOf(req)?.id ?? null;
      try {
        const outcome = await sync.syncLink(link, req.body.direction, actorId);
        if (outcome.conflict) {
          const fresh = await app.db.query(`${LINK_SELECT} where l.id = $1`, [outcome.link.id]);
          await audit(
            req,
            'sync.link.' + req.body.direction,
            'sync_link',
            link.id,
            { state: link.state },
            { state: 'conflict' },
          );
          return reply.status(409).send({
            code: 'CONFLICT',
            message: 'הצד המרוחק והמקומי השתנו שניהם; יש לפתור את הקונפליקט לפני הסנכרון',
            details: fresh.rowCount ? toLinkRow(fresh.rows[0]) : null,
            requestId: req.id,
          });
        }
        await audit(
          req,
          'sync.link.' + req.body.direction,
          'sync_link',
          link.id,
          { state: link.state },
          { ...outcome.result, state: outcome.link.state },
        );
        return reply.send({ ...outcome.result, errors: outcome.errors ?? [] });
      } catch (err) {
        // A remote that is down, refusing, or misconfigured is a result to show, not a 500 —
        // but only those. A catch-all here turned every programming error into a cheerful
        // `{imported:0, pushed:0, conflicts:0}` with a 200, which is the one outcome nobody
        // would investigate. Anything without the shape of a transport or connector failure
        // goes to the error handler.
        if (!isRemoteFailure(err)) throw err;
        return reply.send({ imported: 0, pushed: 0, conflicts: 0, errors: [(err as Error).message] });
      }
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
