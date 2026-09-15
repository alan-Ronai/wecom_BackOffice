import { useId, useState } from 'react';
import { useCan } from '../../api/hooks/me.js';
import { ChatPane } from './ChatPane.js';

export const ASK_TITLE = 'שאל את המערכת';

/**
 * The agent's read-only Q&A on the article page (spec §5 "Article page").
 *
 * Collapsed by default and deliberately small: the article is what an agent is reading mid-call,
 * and a chat box that opens itself would push the step they are standing on off the screen. The
 * answer set is `ai.ask` — no write tools reach it, and every read tool applies the visibility
 * rule, so nothing unpublished can be quoted back.
 *
 * `stepIndex` (step number → step key) is what turns "שלב 3א" in an answer into a link to that
 * step; without it a citation still renders, it just points at the number.
 */
export function ArticleAskPane({
  documentId,
  stepKey,
  stepIndex,
}: {
  documentId: string;
  stepKey?: string;
  stepIndex?: Record<string, string>;
}) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!can('ai.ask')) return null;
  return (
    <section className="ask-pane" aria-label={ASK_TITLE}>
      <button
        type="button"
        className="btn sm ask-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {ASK_TITLE}
      </button>
      {open ? (
        <div id={id} className="ask-body">
          <ChatPane
            kind="article"
            documentId={documentId}
            context={stepKey ? { stepKey } : undefined}
            stepIndex={stepIndex}
            readOnly
            compact
          />
          <p className="muted small">התשובות מבוססות על התוכן שפורסם בלבד ומצטטות מספרי שלבים.</p>
        </div>
      ) : null}
    </section>
  );
}
