import { useCallback, useRef, useState } from 'react';
import type { Document } from '@wecom/shared';

/**
 * The editor's undo/redo stack (card 6c, "נקודות שמירה").
 *
 * In-memory and per-session by design. The document itself is versioned on the server and the
 * draft is autosaved; what is missing between those two is the five seconds after you delete the
 * wrong step. That does not belong in a version — it belongs in `Ctrl Z`.
 *
 * Entries are whole-document snapshots rather than inverse commands: a knowledge item is a few
 * hundred KB at most, snapshots cannot desynchronise from the editor's own mutations the way a
 * hand-written inverse can, and the strip needs a labelled point to jump to anyway.
 */
export interface HistoryEntry {
  doc: Document;
  at: number;
  label: string;
}

/** Deep enough to cover a session of editing; a knowledge item is small. */
const LIMIT = 60;

export interface EditorHistory {
  entries: HistoryEntry[];
  index: number;
  /** Records a new state. Anything that had been undone past this point is discarded. */
  push: (doc: Document, label: string) => void;
  /** Re-seeds the stack — used when the editor loads or reloads a document. */
  reset: (doc: Document, label?: string) => void;
  undo: () => Document | null;
  redo: () => Document | null;
  /** Jumps straight to one of the labelled points in the strip. */
  jump: (index: number) => Document | null;
  canUndo: boolean;
  canRedo: boolean;
}

export function useEditorHistory(): EditorHistory {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [index, setIndex] = useState(-1);
  // The stack has to be readable synchronously inside `undo`/`redo`, which run from a key handler
  // and must return the target document to the caller rather than only schedule a re-render.
  const ref = useRef<{ entries: HistoryEntry[]; index: number }>({ entries: [], index: -1 });

  const commit = useCallback((next: HistoryEntry[], nextIndex: number) => {
    ref.current = { entries: next, index: nextIndex };
    setEntries(next);
    setIndex(nextIndex);
  }, []);

  const push = useCallback(
    (doc: Document, label: string) => {
      const { entries: cur, index: i } = ref.current;
      const kept = cur.slice(0, i + 1);
      const next = [...kept, { doc, at: Date.now(), label }].slice(-LIMIT);
      commit(next, next.length - 1);
    },
    [commit],
  );

  const reset = useCallback(
    (doc: Document, label = 'נטען') => commit([{ doc, at: Date.now(), label }], 0),
    [commit],
  );

  const step = useCallback(
    (delta: number): Document | null => {
      const { entries: cur, index: i } = ref.current;
      const j = i + delta;
      if (j < 0 || j >= cur.length) return null;
      commit(cur, j);
      return cur[j].doc;
    },
    [commit],
  );

  const undo = useCallback(() => step(-1), [step]);
  const redo = useCallback(() => step(1), [step]);

  const jump = useCallback(
    (target: number): Document | null => {
      const { entries: cur } = ref.current;
      if (target < 0 || target >= cur.length) return null;
      commit(cur, target);
      return cur[target].doc;
    },
    [commit],
  );

  return {
    entries,
    index,
    push,
    reset,
    undo,
    redo,
    jump,
    canUndo: index > 0,
    canRedo: index >= 0 && index < entries.length - 1,
  };
}
