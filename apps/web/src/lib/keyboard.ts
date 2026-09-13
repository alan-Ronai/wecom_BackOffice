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
};

export const normalizeKey = (key: string): string =>
  key.length === 1 ? (HEBREW_KEY_ALIASES[key] ?? key.toLowerCase()) : key;

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
