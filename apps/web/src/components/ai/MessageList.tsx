import { useEffect, useRef, type ReactNode } from 'react';
import type { AiMessage, SuggestionPayload } from '@wecom/shared';
import type { ChatViewState, SealedReply, ToolChip } from '../../lib/chatReducer.js';
import { renderWithStepLinks } from './citations.js';
import { ToolChips } from './ToolCallChip.js';
import { ProposedEditsCard } from './ProposedEditsCard.js';
import { useProposedEdits } from '../../api/hooks/ai.js';
import { RefinedSuggestionCard } from './RefinedSuggestionCard.js';
import { FeedbackButtons } from './FeedbackButtons.js';

/**
 * How an assistant reply's text is rendered.
 *
 * `renderWithStepLinks` (`components/ai/citations.tsx`) splits the reply on step citations: the
 * prose between them is rendered by `<Fmt>` — bidi-safe Hebrew, escaped, with CRM chip
 * substitution off, because a model's prose is not a step body — and "שלב 3א" becomes a link to
 * `/doc/:id/:stepKey` when `stepIndex` carries the number. All three panes pass `stepIndex`; a
 * number the map does not know still links, to the number itself.
 */
function renderAnswer(content: string, documentId: string, stepIndex?: Record<string, string>): ReactNode {
  return renderWithStepLinks(content, documentId, stepIndex);
}

const toolChipsOf = (m: AiMessage): ToolChip[] => {
  const results = new Map(m.toolResults.map((r) => [r.id, r]));
  const chips: ToolChip[] = m.toolCalls.map((c) => ({
    id: c.id,
    name: c.name,
    args: c.args,
    ok: results.get(c.id)?.ok,
    summary: results.get(c.id)?.summary,
    payload: results.get(c.id)?.payload,
  }));
  for (const r of m.toolResults)
    if (!chips.some((c) => c.id === r.id))
      chips.push({ id: r.id, name: r.name, args: {}, ok: r.ok, summary: r.summary, payload: r.payload });
  return chips;
};

export interface MessageListProps {
  history: AiMessage[];
  view: ChatViewState;
  streaming: boolean;
  documentId: string;
  stepIndex?: Record<string, string>;
  /** `ai.chat` + `docs.edit`: without both, hunks are shown read-only. */
  canDecide: boolean;
  onAcceptOps: (proposedEditsId: string, ids: string[]) => void;
  onRejectOps: (proposedEditsId: string, ids: string[]) => void;
  onAcceptAll: (proposedEditsId: string) => void;
  onApplyRefined?: (suggestionId: string, payload: SuggestionPayload) => void;
  onFeedback: (messageId: string, rating: 'up' | 'down', note?: string) => void;
}

export function MessageList({
  history,
  view,
  streaming,
  documentId,
  stepIndex,
  canDecide,
  onAcceptOps,
  onRejectOps,
  onAcceptAll,
  onApplyRefined,
  onFeedback,
}: MessageListProps) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  // A reply the server has already persisted arrives twice — once from the reducer, once in the
  // refetched transcript. The transcript wins; the rendered copy is dropped by message id.
  const seen = new Set(history.map((m) => m.id));
  const pending: SealedReply[] = view.sealed.filter((s) => !seen.has(s.messageId));

  return (
    <div
      className="chat-messages"
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {history
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => (
          <div key={m.id} className={'chat-msg ' + m.role}>
            {m.role === 'assistant' ? <ToolChips tools={toolChipsOf(m)} /> : null}
            <div className="chat-text">
              {m.role === 'assistant' ? renderAnswer(m.content, documentId, stepIndex) : m.content}
            </div>
            {m.role === 'assistant' && m.proposedEditsId ? (
              <HistoryProposedEdits
                proposedEditsId={m.proposedEditsId}
                canDecide={canDecide}
                onAccept={onAcceptOps}
                onReject={onRejectOps}
                onAcceptAll={onAcceptAll}
              />
            ) : null}
            {m.role === 'assistant' ? (
              <FeedbackButtons messageId={m.id} initial={m.feedback} onRate={onFeedback} />
            ) : null}
          </div>
        ))}

      {pending.map((s) => (
        <div key={s.messageId} className="chat-msg assistant">
          <ToolChips tools={s.tools} />
          <div className="chat-text">{renderAnswer(s.content, documentId, stepIndex)}</div>
          {s.proposed ? (
            <ProposedEditsCard
              ops={s.proposed.ops}
              disabled={!canDecide}
              onAccept={(ids) => onAcceptOps(s.proposed!.proposedEditsId, ids)}
              onReject={(ids) => onRejectOps(s.proposed!.proposedEditsId, ids)}
              onAcceptAll={() => onAcceptAll(s.proposed!.proposedEditsId)}
            />
          ) : null}
          {s.refined ? (
            <RefinedSuggestionCard
              suggestionId={s.refined.suggestionId}
              editedPayload={s.refined.editedPayload}
              onApply={onApplyRefined}
            />
          ) : null}
          <FeedbackButtons messageId={s.messageId} onRate={onFeedback} />
        </div>
      ))}

      {view.streaming ? (
        <div className={'chat-msg assistant' + (streaming ? ' streaming' : '')} aria-live="polite">
          <ToolChips tools={view.streaming.tools} />
          <div className="chat-text">{renderAnswer(view.streaming.content, documentId, stepIndex)}</div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * X6 seam: the hunks behind a *history* message.
 *
 * A reply streamed in this session carries its ops in the `proposed_edits` frame, so the card
 * above renders without a fetch. A transcript read back after a reload has only the id, and the
 * chip that used to stand here was a dead end — `GET /ai/proposed-edits/:id` is what fills it in.
 * A proposal already decided is shown as a chip again rather than as live accept/reject buttons:
 * the decision is made, and offering it twice would invite a 409.
 */
function HistoryProposedEdits({
  proposedEditsId,
  canDecide,
  onAccept,
  onReject,
  onAcceptAll,
}: {
  proposedEditsId: string;
  canDecide: boolean;
  onAccept: (id: string, ids: string[]) => void;
  onReject: (id: string, ids: string[]) => void;
  onAcceptAll: (id: string) => void;
}) {
  const pe = useProposedEdits(proposedEditsId);
  if (!pe.data) return <span className="chip chip-gray">עריכות מוצעות במסמך המקור</span>;
  if (pe.data.status !== 'proposed')
    return <span className="chip chip-gray">עריכות מוצעות · {DECIDED[pe.data.status]}</span>;
  return (
    <ProposedEditsCard
      ops={pe.data.ops}
      disabled={!canDecide}
      onAccept={(ids) => onAccept(proposedEditsId, ids)}
      onReject={(ids) => onReject(proposedEditsId, ids)}
      onAcceptAll={() => onAcceptAll(proposedEditsId)}
    />
  );
}

const DECIDED: Record<string, string> = {
  accepted: 'אושרו',
  rejected: 'נדחו',
  partially_accepted: 'אושרו חלקית',
};
