import { useEffect, useRef, useState } from 'react';
import type { AiToolName, ProposedEdits, SuggestionPayload } from '@wecom/shared';
import { useCan } from '../../api/hooks/me.js';
import {
  useConversation,
  useConversationFor,
  useDecideProposedEdits,
  useMessageFeedback,
  useSendMessage,
} from '../../api/hooks/ai.js';
import { useToast } from '../ui/Toast.js';
import { Composer } from './Composer.js';
import { MessageList } from './MessageList.js';
import { parseRefinedPayload } from './RefinedSuggestionCard.js';

export interface ChatContext {
  stepKey?: string;
  suggestionId?: string;
  selection?: string;
}
export type ChatKind = 'workspace' | 'editor' | 'article';

const KIND_LABEL: Record<ChatKind, string> = {
  workspace: 'סביבת העבודה',
  editor: 'עורך השלבים',
  article: 'שאל את המערכת',
};

export interface ChatPaneProps {
  kind: ChatKind;
  documentId: string;
  sourceRevisionId?: string;
  /**
   * Pinned context for the next send. Memoize it at the mount: the pane copies it into state on
   * every identity change, so a fresh `{ stepKey }` object per parent render would keep undoing
   * the reader's "הסר הקשר".
   */
  context?: ChatContext;
  /**
   * Hard-disables the composer, whatever the caller's permissions. **No host passes it today** —
   * it is the seam for a future read-only transcript view (an admin reading someone else's
   * conversation, a printed hand-off), and it is deliberately *not* how the article page works:
   * "read-only Q&A" there is about the tool set, not about the composer.
   */
  readOnly?: boolean;
  compact?: boolean;
  onProposedEdits?: (pe: ProposedEdits) => void;
  onRefinedSuggestion?: (suggestionId: string, payload: SuggestionPayload) => void;
  /** Generic hand-off for tool results that carry a payload (`draft_step` → the editor dock). */
  onToolResult?: (name: AiToolName, payload: unknown, messageId: string) => void;
  /** step num → step key, so citations like "שלב 3א" become links to `/doc/:id/:stepKey`. */
  stepIndex?: Record<string, string>;
  className?: string;
}

/**
 * The shared chat pane — one component for all three kinds (`/workspace/:id`, the step editor,
 * the article page); X4b mounts the other two.
 *
 * Which tools the model may call is decided server-side from the caller's permissions. Here the
 * pane only decides whether to render at all (`ai.ask`) and whether the composer writes
 * (`ai.chat`, or `ai.ask` on the article page, where the server restricts the tool set instead).
 * Nothing the model returns is applied without a click.
 */
