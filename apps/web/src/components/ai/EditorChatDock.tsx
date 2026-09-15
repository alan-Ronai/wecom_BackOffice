import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useCan } from '../../api/hooks/me.js';
import { ChatPane } from './ChatPane.js';

import type { ProposedEdits } from '@wecom/shared';

/** What the `draft_step` tool hands back — the shape the editor's add-step action consumes. */
export interface DraftStep {
  title: string;
  actions: string[];
  outcomes?: { kind: 'ok' | 'next' | 'alert'; text: string }[];
}

export const DOCK_TITLE = "צ'אט עם המערכת";

/**
 * The editor-side chat dock (spec §5 "Step editor"): refine a step, explain one, draft a new one,
 * review the document.
 *
 * Collapsed by default, and `Escape` closes it — the dock sits over the step list, and an editor
 * who opened it to ask one question should not have to aim at a close button to get the list back.
 *
 * `draft_step` is the one tool result the dock consumes: `ChatPane` reports every `tool_result`
 * frame through `onToolResult`, and the dock forwards that one payload to `onInsertStep`. The
 * insertion itself stays with the host page, which owns the editor model.
 */
export function EditorChatDock({
  documentId,
  stepKey,
  stepIndex,
  onInsertStep,
  onProposedEdits,
  defaultOpen = false,
}: {
  documentId: string;
  stepKey?: string;
  stepIndex?: Record<string, string>;
  onInsertStep?: (step: DraftStep) => void;
  /** X6: X4a's real `ChatPane` hands back the whole `ProposedEdits`, not only its id. */
  onProposedEdits?: (pe: ProposedEdits) => void;
  defaultOpen?: boolean;
}) {
  const can = useCan();
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  /*
   * Stable identity: `ChatPane` copies `context` into state on every identity change, so a fresh
   * `{ stepKey }` per editor render would keep re-pinning the selected step and undo the editor's
   * "הסר הקשר" — and the editor re-renders on every keystroke in the step form.
   */
  const context = useMemo(() => (stepKey ? { stepKey } : undefined), [stepKey]);

  const onToolResult = useCallback(
    (name: string, payload: unknown) => {
      if (name !== 'draft_step' || !onInsertStep || !payload || typeof payload !== 'object') return;
      const p = payload as Partial<DraftStep>;
      if (typeof p.title !== 'string' || !Array.isArray(p.actions)) return;
      onInsertStep({ title: p.title, actions: p.actions, outcomes: p.outcomes });
    },
    [onInsertStep],
  );

  if (!can('ai.chat')) return null;
  return (
    <aside className={'ai-dock' + (open ? ' open' : '')} aria-label={DOCK_TITLE}>
      <button
        type="button"
        className="btn sm ai-dock-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "סגור צ'אט" : "צ'אט"}
      </button>
      {open ? (
        <div id={id} className="ai-dock-body">
          <ChatPane
            kind="editor"
            documentId={documentId}
            context={context}
            stepIndex={stepIndex}
            onToolResult={onToolResult}
            onProposedEdits={onProposedEdits}
            compact
          />
        </div>
      ) : null}
    </aside>
  );
}
