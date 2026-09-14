/**
 * The QOL round's per-user state — density, list/card mode, the selected saved view, the
 * "changed since I last looked" map and whether the onboarding tour has been dismissed.
 *
 * All of it belongs in `/me/preferences` (spec: preferences follow the user across machines, and
 * `localStorage` does not). `PreferencesSchema` in `@wecom/shared` now declares all five keys as
 * optional fields, so `PUT /me/preferences` stores them and every one of these settings follows
 * the user — which is what the round was asking for.
 *
 * The `localStorage` mirror is kept, demoted from "the only copy of these keys" to what it should
 * have been all along: a cache that survives the first paint before `/me/preferences` has
 * answered, and the fallback when a write fails. Reads layer the server's answer over the mirror,
 * so the server wins on every key it returns.
 *
 * `test/lib/uiPrefs.test.ts` pins both halves of that behaviour.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PreferencesSchema, type Preferences } from '@wecom/shared';
import { z } from 'zod';
import { keys } from '../keys.js';
import { api } from '../client.js';
import { checked } from '../stage45.js';
import { applyPrefs, DEFAULT_PREFERENCES } from '../../lib/prefs.js';
import { usePreferences } from './preferences.js';

export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

export const UiPrefsSchema = PreferencesSchema.extend({
  /** Library row height — `נוח` / `דחוס` in card 6a. */
  density: z.enum(DENSITIES).default('comfortable'),
  /** Library presentation: the legacy card grid, or the keyboard-first list. */
  libraryView: z.enum(['cards', 'list']).default('cards'),
  /** Id of the `/views` saved view currently applied, if any. */
  savedViewId: z.string().nullable().default(null),
  /** documentId → ISO timestamp of the last time this user opened it. */
  lastSeen: z.record(z.string()).default({}),
  /** The first-login tour has been completed or skipped. */
  tourDone: z.boolean().default(false),
});
export type UiPrefs = z.infer<typeof UiPrefsSchema>;

export const DEFAULT_UI_PREFS: UiPrefs = UiPrefsSchema.parse(DEFAULT_PREFERENCES);

const LS_KEY = 'wecom.ui-prefs';
/** Keeping every document ever opened would grow the preferences row without bound. */
const LAST_SEEN_CAP = 200;

function readMirror(): Partial<UiPrefs> {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = UiPrefsSchema.partial().safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * `localStorage` is not reactive, so the mirror is fronted by a tiny subscribable cache: writing
 * a preference has to re-render every component reading one (the library toolbar, the list, the
 * tour) in the same tick, or a toggle appears not to have worked.
 *
 * The snapshot identity is stable between writes, which is what `useSyncExternalStore` requires.
 */
let mirrorCache: Partial<UiPrefs> | null = null;
const mirrorListeners = new Set<() => void>();

const subscribeMirror = (l: () => void): (() => void) => {
  mirrorListeners.add(l);
  return () => mirrorListeners.delete(l);
};
const mirrorSnapshot = (): Partial<UiPrefs> => (mirrorCache ??= readMirror());

function writeMirror(p: UiPrefs): void {
  mirrorCache = p;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* private mode / quota — the server copy is still authoritative */
  }
  for (const l of mirrorListeners) l();
}

/** Test seam: drops the cached mirror so each test starts from its own `localStorage`. */
export function __resetUiPrefsCache(): void {
  mirrorCache = null;
  mirrorListeners.clear();
}

/** Drops `undefined` values so a server answer that omits a key does not erase the mirror's. */
const defined = <T extends object>(o: T | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;

function capLastSeen(map: Record<string, string>): Record<string, string> {
  const entries = Object.entries(map);
  if (entries.length <= LAST_SEEN_CAP) return map;
  return Object.fromEntries(entries.sort((a, b) => b[1].localeCompare(a[1])).slice(0, LAST_SEEN_CAP));
}

export interface UiPrefsApi {
  prefs: UiPrefs;
  save: (patch: Partial<UiPrefs>) => void;
  /** Records "I have now looked at this document" — drives the 6a change indicator. */
  markSeen: (documentId: string) => void;
  /** True when the document changed after the last time this user opened it. */
  changedSinceSeen: (documentId: string, updatedAt: string) => boolean;
}

export function useUiPrefs(): UiPrefsApi {
  const qc = useQueryClient();
  const server = usePreferences();

  const mirror = useSyncExternalStore(subscribeMirror, mirrorSnapshot, mirrorSnapshot);

  const prefs = useMemo<UiPrefs>(() => {
    const merged = { ...DEFAULT_UI_PREFS, ...mirror, ...defined(server.data) };
    const parsed = UiPrefsSchema.safeParse(merged);
    return parsed.success ? parsed.data : DEFAULT_UI_PREFS;
  }, [mirror, server.data]);

  const save = useCallback(
    (patch: Partial<UiPrefs>) => {
      const next = UiPrefsSchema.parse({ ...prefs, ...patch });
      next.lastSeen = capLastSeen(next.lastSeen);
      applyPrefs(next);
      writeMirror(next);
      // Seed the core query so the rest of the app (Sidebar, Shell, Article) sees it instantly.
      qc.setQueryData<Preferences>(keys.prefs, PreferencesSchema.parse(next));
      const sync = async () => {
        checked(PreferencesSchema, await api.PUT('/me/preferences', { body: next }));
        await qc.invalidateQueries({ queryKey: keys.me });
      };
      void sync().catch(() => {
        /* the mirror already holds it; a failed sync must not lose the toggle */
      });
    },
    [prefs, qc],
  );

  const markSeen = useCallback(
    (documentId: string) => {
      if (!documentId) return;
      save({ lastSeen: { ...prefs.lastSeen, [documentId]: new Date().toISOString() } });
    },
    [prefs.lastSeen, save],
  );

  const changedSinceSeen = useCallback(
    (documentId: string, updatedAt: string) => {
      const seen = prefs.lastSeen[documentId];
      if (!seen) return false; // never opened ⇒ "new to you", not "changed"
      return Date.parse(updatedAt) > Date.parse(seen);
    },
    [prefs.lastSeen],
  );

  return { prefs, save, markSeen, changedSinceSeen };
}
