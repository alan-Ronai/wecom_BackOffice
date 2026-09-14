import { useEffect, useRef } from 'react';

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
 * One delegated listener implements the contract `role="button"` already promises, rather than
 * threading an `onKeyDown` through 28 files. Enter and Space both activate, Space's page-scroll
 * default is suppressed, and native controls are left alone.
 *
 * Returns its own teardown so callers can unbind on unmount.
 */
export function bindRoleButtonKeys(target: Document = document): () => void {
  const NATIVE = new Set(['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT']);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
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

export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

/**
 * Binds `'ctrl+k'`, `'alt+t'`, `'ArrowDown'`, `'1'`, `'?'` … to handlers.
 * Modifier combos fire even while typing; bare keys do not.
 */
export function useHotkeys(map: HotkeyMap, deps: unknown[] = []): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = normalizeKey(e.key);
      const combo = `${mod ? 'ctrl+' : ''}${e.altKey ? 'alt+' : ''}${key}`;
      const fn = ref.current[combo] ?? (mod || e.altKey ? undefined : ref.current[e.key]);
      if (!fn) return;
      if (!mod && !e.altKey && isTyping()) return;
      fn(e);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, deps);
}
