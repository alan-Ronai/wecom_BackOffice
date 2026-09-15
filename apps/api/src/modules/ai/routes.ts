/**
 * Wave 6 (X2) — every `/ai/*` and `/admin/ai/conversations*` route.
 *
 * Route-level `config.requires` is the floor (`ai.ask`), because the tiers nest and the finer
 * rules are not expressible there: an `article` conversation needs only `ai.ask` while the
 * other two kinds need `ai.chat`, and "owner, or `ai.manage`" is a row check, not a permission.
 * Both are done in the handler, and both answer **404** rather than 403 for a conversation that
 * is not the caller's — a transcript they may not read does not exist for them, and a 403 would
 * confirm that the id does.
 *
 * `config.scope: 'document'` is deliberately not used: it reads `params.id`, which on these
 * routes is a conversation, a message or a proposal — never a document. The world scope is
 * checked against the document the conversation is about, in the handler.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ConversationDetailSchema,
  ConversationSchema,
  ConversationsQuerySchema,
  ConversationsResponseSchema,
  CreateConversationBodySchema,
  DecideProposedEditsBodySchema,
  DecideProposedEditsResultSchema,
  IdSchema,
  MessageFeedbackBodySchema,
  SendMessageBodySchema,
  makeEvent,
  type Conversation,
} from '@wecom/shared';
import { getAiSettings, currentPromptVersion } from '../../lib/aiSettings.js';
import { audit } from '../../lib/audit.js';
import { httpError, notFound } from '../../lib/http.js';
import { withTransaction } from '../../lib/sql.js';
import { hasPerm, hasScope, requireUser, type ReqUser } from '../../lib/user.js';
import { getVisibleDocument } from '../documents/repo.js';
import { getSourceDocument, saveSourceDocument } from '../sourcedocs/repo.js';
import { queueIngestRetry, runIngest } from '../sourcedocs/ingestRetry.js';
import type { ChatOrchestrator } from './chat.js';
import { aiChatHolder } from './chatModel.js';
import { streamTranscripts } from './export.js';
import { acceptedOps, applyOps, decisionStatus } from './proposedEdits.js';
import { checkRate } from './rateLimit.js';
import * as repo from './repo.js';
import { openSse } from './sse.js';

const Params = z.object({ id: IdSchema });

export interface AiRouteDeps {
  orchestrator: ChatOrchestrator;
}

/** Owner, or an `ai.manage` admin reading the transcript browser. Anything else is a 404. */
const readable = (c: Conversation, user: ReqUser): boolean =>
  c.userId === user.id || hasPerm(user, 'ai.manage');

