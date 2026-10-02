import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ProposedEdits, SuggestionPayload } from '@wecom/shared';
import { useDocument } from '../../api/hooks/documents.js';
import { useSourceDocument } from '../../api/hooks/sourcedocs.js';
import { useCan } from '../../api/hooks/me.js';
import { useMediaQuery } from '../../lib/useMediaQuery.js';
import { allSteps } from '../../lib/steps.js';
import { SourceEditor } from '../source/SourceEditor.js';
import { ChatPane, type ChatContext } from '../ai/ChatPane.js';
import { Empty, LoadError } from '../ui/index.js';
import { PaneResizer } from './PaneResizer.js';
import { ProposedEditsOverlay } from './ProposedEditsOverlay.js';
import { SuggestionsPanel } from './SuggestionsPanel.js';

const PANES_KEY = 'kb.workspace.panes';
const DEFAULT: [number, number, number] = [46, 27, 27]; // percent: source, suggestions, chat
const SOURCE_PANE = 'section[aria-label="מסמך המקור"]';
const MAX_SELECTION = 4000;

/** Pane widths are a per-viewer convenience: a failed read or write must never break the page. */
const loadPanes = (): number[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(PANES_KEY) ?? '');
    return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number')
      ? (v as number[])
      : [...DEFAULT];
  } catch {
    return [...DEFAULT];
  }
};

/**
 * `/workspace/:id` — the source editor, the suggestions raised against it, and the chat, side by
 * side (spec §5 Workspace).
 *
 * The three panes are one screen because the decisions are one decision: a hunk the chat proposes
 * lands as an overlay *on the source it edits*, a suggestion the chat refines lands in the panel
 * that accepts it, and text selected in the editor becomes the chat's context without anyone
 * pasting it. Nothing the model produces is written here — every path ends at a button.
 */
export function WorkspacePage() {
  const { id = '' } = useParams<{ id: string }>();
  const can = useCan();
  const me = can('ai.chat');
  const doc = useDocument(id);
  const source = useSourceDocument(id);
  const stacked = useMediaQuery('(max-width: 900px)');

  const [panes, setPanes] = useState<number[]>(loadPanes);
  const [proposed, setProposed] = useState<ProposedEdits | null>(null);
  const [ctx, setCtx] = useState<ChatContext | undefined>(undefined);
  const [refined, setRefined] = useState<{ suggestionId: string; payload: SuggestionPayload } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(PANES_KEY, JSON.stringify(panes));
    } catch {
      /* per-viewer convenience */
    }
  }, [panes]);

  /** step number → step key, so a chat citation "שלב 3א" links to that step (same map as the
   *  article page and the editor dock; all three panes pass it). */
  const stepIndex = useMemo(
    () => Object.fromEntries(allSteps(doc.data ?? undefined).map((s) => [s.num, s.key])),
    [doc.data],
  );

  const resize = useCallback(
    (i: 0 | 1) => (deltaPx: number) => {
      setPanes((p) => {
        const total = document.getElementById('workspace')?.clientWidth || 1200;
        /*
         * RTL: `panes[0]` is the **rightmost** column, so a positive `deltaPx` — the pointer
         * moving right, towards the start of the line — pushes the splitter *into* `panes[i]` and
         * shrinks it. Hence the negated delta: the pane that grows is the one the splitter moved
         * away from. (Keyboard agrees: ArrowLeft sends -16, which grows the right-hand pane.)
         */
        const d = -(deltaPx / total) * 100;
        const n = [...p];
        n[i] = Math.max(20, Math.min(70, n[i]! + d));
        n[i + 1] = Math.max(15, Math.min(70, n[i + 1]! - d));
        return n;
      });
    },
    [],
  );

  /**
   * Text selected inside the source pane becomes the chat's context, debounced so a drag does not
   * send one update per pixel. Capped at the contract's own `selection` limit — one paste must not
   * eat the whole prompt budget.
   */
  const timer = useRef<number | null>(null);
  useEffect(() => {
    const onSelect = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const sel = window.getSelection?.();
        const text = sel?.toString().trim() ?? '';
        const node = sel && sel.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : null;
        const el = node instanceof Element ? node : (node?.parentElement ?? null);
        if (!text || !el?.closest(SOURCE_PANE)) return;
        setCtx({ selection: text.slice(0, MAX_SELECTION) });
      }, 300);
    };
    document.addEventListener('selectionchange', onSelect);
    return () => {
      document.removeEventListener('selectionchange', onSelect);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  if (!me) return <Empty title="אין הרשאה לסביבת העבודה">סביבת העבודה זמינה לעורכי תוכן.</Empty>;
  if (doc.isError) return <LoadError what="הפריט" error={doc.error} />;
  if (doc.isPending) return <div className="route-loading">טוען…</div>;

  return (
    <div className="workspace" id="workspace" dir="rtl">
      <header className="workspace-head">
        <b>{doc.data.title}</b>
        <span className="small muted">גרסת מקור {source.data?.version ?? '—'}</span>
        <span className="grow" />
        <Link className="btn sm" to={`/doc/${id}`}>
          חזרה לפריט
        </Link>
      </header>
      <div
        className={'workspace-panes' + (stacked ? ' stacked' : '')}
        style={{ gridTemplateColumns: `${panes[0]}% 6px ${panes[1]}% 6px ${panes[2]}%` }}
      >
        <section className="pane" aria-label="מסמך המקור">
          {proposed ? (
            /*
             * `key` on the proposal id: server op ids restart at `op-1` for every proposal, so a
             * second `proposed_edits` frame arriving while this overlay is open would otherwise
             * swap the props without unmounting and the previous proposal's ticks would carry
             * over — "אשר החלטות" applying a hunk nobody read.
             */
            <ProposedEditsOverlay
              key={proposed.id}
              documentId={id}
              doc={doc.data}
              proposed={proposed}
              onDecided={() => setProposed(null)}
              onDismiss={() => setProposed(null)}
            />
          ) : null}
          <SourceEditor documentId={id} />
        </section>
        <PaneResizer
          label="שינוי רוחב מסמך המקור"
          value={Math.round(panes[0]!)}
          min={20}
          max={70}
          onDelta={resize(0)}
        />
        <section className="pane" aria-label="הצעות">
          <SuggestionsPanel
            documentId={id}
            onAskAbout={(suggestionId) => setCtx({ suggestionId })}
            refined={refined}
            onRefinedConsumed={() => setRefined(null)}
          />
        </section>
        <PaneResizer
          label="שינוי רוחב ההצעות"
          value={Math.round(panes[1]!)}
          min={15}
          max={70}
          onDelta={resize(1)}
        />
        <section className="pane" aria-label="סביבת העבודה">
          <ChatPane
            kind="workspace"
            documentId={id}
            context={ctx}
            stepIndex={stepIndex}
            onProposedEdits={setProposed}
            onRefinedSuggestion={(suggestionId, payload) => setRefined({ suggestionId, payload })}
          />
        </section>
      </div>
    </div>
  );
}
