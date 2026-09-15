/**
 * Wave 6 (X2) — the chat orchestrator.
 *
 * One turn is: build the system prompt inside the context budget, persist the user message,
 * then run a bounded tool loop (`MAX_TOOL_ROUNDS`) in which every frame the browser sees is
 * also a row in `ai_messages`. The stream is a rendering of the transcript, never the other
 * way round: a dropped connection loses the rendering and keeps the transcript, which is what
 * makes the admin export (spec §1.5) worth having.
 *
 * Two invariants are enforced here rather than trusted to the model:
 *
 * - **The tool set is the caller's tier narrowed by the conversation kind.** An `article`
 *   conversation gets the four ask tools even for an admin — a reader's pane is not an editing
 *   surface — and `runTool` refuses anything outside that set a second time.
 * - **Nothing written here touches content.** `propose_source_edit` produces an
 *   `ai_proposed_edits` row and a frame; the document changes only when a person clicks
 *   (`POST /ai/proposed-edits/:id/decide`).
 */
import type pg from 'pg';
import type { ChatMessage, ModelClient } from '@wecom/model';
import {
  makeEvent,
  toolsFor,
  type AiMessage,
  type AiSettings,
  type AiToolName,
  type AiToolResult,
  type ChatEvent,
  type Conversation,
  type ConversationKind,
  type Document,
  type SendMessageContext,
} from '@wecom/shared';
import type { FastifyBaseLogger } from 'fastify';
import { currentPromptVersion } from '../../lib/aiSettings.js';
import type { EventBus } from '../../lib/events.js';
import { withTransaction } from '../../lib/sql.js';
import type { ReqUser } from '../../lib/user.js';
import { getSourceDocument } from '../sourcedocs/repo.js';
import type { ChatModelHolder } from './chatModel.js';
import { buildSystemPrompt, titleFrom, withContext } from './prompt.js';
import * as repo from './repo.js';
import { runTool, specsFor, type ToolCtx } from './tools/index.js';
import { visibleDocument } from './tools/read.js';

/** Six rounds is a CPU-only budget, not a capability claim: past it, the turn answers anyway. */
export const MAX_TOOL_ROUNDS = 6;

const ASK_TOOLS: AiToolName[] = ['read_document', 'read_topic', 'search_kb', 'explain_step'];

/**
 * The conversation kind caps the tool set on top of the permission tier. `article` is the
 * reader's pane on one document: an editor who opens it is reading, not editing, and a pane
 * that could propose edits from there would be an editing surface nobody reviewed.
 */
export const KIND_TOOLS: Record<ConversationKind, AiToolName[] | null> = {
  article: ASK_TOOLS,
  editor: null, // null = whatever the caller's tier allows
  workspace: null,
};

export const allowedTools = (user: ReqUser, kind: ConversationKind): AiToolName[] => {
  const tier = toolsFor(user.permissions);
  const cap = KIND_TOOLS[kind];
  return cap ? tier.filter((t) => cap.includes(t)) : tier;
};

/** Persisted history → the model's message list. Tool rows replay as `tool` turns. */
const toChatMessages = (messages: readonly AiMessage[]): ChatMessage[] =>
  messages.flatMap((m): ChatMessage[] => {
    if (m.role === 'user') return [{ role: 'user', content: m.content }];
    if (m.role === 'assistant')
      return [
        {
          role: 'assistant',
          content: m.content,
          ...(m.toolCalls.length ? { toolCalls: m.toolCalls } : {}),
        },
      ];
    if (m.role === 'tool')
      return m.toolResults.map((r) => ({
        role: 'tool' as const,
        toolCallId: r.id,
        content: JSON.stringify({ ok: r.ok, summary: r.summary, data: r.payload }).slice(0, 12_000),
      }));
    return [];
  });

export interface OrchestratorDeps {
  db: pg.Pool;
  chat: ChatModelHolder;
  events: EventBus;
  log: FastifyBaseLogger;
  settings: () => Promise<AiSettings>;
}