export default function aiRoutes(deps: AiRouteDeps) {
  return async function routes(instance: FastifyInstance) {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    const settings = () => getAiSettings(app.db);

    /** The conversation, or a 404 — never a 403, and never a row the caller may not read. */
    const ownConversation = async (id: string, user: ReqUser, mustOwn = true) => {
      const c = await repo.getConversation(app.db, id);
      if (!c) throw notFound('השיחה');
      if (mustOwn ? c.userId !== user.id && !hasPerm(user, 'ai.manage') : !readable(c, user))
        throw notFound('השיחה');
      return c;
    };

    /* ── conversations ─────────────────────────────────────────────────── */

    app.post(
      '/ai/conversations',
      {
        config: { requires: ['ai.ask'] },
        schema: {
          tags: ['ai'],
          body: CreateConversationBodySchema,
          response: { 201: ConversationSchema },
        },
      },
      async (req, reply) => {
        const user = requireUser(req);
        const body = req.body;
        // `article` is the reader's pane; every other kind is an editing surface.
        if (body.kind !== 'article' && !hasPerm(user, 'ai.chat'))
          throw httpError(403, 'FORBIDDEN', 'אין לך הרשאה לשיחה מסוג זה', { permission: 'ai.chat' });
        if (body.documentId) {
          const doc = await getVisibleDocument(app.db, body.documentId, user).catch(() => null);
          if (!doc) throw notFound('המסמך');
          if (!hasScope(user, doc.worlds)) throw notFound('המסמך');
        }
        const s = await settings();
        const c = await withTransaction(app.db, (tx) =>
          repo.createConversation(tx, {
            kind: body.kind,
            documentId: body.documentId ?? null,
            sourceRevisionId: body.sourceRevisionId ?? null,
            userId: user.id,
            title: body.title ?? '',
            model: aiChatHolder.name,
            promptVersion: currentPromptVersion(s),
          }),
        );
        return reply.code(201).send(c);
      },
    );

    app.get(
      '/ai/conversations',
      {
        config: { requires: ['ai.ask'] },
        schema: {
          tags: ['ai'],
          querystring: ConversationsQuerySchema,
          response: { 200: ConversationsResponseSchema },
        },
      },
      async (req) => {
        const user = requireUser(req);
        const query = req.query;
        // Own conversations unless an `ai.manage` admin explicitly asked to see everyone's.
        const all = hasPerm(user, 'ai.manage') && query.mine === false;
        const { items, total } = await repo.listConversations(app.db, {
          ...query,
          userId: all ? (query.userId ?? null) : user.id,
        });
        return { items, total, page: query.page, pageSize: query.pageSize };
      },
    );

    app.get(
      '/ai/conversations/:id',
      {
        config: { requires: ['ai.ask'] },
        schema: { tags: ['ai'], params: Params, response: { 200: ConversationDetailSchema } },
      },
      async (req) => {
        const user = requireUser(req);
        const conversation = await ownConversation(req.params.id, user);
        return {
          conversation,
          messages: await repo.listMessages(app.db, conversation.id, user.id),
        };
      },
    );

    /**
     * The streaming turn. `hide: true` follows the `/events` precedent: the response is an SSE
     * frame sequence, not a JSON body, and describing it as one in OpenAPI would generate a
     * client that tries to parse it. Route coverage is an integration test naming the path
     * (`ai-chat.test.ts`), the same way `/events` is covered.
     */
    app.post(
      '/ai/conversations/:id/messages',
      {
        config: { requires: ['ai.ask'] },
        schema: { tags: ['ai'], params: Params, body: SendMessageBodySchema, hide: true },
      },
      async (req, reply) => {
        const user = requireUser(req);
        const conversation = await ownConversation(req.params.id, user, true);
        if (conversation.userId !== user.id)
          throw httpError(403, 'FORBIDDEN', 'אפשר לכתוב רק בשיחה שלך');
        if (conversation.kind !== 'article' && !hasPerm(user, 'ai.chat'))
          throw httpError(403, 'FORBIDDEN', 'אין לך הרשאה לשיחה מסוג זה', { permission: 'ai.chat' });

        const s = await settings();
        const rate = checkRate(user.id, s.limits.chatPerUserPerHour);
        if (!rate.ok) {
          reply.header('retry-after', String(rate.retryAfterSec));
          throw httpError(429, 'AI_RATE_LIMITED', 'הגעת למכסת ההודעות לשעה, נסה שוב בעוד רגע', {
            retryAfterSec: rate.retryAfterSec,
          });
        }
        if (!(await aiChatHolder.available()))
          throw httpError(503, 'AI_UNAVAILABLE', 'מודל הצ׳אט אינו זמין כרגע');

        const sse = openSse(reply);
        try {
          await deps.orchestrator.run({
            conversation,
            user,
            content: req.body.content,
            context: req.body.context,
            emit: (e) => sse.send(e),
            signal: sse.signal,
          });
        } catch (err) {
          // `run` handles its own failures; this is the belt for anything it could not.
          req.log.error({ err }, 'chat run failed outside the orchestrator');
          sse.send({ type: 'error', code: 'AI_FAILED', message: 'המודל לא הצליח לענות' });
        } finally {
          sse.close();
        }
      },
    );

    /* ── feedback ──────────────────────────────────────────────────────── */

    app.post(
      '/ai/messages/:id/feedback',
      {
        config: { requires: ['ai.ask'] },
        schema: {
          tags: ['ai'],
          params: Params,
          body: MessageFeedbackBodySchema,
          response: { 204: z.null() },
        },
      },
      async (req, reply) => {
        const user = requireUser(req);
        const conversation = await repo.conversationOfMessage(app.db, req.params.id);
        // Only a participant rates a message; an admin browsing transcripts does not vote.
        if (!conversation || conversation.userId !== user.id) throw notFound('ההודעה');
        await withTransaction(app.db, (tx) =>
          repo.setFeedback(tx, req.params.id, user.id, req.body.rating, req.body.note ?? ''),
        );
        return reply.code(204).send(null);
      },
    );

    /* ── the one write path into content ───────────────────────────────── */

    app.post(
      '/ai/proposed-edits/:id/decide',
      {
        config: { requires: ['ai.chat', 'docs.edit'] },
        schema: {
          tags: ['ai'],
          params: Params,
          body: DecideProposedEditsBodySchema,
          response: { 200: DecideProposedEditsResultSchema },
        },
      },
      async (req) => decide(app, req, req.params.id, req.body),
    );

    /* ── admin transcript browser ──────────────────────────────────────── */

    app.get(
      '/admin/ai/conversations',
      {
        config: { requires: ['ai.manage'] },
        schema: {
          tags: ['ai'],
          querystring: ConversationsQuerySchema,
          response: { 200: ConversationsResponseSchema },
        },
      },
      async (req) => {
        const query = req.query;
        const { items, total } = await repo.listConversations(app.db, {
          ...query,
          userId: query.userId ?? null,
        });
        return { items, total, page: query.page, pageSize: query.pageSize };
      },
    );

    app.get(
      '/admin/ai/conversations/export.jsonl',
      {
        config: { requires: ['ai.manage'] },
        schema: { tags: ['ai'], querystring: ConversationsQuerySchema, hide: true },
      },
      async (req, reply) => {
        const query = req.query;
        await streamTranscripts(
          app.db,
          {
            userId: query.userId,
            documentId: query.documentId,
            from: query.from,
            to: query.to,
          },
          reply,
        );
      },
    );

    app.delete(
      '/admin/ai/conversations/:id',
      {
        config: { requires: ['ai.manage'] },
        schema: { tags: ['ai'], params: Params, response: { 204: z.null() } },
      },
      async (req, reply) => {
        const user = requireUser(req);
        const gone = await withTransaction(app.db, async (tx) => {
          const ok = await repo.softDeleteConversation(tx, req.params.id);
          if (ok)
            await audit(tx, {
              actorId: user.id,
              action: 'ai.conversation.delete',
              entityType: 'ai_conversation',
              entityId: req.params.id,
              before: null,
              after: null,
              requestId: req.id,
              ip: req.ip,
            });
          return ok;
        });
        if (!gone) throw notFound('השיחה');
        return reply.code(204).send(null);
      },
    );
  };
}

