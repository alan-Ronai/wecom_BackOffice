/**
 * The app's keyboard map, and the one registry that dispatches it.
 *
 * ## Why this file exists
 *
 * Three lanes added hotkeys to this app at once, each binding its own `window` keydown listener
 * from its own screen. That produced two problems the merge made visible:
 *
 * 1. **Nothing knew what was already taken.** `p` pins the cursor row in the library's list mode
 *    and pins the document on the article page; `Enter`, `Escape` and the arrows are claimed by
 *    two or three screens each. Whether that is a conflict depended on which routes could be
 *    mounted together — a question nobody could answer by reading one file.
 * 2. **Locality did not work.** Every listener sat on `window`, so they all fired, in mount
 *    order — which puts the *outermost* one first. `LibraryPage` called `stopPropagation()` to
 *    claim `Escape` before the shell's handler, and it could not work: same-node listeners are
 *    not stopped by `stopPropagation`, and the shell's had already run anyway. With a selection
 *    live and split-screen on, one `Escape` cleared the selection *and* closed the split.
 *
 * So: one listener, one declared map, and scopes with a real precedence.
 *
 * ## How dispatch works
 *
 * `SCOPES` is ordered most-local-first. On a keystroke the registry walks it and calls the first
 * handler that claims the chord — the editor before the article before the library before the
 * shell. A handler that decides the keystroke is not its business **returns `false`** and the
 * next scope gets it; that is how the editor's `Escape` leaves a palette or a modal for the
 * global layer to close while still handling its own selection.
 *
 * ## Keeping this honest
 *
 * Every chord a screen binds must be declared in `KEYS` for that scope, and in development and
 * under test `useHotkeys` throws if it is not. Adding a key therefore means adding it here, which
 * is what keeps the `?` overlay (rendered from this same list) describing the app it ships with.
 */
import { useEffect, useRef } from 'react';
import { isTyping, normalizeKey } from './keyboard.js';

/**
 * Scopes, **most local first** — this order is the dispatch order.
 *
 * `editor`, `article` and `library` are route scopes; `global` is the shell, which is mounted
 * behind all of them.
 */
export const SCOPES = ['editor', 'article', 'library', 'global'] as const;
export type Scope = (typeof SCOPES)[number];

export interface KeyBinding {
  scope: Scope;
  /** Every chord string the dispatcher may see for this binding (see `comboFor`). */
  combos: readonly string[];
  /** How the chord is written in the `?` overlay. Omit to keep the binding out of the overlay. */
  display?: string;
  /** What it does, for the `?` overlay. */
  label?: string;
}

/**
 * The whole map. A chord may appear in more than one scope — that is the point of scopes — but
 * within a scope it must appear once.
 */
export const KEYS: readonly KeyBinding[] = [
  /* ── global: the shell ──────────────────────────────────────────────────── */
  { scope: 'global', combos: ['ctrl+k'], display: 'Ctrl K', label: 'חיפוש בכל המקורות' },
  { scope: 'global', combos: ['ctrl+d'], display: 'Ctrl D', label: 'מצב כהה / בהיר' },
  { scope: 'global', combos: ['ctrl+\\'], display: 'Ctrl \\', label: 'פיצול מסך' },
  { scope: 'global', combos: ['alt+t'], display: 'Alt T', label: 'פתיחת מסמך בלשונית חדשה' },
  {
    scope: 'global',
    combos: ['alt+ArrowLeft', 'alt+ArrowRight'],
    display: 'Alt ← / →',
    label: 'היסטוריה אחורה / קדימה',
  },

  /* ── article: call mode ─────────────────────────────────────────────────── */
  {
    scope: 'article',
    combos: ['ArrowUp', 'ArrowDown'],
    display: '↑ ↓',
    label: 'מעבר בין שלבים (מצב שיחה)',
  },
  { scope: 'article', combos: ['Enter'], display: '↵', label: 'פתיחת השלב הנוכחי' },
  // Legacy gated outcome selection on 1–3, which is what the overlay advertises; every digit is
  // bound because `digit` doubles as the G-jump buffer.
  {
    scope: 'article',
    combos: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
    display: '1 – 3',
    label: 'בחירת תוצאה בשלב',
  },
  { scope: 'article', combos: ['g'], display: 'G ואז מספר', label: 'קפיצה לשלב' },
  { scope: 'article', combos: ['n'], display: 'N', label: 'הערת נציג לשלב' },
  { scope: 'article', combos: ['p'], display: 'P', label: 'הצמד / בטל הצמדה' },
  { scope: 'article', combos: ['c'], display: 'C', label: 'העתקת סיכום לתיעוד' },
  { scope: 'article', combos: ['e'], display: 'E', label: 'עריכת המסמך' },
  { scope: 'article', combos: ['h'], display: 'H', label: 'היסטוריית גרסאות' },

  /* ── library: 6a's keyboard-first list mode ─────────────────────────────── */
  {
    scope: 'library',
    combos: ['j', 'k', 'ArrowUp', 'ArrowDown'],
    display: 'J / K',
    label: 'מעבר בין שורות ברשימה',
  },
  { scope: 'library', combos: ['x'], display: 'X', label: 'סימון שורה ברשימה' },
  { scope: 'library', combos: ['p'], display: 'P', label: 'הצמד / בטל הצמדה' },
  { scope: 'library', combos: ['Enter'], label: 'פתיחת הכרטיס' },
  { scope: 'library', combos: ['Escape'], label: 'ביטול הבחירה' },

  /* ── editor ─────────────────────────────────────────────────────────────── */
  {
    scope: 'editor',
    combos: ['ctrl+z'],
    display: 'Ctrl Z / Ctrl Shift Z',
    label: 'בטל / בצע שוב',
  },
  { scope: 'editor', combos: ['ctrl+y'], display: 'Ctrl Y', label: 'בצע שוב' },
  { scope: 'editor', combos: ['R'], display: 'Shift R', label: 'בקשת סקירה' },
  { scope: 'editor', combos: ['Escape'], label: 'ביטול בחירת שלבים / יציאה מהעורך' },

  /* ── global, listed last in the overlay where the legacy card had them ──── */
  { scope: 'global', combos: ['w'], display: 'W', label: 'סגירת הלשונית' },
  { scope: 'global', combos: ['?'], display: '?', label: 'מפת הקיצורים' },
  { scope: 'global', combos: ['Escape'], display: 'Esc', label: 'סגירת חלון / חזרה' },
];

