import { useCallback, useState, type DragEvent } from 'react';

/**
 * Drag-to-reorder for a plain list, on top of whatever else moves the rows.
 *
 * Spec §5.3 asks for drag ordering; the wave-4 web lane shipped ↑/↓ buttons instead and recorded
 * why — arrows are keyboard-reachable, carry `aria-label`s and are correctly `disabled` at the
 * ends, where drag is none of those things. That reasoning holds, so this is *additional*: the
 * buttons stay and remain the keyboard path, and pointer users get the twenty-item case the
 * arrows make tedious.
 *
 * Two details that are easy to get wrong:
 *
 * - The drop is a **move**, not a swap. Dragging the first row onto the fourth means "put it
 *   fourth", which for anyone dragging is the whole point; a swap would leave the rows between
 *   untouched and look like nothing happened.
 * - `onDragOver` must `preventDefault()` or the browser refuses the drop outright, and the
 *   default `dragover` handling is also what shows the "no entry" cursor over a valid target.
 *
 * `commit` is called only when the order actually changed, so a click that turns into a two-pixel
 * drag does not issue a reorder request.
 */
export interface DragOrder {
  /** Index currently being dragged, for styling; null when no drag is in progress. */
  dragging: number | null;
  /** Index the pointer is currently over, for the drop-target line. */
  over: number | null;
  /** Spread onto each row element. */
  rowProps: (index: number) => {
    draggable: boolean;
    onDragStart: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: DragEvent) => void;
    onDragEnd: () => void;
    'data-dragging'?: true;
    'data-drop-target'?: true;
  };
}

export function useDragOrder(
  ids: readonly string[],
  commit: (next: string[]) => void,
  enabled = true,
): DragOrder {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const rowProps = useCallback(
    (index: number) => ({
      draggable: enabled,
      onDragStart: (e: DragEvent) => {
        setDragging(index);
        // Firefox will not start a drag at all without data on the transfer.
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
      },
      onDragOver: (e: DragEvent) => {
        if (dragging === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (over !== index) setOver(index);
      },
      onDragLeave: () => setOver((cur) => (cur === index ? null : cur)),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        const from = dragging ?? Number(e.dataTransfer.getData('text/plain'));
        setDragging(null);
        setOver(null);
        if (!Number.isInteger(from) || from === index || from < 0 || from >= ids.length) return;
        const next = [...ids];
        const [moved] = next.splice(from, 1);
        next.splice(index, 0, moved!);
        commit(next);
      },
      onDragEnd: () => {
        setDragging(null);
        setOver(null);
      },
      ...(dragging === index ? { 'data-dragging': true as const } : {}),
      ...(over === index && dragging !== null && dragging !== index
        ? { 'data-drop-target': true as const }
        : {}),
    }),
    [ids, commit, dragging, over, enabled],
  );

  return { dragging, over, rowProps };
}
