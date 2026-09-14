/**
 * Save-point granularity (card 6c).
 *
 * The history data model and the `HistoryStrip` that renders it were both right; what produced
 * the entries was not. `patchStep` runs on every `onChange`, so a sentence of typing pushed one
 * snapshot per keystroke: `Ctrl Z` undid a single character, the 60-entry limit evicted everything
 * that had actually happened, and the strip showed sixty points all labelled "שינוי". These tests
 * pin the two halves of the fix — a run of like edits collapses, and a structural edit never does.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Document } from '@wecom/shared';
import { useEditorHistory } from '../../src/lib/editorHistory.js';

const doc = (title: string) => ({ id: 'd1', title, phases: [] }) as unknown as Document;

afterEach(() => vi.useRealTimers());

describe('useEditorHistory · coalescing', () => {
  it('collapses a run of same-labelled edits into one save point', () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => result.current.reset(doc(''), 'נטען'));

    // One word, typed.
    for (const t of ['ה', 'הג', 'הגד', 'הגדר', 'הגדרה']) act(() => result.current.push(doc(t), 'שם הפריט'));

    // Two points: where we started, and where the typing got to.
    expect(result.current.entries.map((e) => e.label)).toEqual(['נטען', 'שם הפריט']);
    expect(result.current.entries[1].doc.title).toBe('הגדרה');

    // And one `Ctrl Z` therefore undoes the word, not the letter.
    let restored: Document | null = null;
    act(() => {
      restored = result.current.undo();
    });
    expect(restored!.title).toBe('');
  });

  it('starts a new point once the typing pauses', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useEditorHistory());
    act(() => result.current.reset(doc(''), 'נטען'));

    act(() => result.current.push(doc('א'), 'שם הפריט'));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => result.current.push(doc('אב'), 'שם הפריט'));

    expect(result.current.entries).toHaveLength(3);
  });

  it('never collapses a structural edit — those are what Ctrl Z is for', () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => result.current.reset(doc(''), 'נטען'));

    // Three deletions in quick succession, each its own labelled point.
    act(() => result.current.push(doc('a'), 'מחיקת שלב 3'));
    act(() => result.current.push(doc('b'), 'מחיקת שלב 2'));
    act(() => result.current.push(doc('c'), 'מחיקת שלב 1'));

    expect(result.current.entries.map((e) => e.label)).toEqual([
      'נטען',
      'מחיקת שלב 3',
      'מחיקת שלב 2',
      'מחיקת שלב 1',
    ]);
  });

  it('never replaces the loaded state, so undo can always reach it', () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => result.current.reset(doc('פתיחה'), 'נטען'));
    // Same label as the reset entry, immediately after it.
    act(() => result.current.push(doc('שונה'), 'נטען'));

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries[0].doc.title).toBe('פתיחה');
  });

  it('drops the redo tail when a coalesced run starts after an undo', () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => result.current.reset(doc('0'), 'נטען'));
    act(() => result.current.push(doc('1'), 'מחיקת שלב 1'));
    act(() => result.current.push(doc('2'), 'מחיקת שלב 2'));
    act(() => {
      result.current.undo();
    });
    act(() => result.current.push(doc('3'), 'שם הפריט'));

    expect(result.current.entries.map((e) => e.doc.title)).toEqual(['0', '1', '3']);
    expect(result.current.canRedo).toBe(false);
  });
});
