import { useRef } from 'react';

/**
 * The splitter between two workspace panes.
 *
 * `role="separator"` with a `tabIndex` because a resizer that only answers to a drag is a resizer
 * for a mouse: ArrowLeft/ArrowRight move it 16px at a time, which is what makes a three-pane
 * layout usable from the keyboard at all. The host decides what a delta means — this only reports
 * pixels — but a focusable separator is a `range` widget to a screen reader, so the host also
 * hands over where the splitter currently sits (`value`, as a percentage of the row) for
 * `aria-valuenow`/`min`/`max`.
 */
export function PaneResizer({
  label,
  onDelta,
  value,
  min = 0,
  max = 100,
}: {
  label: string;
  onDelta: (deltaPx: number) => void;
  /** The width of the pane *before* the splitter, in percent — what `aria-valuenow` reports. */
  value?: number;
  min?: number;
  max?: number;
}) {
  const last = useRef<number | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      {...(value === undefined ? {} : { 'aria-valuenow': value, 'aria-valuemin': min, 'aria-valuemax': max })}
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
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        // A key press is a 16px drag in that physical direction, nothing more; which pane grows
        // is the host's arithmetic (in the RTL workspace, ArrowLeft grows the right-hand pane).
        onDelta(e.key === 'ArrowLeft' ? -16 : 16);
      }}
    />
  );
}
