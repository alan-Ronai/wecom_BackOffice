import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export const isTyping = (): boolean => {
  const a = document.activeElement as HTMLElement | null;
  return (
    !!a &&
    (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)
  );
};

/**
 * Hebrew keyboard produces Hebrew letters for the same physical keys; the legacy app accepted
 * both, so the port keeps the same aliases.
 */
export const HEBREW_KEY_ALIASES: Record<string, string> = {
  ק: 'e',
  ע: 'g',
  מ: 'n',
  פ: 'p',
  ב: 'c',
  י: 'h',
  "'": 'w',
  ל: 'k',
  ג: 'd',
  // list mode (6a): J/K move, X selects.
  ח: 'j',
  ס: 'x',
};

export const normalizeKey = (key: string): string =>
  key.length === 1 ? (HEBREW_KEY_ALIASES[key] ?? key.toLowerCase()) : key;

/**
 * Makes every `role="button"` element operable from the keyboard.
 *
 * The app renders ~100 `<span role="button" tabIndex={0} onClick=…>` and `<a>`-without-`href`
 * controls (the jump strip, call-mode pills, palette rows, suggestion accept/reject, the rail,
 * sixteen sites in the step editor alone). Spans do not synthesise a click from Enter/Space the
 * way a real `<button>` does, so all of those were reachable by Tab but not operable — a real
 * defect for an app whose selling point is keyboard-first call handling.
 *
 * One delegated listener implements the contract `role="button"` already promises. Enter and Space
 * both activate, Space's page-scroll default is suppressed, and native controls are left alone.
 *
 * Since B-M6 (wave Y) this is the fallback, not the mechanism: every such element also carries
 * `onKeyDown={pressKeys}` (below), which handles the key first and marks it handled.
 *
 * Returns its own teardown so callers can unbind on unmount.
 */
export function bindRoleButtonKeys(target: Document = document): () => void {
  const NATIVE = new Set(['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT']);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // The element handled the key itself (`pressKeys`, or its own onKeyDown); don't fire twice.
    if (e.defaultPrevented) return;
    const el = target.activeElement as HTMLElement | null;
    if (!el || el.getAttribute('role') !== 'button') return;
    // A real <button>/<a href> already does this natively; don't fire twice.
    if (NATIVE.has(el.tagName) && !(el.tagName === 'A' && !el.getAttribute('href'))) return;
    if (el.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();
    el.click();
  };
  target.addEventListener('keydown', onKeyDown as EventListener);
  return () => target.removeEventListener('keydown', onKeyDown as EventListener);
}

/**
 * B-M6 — the per-element half of the `role="button"` contract: Enter and Space activate.
 *
 * `bindRoleButtonKeys` above is a document-level fallback that only works where the whole `<App>`
 * is mounted and nothing on the way up stops the event (a focus trap, a component rendered on its
 * own). Every non-native `role="button"` element therefore carries this as its `onKeyDown`, and a
 * lint rule (`.eslintrc.cjs`, B-M6) refuses a new one without key handling. It marks the event
 * handled, so the fallback does not click a second time.
 *
 * Keys pressed inside a nested control belong to that control, not to this one.
 */
export function pressKeys(e: ReactKeyboardEvent<Element>): void {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  const el = e.currentTarget;
  if (e.target !== el) return;
  if (el.getAttribute('aria-disabled') === 'true') return;
  e.preventDefault();
  // SVG elements (the graph's nodes) have no `.click()`; a dispatched click reaches onClick all the same.
  if (el instanceof HTMLElement) el.click();
  else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

/*
 * Hotkeys themselves live in `./keys.ts`: one registry, scoped, with the map it dispatches
 * declared alongside it. This module keeps the pieces that are about the keyboard rather than
 * about the app's bindings — `isTyping`, the Hebrew aliases, and `role="button"` activation.
 */
