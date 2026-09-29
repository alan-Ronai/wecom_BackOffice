import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AcceptSuggestionBodySchema,
  IdSchema,
  SourceRevisionSchema,
  SourceSchema,
  SuggestionAnalyticsQuerySchema,
  SuggestionAnalyticsSchema,
  SuggestionDecisionBodySchema,
  SuggestionSchema,
  SuggestionsQuerySchema,
  paginated,
} from '@wecom/shared';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { suggestionAnalytics } from './analytics.js';
import { suggestionViewer, type SuggestionViewer } from './suggestionScope.js';
import { hasAllScopes, type ReqUser } from '../../lib/user.js';
import { httpError } from '../../lib/http.js';
import { parseUpload } from './parsers.js';
import { processRevision, type PipelineDeps } from '../../jobs/pipeline.js';

const err = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

const actorId = (req: { user?: { id: string } | null }): string => {
  if (!req.user) throw err(401, 'UNAUTHENTICATED', 'נדרשת התחברות');
  return req.user.id;
};

/**
 * A-I6. The review queue is world-scoped like every other reader, so every suggestion route that
 * addresses a row by id — the two reads and the `before` snapshot the decision routes audit
 * against — resolves it through the caller's reach. A row outside it answers 404.
 */
const viewer = (req: { user?: ReqUser | null }): SuggestionViewer => {
  if (!req.user) throw err(401, 'UNAUTHENTICATED', 'נדרשת התחברות');
  return suggestionViewer(req.user);
};

/**
 * The pipeline writes documents, blocks and CRM fields on a reviewer's behalf, so
 * every decision on the way there has to be reconstructible. `app.audit` is L3's
 * wrapper (its own transaction); `publishAccepted` audits inside the apply
 * transaction itself so the row rolls back with the change.
 */
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
        await app.audit(req, 'sources.upload', 'source', sid, null, {
          filename: file.filename,
          kind: content.kind,
          revisionId: r.revisionId,
          duplicate: r.duplicate,
          paragraphs: content.paragraphs.length,
        });
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
        await app.audit(req, 'sources.process', 'source', req.params.id, null, { revisionId, ...res });
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
        // A-I6: the queue is world-scoped like every other reader.
        const { items, total } = await deps.suggestions.list(req.query, viewer(req));
        return { items, total, page: req.query.page, pageSize: req.query.pageSize };
      },
    );

    /**
     * X6 seam. Spec §4.2 and `CONTRACTS-wave6.md` both document `GET /suggestions/:id` as the
     * read that now carries `affects`, `promptVersion`, `model`, `editDiff` and `appliedParts`,
     * but no lane shipped it: X4a's structured-edit drawer was reading it through a mock. It is
     * declared before `/suggestions/:id/*` for clarity only — Fastify routes by path, not by
     * registration order, so `/suggestions/analytics` is unaffected either way.
     */
    app.get(
      '/suggestions/:id',
      {
        schema: {
          tags: ['suggestions'],
          params: z.object({ id: IdSchema }),
          response: { 200: SuggestionSchema },
        },
        config: { requires: ['suggestions.review'] },
      },
      async (req) => deps.suggestions.get(req.params.id, viewer(req)),
    );

    /**
     * `accept` takes an optional `{ parts }` — the row ids of `rowsOf(payload)` to apply now.
     * An absent body, or one without `parts`, is the whole suggestion, exactly as before; with
     * `parts` the rows left out come back as a pending remainder suggestion (`parentId`).
     */
    app.post(
      '/suggestions/:id/accept',
      {
        schema: {
          tags: ['suggestions'],
          params: z.object({ id: IdSchema }),
          // `nullish`, not `optional`: a POST with no body at all reaches validation as `null`,
          // and "accept the whole suggestion" is exactly what an empty body has always meant.
          body: AcceptSuggestionBodySchema.nullish(),
          response: { 200: SuggestionSchema },
        },
        config: { requires: ['suggestions.review'] },
      },
      async (req) => {
        const before = await deps.suggestions.get(req.params.id, viewer(req));
        const parts = req.body?.parts;
        const s = parts?.length
          ? (await deps.suggestions.acceptParts(req.params.id, parts, actorId(req))).accepted
          : await deps.suggestions.decide(req.params.id, 'accepted', actorId(req));
        await app.audit(
          req,
          'suggestions.review',
          'suggestion',
          s.id,
          { status: before.status },
          {
            status: s.status,
            type: s.type,
            targetDocumentId: s.targetDocumentId,
            ...(parts?.length ? { parts } : {}),
          },
        );
        return s;
      },
    );

    /**
     * Acceptance analytics (spec §1.9). A distinct path, so its registration order against
     * `/suggestions/:id/*` does not matter. Cached 60 s in `analytics.ts`.
     */
    app.get(
      '/suggestions/analytics',
      {
        schema: {
          tags: ['suggestions'],
          querystring: SuggestionAnalyticsQuerySchema,
          response: { 200: SuggestionAnalyticsSchema },
        },
        config: { requires: ['suggestions.review'] },
      },
      async (req) => suggestionAnalytics(app.db, req.query),
    );

    for (const [action, status] of [
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
        async (req) => {
          const before = await deps.suggestions.get(req.params.id, viewer(req));
          const s = await deps.suggestions.decide(req.params.id, status, actorId(req));
          await app.audit(
            req,
            'suggestions.review',
            'suggestion',
            s.id,
            { status: before.status },
            { status: s.status, type: s.type, targetDocumentId: s.targetDocumentId },
          );
          return s;
        },
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
        const before = await deps.suggestions.get(req.params.id, viewer(req));
        // The body schema's refine guarantees exactly one of the two is present.
        const s = req.body.structuredEdit
          ? await deps.suggestions.editStructured(req.params.id, req.body.structuredEdit, actorId(req))
          : await deps.suggestions.edit(req.params.id, req.body.editedPayload!, actorId(req));
        await app.audit(
          req,
          'suggestions.edit',
          'suggestion',
          s.id,
          { payload: before.editedPayload ?? before.payload },
          { payload: s.editedPayload, diff: s.editDiff, structured: !!req.body.structuredEdit },
        );
        return s;
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
      async (req) => {
        const user = req.user;
        return deps.suggestions.publishAccepted(
          req.body.sourceId,
          actorId(req),
          { requestId: req.id, ip: req.ip },
          // Wave Y (A-M6): publishing writes documents, so the caller must hold every world it
          // writes; one out-of-scope target refuses the whole publish (it is one transaction).
          (worlds) => {
            if (user && worlds.length && !hasAllScopes(user, worlds))
              throw httpError(403, 'SCOPE_DENIED', 'ההרשאה שלך מוגבלת לעולמות תוכן אחרים', {
                worlds,
                scopes: user.worldScopes,
              });
          },
        );
      },
    );
  };
}
