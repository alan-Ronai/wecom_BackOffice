import { useEffect, useRef, type ReactNode } from 'react';
import type { AiMessage, SuggestionPayload } from '@wecom/shared';
import { Fmt } from '../Fmt.js';
import type { ChatViewState, SealedReply, ToolChip } from '../../lib/chatReducer.js';
import { ToolChips } from './ToolCallChip.js';
import { ProposedEditsCard } from './ProposedEditsCard.js';
import { RefinedSuggestionCard } from './RefinedSuggestionCard.js';
import { FeedbackButtons } from './FeedbackButtons.js';

/**
 * How an assistant reply's text is rendered.
 *
 * Today: bidi-safe Hebrew with no CRM chip substitution — a model's prose is not a step body, so
 * a stray field name in it should not become a chip. X6 points this at `renderWithStepLinks` from
 * `components/ai/citations.tsx` (**X4b owns that file**), which turns "שלב 3א" into a link to
 * `/doc/:id/:stepKey` when `stepIndex` has the number. `documentId` and `stepIndex` are threaded
 * through for exactly that swap and are otherwise unused.
 */
function renderAnswer(content: string, _documentId: string, _stepIndex?: Record<string, string>): ReactNode {
  return <Fmt text={content} fields={[]} docs={[]} noCrm />;
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
              <span className="chip chip-gray">עריכות מוצעות במסמך המקור</span>
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