/** The `?` overlay, derived so it cannot drift from what is actually bound. */
export const KEYMAP: [string, string][] = KEYS.filter((k) => k.display && k.label).map((k) => [
  k.display!,
  k.label!,
]);

const declared = new Map<Scope, Set<string>>(
  SCOPES.map((s) => [s, new Set(KEYS.filter((k) => k.scope === s).flatMap((k) => k.combos))]),
);

/** The chords declared for a scope — the registry's own check, and useful in tests. */
export const combosFor = (scope: Scope): ReadonlySet<string> => declared.get(scope)!;

/**
 * A handler returns nothing when it has handled the keystroke, or `false` to decline it and let
 * the next scope out try.
 */
export type HotkeyHandler = (e: KeyboardEvent) => void | false;
export type HotkeyMap = Record<string, HotkeyHandler>;

interface Entry {
  ref: { current: HotkeyMap };
}
const registry = new Map<Scope, Set<Entry>>(SCOPES.map((s) => [s, new Set<Entry>()]));

/** The chord string a keystroke is looked up by: `'ctrl+k'`, `'alt+ArrowLeft'`, `'j'`, `'Escape'`. */
export function comboFor(e: KeyboardEvent): string {
  const mod = e.ctrlKey || e.metaKey;
  return `${mod ? 'ctrl+' : ''}${e.altKey ? 'alt+' : ''}${normalizeKey(e.key)}`;
}

function dispatch(e: KeyboardEvent): void {
  const mod = e.ctrlKey || e.metaKey;
  const bare = !mod && !e.altKey;
  // Modifier combos fire even while typing; bare keys never do, or `p` would pin the document
  // halfway through a comment.
  if (bare && isTyping()) return;
  const combo = comboFor(e);

  for (const scope of SCOPES) {
    for (const { ref } of registry.get(scope)!) {
      // The un-normalised `e.key` fallback is what lets a binding ask for the shifted spelling
      // (`R`, `?`) that `normalizeKey` would have lower-cased away.
      const fn = ref.current[combo] ?? (bare ? ref.current[e.key] : undefined);
      if (fn && fn(e) !== false) return;
    }
  }
}

let bound = 0;
function bind(): () => void {
  if (bound++ === 0) window.addEventListener('keydown', dispatch);
  return () => {
    if (--bound === 0) window.removeEventListener('keydown', dispatch);
  };
}

/**
 * Binds a scope's chords for as long as the component is mounted.
 *
 * Pass `{}` to bind nothing — the library's list-mode bindings are registered that way so the
 * card grid keeps behaving the way it always has.
 */
export function useHotkeys(scope: Scope, map: HotkeyMap, deps: unknown[] = []): void {
  if (import.meta.env.DEV) {
    const allowed = declared.get(scope)!;
    const undeclared = Object.keys(map).filter((k) => !allowed.has(k));
    if (undeclared.length)
      throw new Error(
        `Undeclared hotkey${undeclared.length > 1 ? 's' : ''} in scope "${scope}": ` +
          `${undeclared.join(', ')}. Declare them in src/lib/keys.ts — the ? overlay is rendered ` +
          `from that list, and scopes cannot be reasoned about if a screen binds keys off the map.`,
      );
  }

  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const entry: Entry = { ref };
    const set = registry.get(scope)!;
    set.add(entry);
    const unbind = bind();
    return () => {
      set.delete(entry);
      unbind();
    };
    // `deps` is the caller's own list, as it was before this became a registry — the map itself
    // is read through a ref, so re-registering is only about the scope changing.
  }, [scope, ...deps]);
}
