import { useEffect, useRef, type RefObject } from 'react';

/**
 * Focus management for an overlay: trap, initial focus, restore.
 *
 * A `role="dialog"` that only handles `Escape` is a dialog for a mouse. For anyone driving the
 * keyboard it is a div: `Tab` walks straight past the buttons and into the page behind, which is
 * still fully focusable, and when the dialog closes the caret is left wherever that walk ended
 * rather than on the control that opened it. For a screen reader it is worse — the page underneath
 * is still in the accessibility tree, so the reader happily narrates a library the user cannot see.
 *
 * Three things fix that, and they have to be the same three every time, which is why this is a
 * hook rather than a per-component effort:
 *
 * 1. **Remember and restore.** `document.activeElement` at open is where focus belongs at close.
 * 2. **Focus something inside, once.** The first tabbable node, or the container itself when there
 *    is none (a message-only dialog), so the reader announces the dialog rather than nothing.
 * 3. **Cycle `Tab` within the container.** Computed on each keypress, not cached: a dialog whose
 *    body renders a list that is still loading has a different set of tabbables a moment later.
 *
 * `aria-modal="true"` is the caller's job — it belongs on the element, next to `role="dialog"`.
 * The page behind is not marked `inert`: `Modal` renders its overlays as siblings of the whole
 * app tree, so there is no single node to mark, and `aria-modal` is what AT reads anyway.
 *
 * `enabled` is the modal's own open state, so a component that always renders can call this
 * unconditionally, as the rules of hooks require.
 */
const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const tabbablesIn = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    // `offsetParent` is null for anything `display:none`; a zero-size box is the jsdom case,
    // where layout never runs, so it is deliberately not treated as hidden.
    (el) => !el.hasAttribute('aria-hidden') && (el.offsetParent !== null || !el.style.display),
  );

export function useFocusTrap<T extends HTMLElement>(enabled: boolean): RefObject<T> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root) return;

    const returnTo = document.activeElement as HTMLElement | null;

    const first = tabbablesIn(root)[0];
    if (first) first.focus();
    else {
      root.setAttribute('tabindex', '-1');
      root.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      // A dialog that has given `Tab` its own meaning has already handled it — the palette cycles
      // result types with it. Re-homing focus on top of that would break the feature this trap is
      // supposed to be protecting, so a handled key is left alone.
      if (e.key !== 'Tab' || e.defaultPrevented) return;
      const items = tabbablesIn(root);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const i = active ? items.indexOf(active) : -1;
      // Focus that has escaped the container (or never entered it) comes back to the edge the
      // user was heading for, rather than being left outside.
      const next = e.shiftKey
        ? items[(i <= 0 ? items.length : i) - 1]
        : items[i === items.length - 1 || i === -1 ? 0 : i + 1];
      e.preventDefault();
      next?.focus();
    };

    root.addEventListener('keydown', onKey);
    // Capture on the document as well, so a `Tab` pressed while focus has somehow left the
    // container still lands back inside rather than continuing into the page behind.
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || root.contains(e.target as Node)) return;
      e.preventDefault();
      tabbablesIn(root)[0]?.focus();
    };
    document.addEventListener('keydown', onDocKey, true);

    return () => {
      root.removeEventListener('keydown', onKey);
      document.removeEventListener('keydown', onDocKey, true);
      // Only take focus back if it is still ours to give — if something else has claimed it
      // (a route change, a toast) stealing it back would be the bug this is meant to prevent.
      if (returnTo?.isConnected && (document.activeElement === document.body || root.contains(document.activeElement)))
        returnTo.focus();
    };
  }, [enabled]);

  return ref;
}
