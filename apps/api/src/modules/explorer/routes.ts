import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import {
  DataFileSchema,
  DataFilesResponseSchema,
  DataPreviewQuerySchema,
  DataPreviewSchema,
  IdSchema,
  PutMappingBodySchema,
  ReimportResultSchema,
} from '@wecom/shared';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/http.js';
import { withTransaction } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import { parseDataFile } from '../sources/parsers.js';
import { SourceRevisionService } from '../sources/revisions.js';
import { MappingService } from '../sources/mapping.js';
import { ProposalService } from '../sources/proposal.js';
import { SuggestionService } from '../sources/suggestions.js';
import { resolveContentApi } from '../sources/content-api.js';
import { processRevision, type PipelineDeps } from '../../jobs/pipeline.js';
import * as repo from './repo.js';
import { contentFromRows, inferColumns, inferMapping, normaliseRow, toMappingRecord } from './mapping.js';

const Params = z.object({ sourceId: IdSchema });

/**
 * The L5 pipeline services, bound to the same pool. The explorer is registered with the other
 * content modules — before `registerSourcesModule` builds its own set — so it assembles them
 * lazily on first use rather than reaching across lanes for a half-built object.
 */
function pipeline(app: FastifyInstance): PipelineDeps {
  const cache = app as FastifyInstance & { __explorerPipeline?: PipelineDeps };
  if (!cache.__explorerPipeline) {
    const content = resolveContentApi();
    const mapping = new MappingService(app.db);
    cache.__explorerPipeline = {
      revisions: new SourceRevisionService(app.db, {
        send: async (name, data, opts) => (app.boss ? app.boss.send(name, data, opts ?? {}) : null),
      }),
      mapping,
      proposal: new ProposalService(app.db, mapping, content),
      suggestions: new SuggestionService(app.db, content, app.events),
    };
  }
  return cache.__explorerPipeline;
}

export default async function routes(app: FastifyInstance) {
  app.get(
    '/data/files',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['explorer'], response: { 200: DataFilesResponseSchema } },
    },
    async (req) => {
      requireUser(req);
      return { items: await repo.listDataFiles(app.db) };
    },
  );

  app.get(
    '/data/files/:sourceId/preview',
    {
      config: { requires: ['docs.read'] },
      schema: {
        tags: ['explorer'],
        params: Params,
        querystring: DataPreviewQuerySchema,
        response: { 200: DataPreviewSchema },
      },
    },
    async (req) => {
      requireUser(req);
      const { limit } = req.query as z.infer<typeof DataPreviewQuerySchema>;
      const preview = await repo.previewRows(app.db, (req.params as { sourceId: string }).sourceId, limit);
      if (!preview) throw notFound('קובץ הנתונים');
      return preview;
    },
  );

  app.put(
    '/data/files/:sourceId/mapping',
    {
      config: { requires: ['sources.manage'] },
      schema: {
        tags: ['explorer'],
        params: Params,
        body: PutMappingBodySchema,
        response: { 200: DataFileSchema },
      },
    },
    async (req) => {
      const user = requireUser(req);
      const { sourceId } = req.params as { sourceId: string };
      const body = req.body as z.infer<typeof PutMappingBodySchema>;
      const before = await repo.getDataFile(app.db, sourceId);
      if (!before) throw notFound('קובץ הנתונים');
      const unknown = body.mapping.map((m) => m.column).filter((c) => !before.columns.includes(c));
      if (unknown.length) throw badRequest('עמודות שאינן קיימות בקובץ: ' + unknown.join(', '));
      const record = toMappingRecord(body.mapping);
      return withTransaction(app.db, async (tx) => {
        await repo.saveColumnsAndMapping(tx, sourceId, before.columns, record, user.id);
        const after = (await repo.getDataFile(tx, sourceId))!;
        await audit(tx, {
          actorId: user.id,
          action: 'sources.mapping',
          entityType: 'source',
          entityId: sourceId,
          before: before.mapping,
          after: after.mapping,
          requestId: req.id,
          ip: req.ip,
        });
        return after;
      });
    },
  );

  app.post(
    '/data/files/:sourceId/reimport',
    {
      config: { requires: ['sources.manage'] },
      schema: { tags: ['explorer'], params: Params, response: { 200: ReimportResultSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const { sourceId } = req.params as { sourceId: string };
      const file = await repo.getDataFile(app.db, sourceId);
      if (!file) throw notFound('קובץ הנתונים');
      const stored = await repo.latestRows(app.db, sourceId);
      if (!stored?.rows.length) throw badRequest('אין שורות שמורות לקובץ הזה — העלה אותו מחדש');
      const record = await repo.mappingRecordOf(app.db, sourceId);
      const deps = pipeline(app);
      const content = contentFromRows(file.title, stored.rows, record);
      const { revisionId, duplicate } = await deps.revisions.ingest(sourceId, content, user.id);
      await repo.saveDataRows(app.db, revisionId, stored.rows);
      // Run the pipeline here rather than only enqueuing it: the reviewer pressed "re-import"
      // and has to see the cards it produced, not a job id.
      const { created } = await processRevision(deps, app.model, revisionId);
      await app.audit(req, 'sources.process', 'source', sourceId, null, {
        revisionId,
        duplicate,
        created,
        rows: stored.rows.length,
      });
      return { revisionId, duplicate, suggestionsQueued: created > 0 };
    },
  );

  // `@fastify/multipart` is registered on the `/api/v1` scope *after* the content modules, so
  // its content-type parser never reaches this one. The upload therefore lives in its own
  // encapsulated child with its own copy — invisible to the rest of the scope.
  await app.register(async (upload) => {
    await upload.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
    upload.post(
      '/data/files',
      {
        config: { requires: ['sources.manage'] },
        schema: { tags: ['explorer'], response: { 200: DataFileSchema } },
      },
      async (req) => {
        const user = requireUser(req);
        let file: { filename: string; buffer: Buffer } | null = null;
        for await (const part of req.parts())
          if (part.type === 'file') file = { filename: part.filename, buffer: await part.toBuffer() };
        if (!file) throw badRequest('חסר קובץ');
        const parsed = parseDataFile(file.filename, file.buffer);
        const rows = parsed.rows.map(normaliseRow);
        if (!rows.length) throw badRequest('הקובץ ריק');
        const columns = inferColumns(rows);
        if (!columns.length) throw badRequest('לא נמצאו עמודות בקובץ');
        const record = inferMapping(columns, rows);

        const deps = pipeline(app);
        const { id: sourceId } = await deps.revisions.createSource(
          {
            kind: parsed.kind,
            title: parsed.title,
            ext: '.' + file.filename.split('.').pop(),
            externalId: file.filename,
            mapping: record,
          },
          user.id,
        );
        await repo.saveColumnsAndMapping(app.db, sourceId, columns, record, user.id);
        const content = contentFromRows(parsed.title, rows, record);
        const { revisionId } = await deps.revisions.ingest(sourceId, content, user.id, file.buffer);
        await repo.saveDataRows(app.db, revisionId, rows);
        await app.audit(req, 'sources.upload', 'source', sourceId, null, {
          filename: file.filename,
          kind: parsed.kind,
          revisionId,
          rows: rows.length,
          columns: columns.length,
        });
        return (await repo.getDataFile(app.db, sourceId))!;
      },
    );
  });
}