export function ChatPane({
  kind,
  documentId,
  sourceRevisionId,
  context,
  readOnly,
  compact,
  onProposedEdits,
  onRefinedSuggestion,
  onToolResult,
  stepIndex,
  className,
}: ChatPaneProps) {
  const can = useCan();
  const mayAsk = can('ai.ask');
  const mayChat = can('ai.chat');
  const conv = useConversationFor(kind, documentId, { enabled: mayAsk, sourceRevisionId });
  const [convId, setConvId] = useState<string | null>(null);
  useEffect(() => {
    if (conv.conversation) setConvId(conv.conversation.id);
  }, [conv.conversation]);

  const detail = useConversation(convId);
  const chat = useSendMessage(convId);
  const decide = useDecideProposedEdits(documentId);
  const feedback = useMessageFeedback();
  const toast = useToast();
  const [ctx, setCtx] = useState<ChatContext | undefined>(context);
  useEffect(() => setCtx(context), [context]);

  // Hand proposed edits / refinements / tool payloads to the host as soon as the reply seals.
  const last = chat.view.sealed.at(-1);
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!last || handled.current === last.messageId) return;
    handled.current = last.messageId;
    if (last.proposed && onProposedEdits)
      onProposedEdits({
        id: last.proposed.proposedEditsId,
        messageId: last.messageId,
        documentId: last.proposed.documentId,
        // From the event. Never fabricated: the apply path sends it as `If-Match`.
        baseSourceVersion: last.proposed.baseSourceVersion,
        ops: last.proposed.ops,
        status: 'proposed',
        decidedBy: null,
        decidedAt: null,
        resultingSourceVersion: null,
      });
    if (last.refined && onRefinedSuggestion) {
      // The stream types `editedPayload` as unknown; a payload that is not one is not handed on.
      const payload = parseRefinedPayload(last.refined.editedPayload);
      if (payload) onRefinedSuggestion(last.refined.suggestionId, payload);
    }
    if (onToolResult)
      for (const t of last.tools)
        if (t.ok && t.payload !== undefined) onToolResult(t.name as AiToolName, t.payload, last.messageId);
  }, [last, onProposedEdits, onRefinedSuggestion, onToolResult]);

  if (!mayAsk) return null;

  const canSend = !readOnly && (mayChat || kind === 'article');
  const sel = ctx?.selection;
  const contextLabel = ctx?.suggestionId
    ? 'הקשר: הצעה'
    : ctx?.stepKey
      ? `הקשר: שלב ${ctx.stepKey}`
      : sel
        ? `הקשר: "${sel.slice(0, 40)}${sel.length > 40 ? '…' : ''}"`
        : undefined;

  const send = async (content: string): Promise<void> => {
    let id = convId;
    if (!id) {
      try {
        id = (await conv.create()).id;
        setConvId(id);
      } catch {
        toast('לא ניתן לפתוח שיחה', 'warn');
        return;
      }
    }
    chat.send({ content, ...(contextLabel ? { context: ctx } : {}) }, id);
  };

  return (
    <div
      className={'chat-pane' + (compact ? ' compact' : '') + (className ? ' ' + className : '')}
      dir="rtl"
      /*
       * No `aria-label` here. It used to carry `KIND_LABEL[kind]`, which a screen reader never
       * announced — an `aria-label` on a bare `<div>` has no role to hang it on. Promoting it to
       * `role="region"` would have been worse, not better: all three hosts already wrap this pane
       * in a landmark carrying the same name (`<section aria-label="סביבת העבודה">`,
       * `<section aria-label="שאל את המערכת">`, `<aside aria-label="צ'אט עם המערכת">`), so the
       * page would announce the region twice and `getByRole('region', …)` would match two nodes.
       * The name belongs to the host; the visible `<b>` below repeats it for sighted readers.
       */
    >
      <div className="chat-head">
        <b>{KIND_LABEL[kind]}</b>
        <span className="small muted">{detail.data?.conversation.model ?? ''}</span>
      </div>
      <MessageList
        history={detail.data?.messages ?? []}
        view={chat.view}
        streaming={chat.isStreaming}
        documentId={documentId}
        stepIndex={stepIndex}
        /* `kind !== 'article'`: the server's kind-narrowing already means a `proposed_edits`
           frame cannot reach the article pane, but the pane's own claim — no write actions here —
           should be true locally too, not only because something upstream holds the line. */
        canDecide={canSend && mayChat && kind !== 'article' && can('docs.edit')}
        onAcceptOps={(peId, ids) => decide.mutate({ id: peId, accept: ids, reject: [] })}
        onRejectOps={(peId, ids) => decide.mutate({ id: peId, accept: [], reject: ids })}
        onAcceptAll={(peId) => decide.mutate({ id: peId, accept: 'all', reject: [] })}
        onApplyRefined={onRefinedSuggestion}
        onFeedback={(messageId, rating, note) => feedback.mutate({ messageId, rating, note })}
      />
      {chat.error ? (
        <div role="alert" className="chat-error">
          {chat.error}
        </div>
      ) : null}
      <Composer
        disabled={!canSend}
        streaming={chat.isStreaming}
        contextLabel={contextLabel}
        onClearContext={() => setCtx(undefined)}
        onSend={(t) => void send(t)}
        onStop={chat.stop}
      />
    </div>
  );
}