/**
 * Apply the accepted hunks as one ordinary source save.
 *
 * Every guard here is a way the proposal can have gone stale between the model writing it and
 * the person clicking: the proposal was already decided (409 `ALREADY_DECIDED`), the source
 * moved (409 `SOURCE_MOVED`, from the version *and* from `If-Match` on the etag), or one hunk's
 * anchor text moved (409 `AI_EDIT_ANCHOR`, from `applyOps`). Rejecting everything is a decision
 * too: the row is marked and no save happens at all.
 */
async function decide(
  app: FastifyInstance,
  req: FastifyRequest,
  id: string,
  body: { accept: string[] | 'all'; reject: string[] | 'all' },
) {
  const user = requireUser(req);
  const pe = await repo.getProposedEdits(app.db, id);
  if (!pe) throw notFound('ההצעה');
  const conversation = await repo.conversationOfProposedEdits(app.db, id);
  if (!conversation || !readable(conversation, user)) throw notFound('ההצעה');
  if (pe.status !== 'proposed') throw httpError(409, 'ALREADY_DECIDED', 'ההצעה כבר הוכרעה');

  const doc = await getVisibleDocument(app.db, pe.documentId, user).catch(() => null);
  if (!doc || !hasScope(user, doc.worlds)) throw notFound('המסמך');

  const applied = acceptedOps(pe.ops, body);
  const status = decisionStatus(pe.ops, applied);

  if (!applied.length) {
    const row = await withTransaction(app.db, (tx) =>
      repo.decideProposedEdits(tx, id, status, user.id, null),
    );
    if (!row) throw httpError(409, 'ALREADY_DECIDED', 'ההצעה כבר הוכרעה');
    return { status: row.status, resultingSourceVersion: null };
  }

  const current = await getSourceDocument(app.db, pe.documentId);
  if (!current) throw notFound('מסמך המקור');
  if (current.version !== pe.baseSourceVersion)
    throw httpError(409, 'SOURCE_MOVED', 'מסמך המקור השתנה מאז ההצעה — פתח את הצ׳אט מחדש');

  const html = applyOps(current.html, applied);

  const saved = await withTransaction(app.db, async (tx) => {
    const decided = await repo.decideProposedEdits(tx, id, status, user.id, null);
    if (!decided) throw httpError(409, 'ALREADY_DECIDED', 'ההצעה כבר הוכרעה');
    let s;
    try {
      s = await saveSourceDocument(tx, pe.documentId, {
        html,
        label: 'מהצ׳אט',
        authorId: user.id,
        ifMatch: current.etag,
      });
    } catch (e) {
      // The etag half of the same race the version check above covers.
      if ((e as { code?: string }).code === 'ETAG_MISMATCH')
        throw httpError(409, 'SOURCE_MOVED', 'מסמך המקור השתנה מאז ההצעה — פתח את הצ׳אט מחדש');
      throw e;
    }
    // The claim above already moved the row out of `proposed`; this only stamps the result.
    await tx.query('update ai_proposed_edits set resulting_source_version=$2 where id=$1', [
      id,
      s.version,
    ]);
    await audit(tx, {
      actorId: user.id,
      action: 'ai.proposed_edits.apply',
      entityType: 'source_document',
      entityId: pe.documentId,
      before: { version: current.version },
      after: {
        version: s.version,
        accepted: applied.map((o) => o.id),
        messageId: pe.messageId,
        proposedEditsId: id,
      },
      requestId: req.id,
      ip: req.ip,
    });
    await app.events.publish(
      tx,
      makeEvent('source_document.saved', {
        documentId: pe.documentId,
        version: s.version,
        actorId: user.id,
      }),
    );
    return s;
  });

  /**
   * The version row is already durable; the ingest is the same best-effort-with-retry the
   * ordinary `PUT /source` uses (`sourcedocs/routes.ts`), so a pipeline outage cannot fail a
   * decision that has committed.
   */
  try {
    await runIngest(app, pe.documentId, saved.version, saved.html, user.id);
  } catch (err) {
    req.log.error({ err, documentId: pe.documentId }, 'chat edit ingest failed; queued a retry');
    await queueIngestRetry(app, req, pe.documentId, saved.version, user.id);
  }

  return { status, resultingSourceVersion: saved.version };
}
