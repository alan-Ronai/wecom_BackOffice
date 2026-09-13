import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  IdSchema,
  SourceRevisionSchema,
  SourceSchema,
  SuggestionDecisionBodySchema,
  SuggestionSchema,
  SuggestionsQuerySchema,
  paginated,
} from '@wecom/shared';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { parseUpload } from './parsers.js';
import { processRevision, type PipelineDeps } from '../../jobs/pipeline.js';

const err = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

const actorId = (req: { user?: { id: string } | null }): string => {
  if (!req.user) throw err(401, 'UNAUTHENTICATED', 'נדרשת התחברות');
  return req.user.id;
};

export default function sourcesRoutes(deps: PipelineDeps) {
  return async function routes(instance: FastifyInstance) {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.get(
      '/sources',
      {
        schema: { tags: ['sources'], response: { 200: z.object({ items: z.array(SourceSchema) }) } },
        config: { requires: ['docs.read'] },
      },
      async () => ({ items: await deps.revisions.listSources() }),
    );

    app.post(
      '/sources/upload',
      {
        schema: {
          tags: ['sources'],
          response: {
            200: z.object({
              sourceId: IdSchema,
              revisionId: IdSchema,
              duplicate: z.boolean(),
              kind: z.string(),
              paragraphs: z.number().int(),
            }),
          },
        },
        config: { requires: ['sources.manage'] },
      },
      async (req) => {
        let file: { filename: string; buffer: Buffer } | null = null;
        let sourceId: string | undefined;
        for await (const part of req.parts()) {
          if (part.type === 'file') file = { filename: part.filename, buffer: await part.toBuffer() };
          else if (part.fieldname === 'sourceId') sourceId = String(part.value);
        }
        if (!file) throw err(400, 'NO_FILE', 'חסר קובץ');
        const content = await parseUpload(file.filename, file.buffer);
        const sid =
          sourceId ??
          (
            await deps.revisions.createSource(
              {
                kind: content.kind,
                title: content.title,
                ext: '.' + file.filename.split('.').pop(),
                externalId: file.filename,
              },
              actorId(req),
            )
          ).id;
        const r = await deps.revisions.ingest(sid, content, actorId(req), file.buffer);
        return {
          sourceId: sid,
          revisionId: r.revisionId,
          duplicate: r.duplicate,
          kind: content.kind,
          paragraphs: content.paragraphs.length,
        };
      },
    );

    app.post(
      '/sources/:id/process',
      {
        schema: {
          tags: ['sources'],
          params: z.object({ id: IdSchema }),
          response: {
            200: z.object({ revisionId: IdSchema, created: z.number().int(), used: z.string() }),
          },
        },
        config: { requires: ['sources.manage'] },
      },
      async (req) => {
        const revisionId = await deps.revisions.latestRevisionId(req.params.id);
        if (!revisionId) throw err(404, 'NOT_FOUND', 'אין גרסאות למקור זה');
        const res = await processRevision(deps, app.model, revisionId);
        return { revisionId, ...res };
      },
    );

    app.get(
      '/sources/:id/revisions/:rev',
      {
        schema: {
          tags: ['sources'],
          params: z.object({ id: IdSchema, rev: z.string() }),
          response: { 200: SourceRevisionSchema },
        },
        config: { requires: ['docs.read'] },
      },
      async (req) => {
        const id =
          req.params.rev === 'latest' ? await deps.revisions.latestRevisionId(req.params.id) : req.params.rev;
        const rev = id ? await deps.revisions.getRevision(id) : null;
        if (!rev || rev.sourceId !== req.params.id) throw err(404, 'NOT_FOUND', 'הגרסה לא נמצאה');
        return rev;
      },
    );

    app.get(
      '/suggestions',
      {
        schema: {
          tags: ['suggestions'],
          querystring: SuggestionsQuerySchema,
          response: { 200: paginated(SuggestionSchema) },
        },
        config: { requires: ['suggestions.review'] },
      },
      async (req) => {
        const { items, total } = await deps.suggestions.list(req.query);
        return { items, total, page: req.query.page, pageSize: req.query.pageSize };
      },
    );

    for (const [action, status] of [
      ['accept', 'accepted'],
      ['reject', 'rejected'],
      ['reset', 'pending'],
    ] as const)
      app.post(
        `/suggestions/:id/${action}`,
        {
          schema: {
            tags: ['suggestions'],
            params: z.object({ id: IdSchema }),
            response: { 200: SuggestionSchema },
          },
          config: { requires: ['suggestions.review'] },
        },
        async (req) => deps.suggestions.decide(req.params.id, status, actorId(req)),
      );

    app.put(
      '/suggestions/:id/edit',
      {
        schema: {
          tags: ['suggestions'],
          params: z.object({ id: IdSchema }),
          body: SuggestionDecisionBodySchema,
          response: { 200: SuggestionSchema },
        },
        config: { requires: ['suggestions.review'] },
      },
      async (req) => {
        if (!req.body.editedPayload) throw err(400, 'VALIDATION', 'חסר editedPayload');
        return deps.suggestions.edit(req.params.id, req.body.editedPayload, actorId(req));
      },
    );

    app.post(
      '/suggestions/publish',
      {
        schema: {
          tags: ['suggestions'],
          body: z.object({ sourceId: IdSchema }),
          response: {
            200: z.object({ applied: z.number().int(), versions: z.array(IdSchema) }),
          },
        },
        config: { requires: ['suggestions.apply'] },
      },
      async (req) => deps.suggestions.publishAccepted(req.body.sourceId, actorId(req)),
    );
  };
}