export interface RunInput {
  conversation: Conversation;
  user: ReqUser;
  content: string;
  context?: SendMessageContext;
  emit: (e: ChatEvent) => void;
  signal: AbortSignal;
}

/** What one tool call contributed to the turn, for the row and for the stream. */
interface ToolOutcomeRow {
  result: AiToolResult;
  proposedEditsId: string | null;
}

export class ChatOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  /**
   * Streams to `emit` in order and persists as it goes. Never throws after the first frame:
   * a failure becomes an `error` frame followed by the terminal `done`, so the pane always has
   * an end of stream to render and the transcript always has a final assistant row.
   */
  async run(input: RunInput): Promise<{ messageId: string }> {
    const started = Date.now();
    const settings = await this.deps.settings();
    const promptVersion = currentPromptVersion(settings);
    const modelName = this.deps.chat.name;
    const allowed = allowedTools(input.user, input.conversation.kind);
    const allowedSet = new Set(allowed);

    const document = input.conversation.documentId
      ? await this.documentFor(input.conversation.documentId, input.user, settings)
      : null;
    const source =
      document && allowed.includes('read_source')
        ? await getSourceDocument(this.deps.db, document.id)
        : null;

    const history = await repo.listMessages(this.deps.db, input.conversation.id);
    const system = buildSystemPrompt({
      settings,
      kind: input.conversation.kind,
      document,
      source: source ? { version: source.version, text: source.text } : null,
      allowed,
      budgetChars: settings.limits.maxContextChars,
    });

    const userContent = withContext(input.content, input.context);
    await withTransaction(this.deps.db, async (tx) =>
      repo.insertMessage(tx, {
        conversationId: input.conversation.id,
        seq: await repo.nextSeq(tx, input.conversation.id),
        role: 'user',
        content: input.content,
        toolCalls: [],
        toolResults: [],
        proposedEditsId: null,
        refinedSuggestionId: null,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: 0,
        model: modelName,
        promptVersion,
      }),
    );

    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      ...toChatMessages(history),
      { role: 'user', content: userContent },
    ];

    const toolCtx: ToolCtx = {
      db: this.deps.db,
      user: input.user,
      conversation: input.conversation,
      document,
      model: this.deps.chat,
      settings,
      log: this.deps.log,
    };

    let tokensIn = 0;
    let tokensOut = 0;
    let finalContent = '';
    let refinedSuggestionId: string | null = null;

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const lastRound = round === MAX_TOOL_ROUNDS;
        const r = await this.deps.chat.chat({
          messages,
          // The final round is tool-less: the loop has to end with an answer, not another ask.
          tools: lastRound ? [] : specsFor(allowed),
          onToken: (t) => input.emit({ type: 'token', text: t }),
          signal: input.signal,
        });
        tokensIn += r.tokensIn;
        tokensOut += r.tokensOut;
        if (!r.toolCalls.length || lastRound) {
          finalContent = r.content;
          break;
        }

        await withTransaction(this.deps.db, async (tx) =>
          repo.insertMessage(tx, {
            conversationId: input.conversation.id,
            seq: await repo.nextSeq(tx, input.conversation.id),
            role: 'assistant',
            content: r.content,
            toolCalls: r.toolCalls,
            toolResults: [],
            proposedEditsId: null,
            refinedSuggestionId: null,
            tokensIn: r.tokensIn,
            tokensOut: r.tokensOut,
            latencyMs: 0,
            model: modelName,
            promptVersion,
          }),
        );
        messages.push({ role: 'assistant', content: r.content, toolCalls: r.toolCalls });

        /**
         * The tool row is inserted *before* the tools run: `ai_proposed_edits.message_id`
         * references it, so there is no insert order in which the proposal could come first.
         * It is patched with the results afterwards.
         */
        const toolMessage = await withTransaction(this.deps.db, async (tx) =>
          repo.insertMessage(tx, {
            conversationId: input.conversation.id,
            seq: await repo.nextSeq(tx, input.conversation.id),
            role: 'tool',
            content: '',
            toolCalls: [],
            toolResults: [],
            proposedEditsId: null,
            refinedSuggestionId: null,
            tokensIn: 0,
            tokensOut: 0,
            latencyMs: 0,
            model: modelName,
            promptVersion,
          }),
        );

        const rows: ToolOutcomeRow[] = [];
        for (const call of r.toolCalls) {
          input.emit({ type: 'tool_call', id: call.id, name: call.name, args: call.args });
          const res = await runTool(toolCtx, allowedSet, call);
          const payload = res.ok ? res.data : undefined;
          input.emit({
            type: 'tool_result',
            id: call.id,
            name: call.name,
            ok: res.ok,
            summary: res.summary,
            ...(payload === undefined ? {} : { payload }),
          });

          let proposedEditsId: string | null = null;
          if (res.ok && res.proposedEdits?.length && document && source) {
            const pe = await withTransaction(this.deps.db, (tx) =>
              repo.createProposedEdits(tx, {
                messageId: toolMessage.id,
                documentId: document.id,
                baseSourceVersion: source.version,
                ops: res.proposedEdits!,
              }),
            );
            proposedEditsId = pe.id;
            input.emit({
              type: 'proposed_edits',
              proposedEditsId: pe.id,
              documentId: pe.documentId,
              baseSourceVersion: pe.baseSourceVersion,
              ops: pe.ops,
            });
          }
          if (res.ok && res.refined) {
            refinedSuggestionId = res.refined.suggestionId;
            input.emit({
              type: 'refined_suggestion',
              suggestionId: res.refined.suggestionId,
              editedPayload: res.refined.editedPayload,
            });
          }

          rows.push({
            result: { id: call.id, name: call.name, ok: res.ok, summary: res.summary, payload },
            proposedEditsId,
          });
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            content: JSON.stringify(
              res.ok ? { ok: true, data: res.data } : { ok: false, error: res.summary },
            ).slice(0, 12_000),
          });
        }

        await withTransaction(this.deps.db, (tx) =>
          repo.updateMessage(tx, toolMessage.id, {
            toolResults: rows.map((x) => x.result),
            proposedEditsId: rows.find((x) => x.proposedEditsId)?.proposedEditsId ?? null,
          }),
        );
      }
    } catch (e) {
      const aborted = input.signal.aborted;
      input.emit({
        type: 'error',
        code: aborted ? 'AI_ABORTED' : 'AI_FAILED',
        message: aborted ? 'הבקשה בוטלה' : 'המודל לא הצליח לענות',
      });
      this.deps.log.warn({ err: (e as Error).message }, 'chat failed');
    }

    const latencyMs = Date.now() - started;
    const done = await withTransaction(this.deps.db, async (tx) => {
      const m = await repo.insertMessage(tx, {
        conversationId: input.conversation.id,
        seq: await repo.nextSeq(tx, input.conversation.id),
        role: 'assistant',
        content: finalContent,
        toolCalls: [],
        toolResults: [],
        proposedEditsId: null,
        refinedSuggestionId,
        tokensIn,
        tokensOut,
        latencyMs,
        model: modelName,
        promptVersion,
      });
      await repo.touchConversation(tx, input.conversation.id, titleFrom(input.content));
      await this.deps.events.publish(
        tx,
        makeEvent('ai.message', {
          conversationId: input.conversation.id,
          messageId: m.id,
          userId: input.user.id,
        }),
      );
      return m;
    });
    input.emit({ type: 'done', messageId: done.id, tokensIn, tokensOut, latencyMs });
    return { messageId: done.id };
  }

  /** The conversation's document, or null — never a throw, and never an invisible one. */
  private async documentFor(
    documentId: string,
    user: ReqUser,
    settings: AiSettings,
  ): Promise<Document | null> {
    return visibleDocument(
      {
        db: this.deps.db,
        user,
        settings,
        log: this.deps.log,
      } as unknown as ToolCtx,
      documentId,
    );
  }
}

export type { ModelClient };
