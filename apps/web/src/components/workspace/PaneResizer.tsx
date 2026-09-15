import { useRef } from 'react';

/**
 * The splitter between two workspace panes.
 *
 * `role="separator"` with a `tabIndex` because a resizer that only answers to a drag is a resizer
 * for a mouse: ArrowLeft/ArrowRight move it 16px at a time, which is what makes a three-pane
 * layout usable from the keyboard at all. The host decides what a delta means — this only reports
 * pixels.
 */
export function PaneResizer({ label, onDelta }: { label: string; onDelta: (deltaPx: number) => void }) {
  const last = useRef<number | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onPointerDown={(e) => {
        last.current = e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (last.current === null) return;
        const d = e.clientX - last.current;
        last.current = e.clientX;
        if (d) onDelta(d);
      }}
      onPointerUp={(e) => {
        last.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        onDelta(e.key === 'ArrowLeft' ? -16 : 16);
      }}
    />
  );
}
