import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { setActiveScope as publishActiveScope, type ActiveScope } from '../../lib/keys.js';
import { usePalette } from '../palette/paletteStore.js';
import { useToast } from '../ui/Toast.js';

export interface Tab {
  docId: string;
  title: string;
}
export type Split = { left: string; right: string } | null;
export interface TrailEntry {
  path: string;
  title: string;
}

export interface Nav {
  tabs: Tab[];
  activeTab: number;
  openDoc: (id: string, o?: { title?: string; newTab?: boolean; step?: string }) => void;
  closeTab: (i: number) => void;
  setActiveTab: (i: number) => void;
  split: Split;
  toggleSplit: (rightId?: string) => void;
  back: () => void;
  forward: () => void;
  canBack: boolean;
  canForward: boolean;
  trail: TrailEntry[];
  setTitle: (path: string, title: string) => void;
  /**
   * Which mounted surface the keyboard is currently driving — see `lib/keys.ts#ActiveScope`.
   *
   * It lives here because it is a navigation fact, not a page-local one: split view is the case
   * that needs it, split state is already here, and the answer has to survive a keystroke arriving
   * while no pane holds DOM focus (which is most of a call).
   */
  activeScope: ActiveScope;
  setActiveScope: (scope: ActiveScope) => void;
}

const Ctx = createContext<Nav | null>(null);
const MAX_TABS = 8;

/**
 * Legacy `nav.titleOf`, which fed `document.title = 'wecom | ' + …` on every route change. The
 * tab strip, the OS window switcher, the browser's own history menu and every bookmark read this
 * — and with a single static title they all said "wecom · מאגר ידע פנימי", which identifies
 * nothing once more than one screen is open.
 *
 * A route that knows its own subject (the article, which has a document title) reports it through
 * `setTitle`; this map is the name for everything else, keyed by the first path segment.
 */
const ROUTE_TITLES: Record<string, string> = {
  library: 'ספרייה',
  doc: 'מסמך',
  edit: 'עריכה',
  history: 'גרסאות',
  trash: 'סל מיחזור',
  sources: 'מסמכי מקור',
  pinned: 'מוצמדים',
  recent: 'נצפו לאחרונה',
  drafts: 'טיוטות',
  fields: 'שדות CRM',
  blocks: 'בלוקים משותפים',
  topic: 'נושא',
  reviews: 'סקירות',
  feedback: 'משוב',
  notifications: 'התראות',
  graph: 'גרף קשרים',
  data: 'קבצי נתונים',
  dashboards: 'לוחות בקרה',
  analytics: 'נתוני שימוש',
  sync: 'סנכרון',
  admin: 'ניהול',
  login: 'כניסה',
};
const docTitle = (name: string) => `wecom | ${name}`;

const load = <T,>(k: string, d: T): T => {
  try {
    const raw = sessionStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : d;
  } catch {
    return d;
  }
};

/**
 * Tabs, the back/forward stack behind Alt ←/→, and split state. Tabs persist per session
 * (legacy kept them in localStorage; per-user persistence moves to the API in a later stage).
 */
export function NavProvider({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const loc = useLocation();
  const palette = usePalette();
  const toast = useToast();
  const [tabs, setTabs] = useState<Tab[]>(() => load('kb.tabs', [] as Tab[]));
  const [activeTab, setActiveTab] = useState(() => load('kb.activeTab', 0));
  const [split, setSplit] = useState<Split>(null);
  const [activeScope, setActiveScopeState] = useState<ActiveScope>('article');
  const stack = useRef<TrailEntry[]>([]);
  const pos = useRef(-1);
  const titles = useRef(new Map<string, string>());
  const [, tick] = useState(0);

  useEffect(() => {
    try {
      sessionStorage.setItem('kb.tabs', JSON.stringify(tabs));
      sessionStorage.setItem('kb.activeTab', JSON.stringify(activeTab));
    } catch {
      /* private mode — tabs simply do not persist */
    }
  }, [tabs, activeTab]);

  useEffect(() => {
    const path = loc.pathname;
    const s = stack.current;
    if (s[pos.current]?.path === path) return;
    if (s[pos.current - 1]?.path === path) pos.current--;
    else if (s[pos.current + 1]?.path === path) pos.current++;
    else {
      stack.current = s.slice(0, pos.current + 1).concat({ path, title: titles.current.get(path) ?? path });
      pos.current = stack.current.length - 1;
    }
    if (!path.startsWith('/doc/')) setSplit(null);
    tick((n) => n + 1);
  }, [loc.pathname]);

  useEffect(() => {
    const known = titles.current.get(loc.pathname);
    document.title = docTitle(
      known ?? ROUTE_TITLES[loc.pathname.split('/')[1] ?? ''] ?? 'מאגר ידע פנימי',
    );
  }, [loc.pathname]);

  // M6: both pieces of state are derived up front and set separately. Calling `setActiveTab`
  // from inside the `setTabs` updater made the updater impure, and React 18 StrictMode invokes
  // updaters twice.
  const openDoc = useCallback(
    (id: string, o: { title?: string; newTab?: boolean; step?: string } = {}) => {
      const i = tabs.findIndex((x) => x.docId === id);
      let next = tabs.slice();
      let act = i;
      if (i < 0) {
        if (o.newTab || !tabs.length || !tabs[activeTab]) {
          next.push({ docId: id, title: o.title ?? id });
          act = next.length - 1;
        } else {
          next[activeTab] = { docId: id, title: o.title ?? id };
          act = activeTab;
        }
      } else if (o.title) next[i] = { docId: id, title: o.title };
      if (next.length > MAX_TABS) {
        next = next.slice(1);
        act = Math.max(0, act - 1);
      }
      setTabs(next);
      setActiveTab(Math.max(0, act));
      nav(`/doc/${id}${o.step ? '/' + o.step : ''}`);
    },
    [nav, tabs, activeTab],
  );

  const closeTab = useCallback(
    (i: number) => {
      const next = tabs.filter((_, j) => j !== i);
      const wasActive = i === activeTab;
      const act = Math.max(0, Math.min(activeTab >= i ? activeTab - 1 : activeTab, next.length - 1));
      setTabs(next);
      setActiveTab(act);
      if (wasActive) nav(next.length ? `/doc/${next[act].docId}` : '/library');
    },
    [tabs, activeTab, nav],
  );

  /**
   * The registry reads this through a module-level value, not a context: `dispatch` is a plain
   * `window` listener outside React. Keeping the state here too is what lets a component render
   * from it (the pane that is driving gets a focus ring), while the effect keeps the two in step.
   */
  const setActiveScope = useCallback((scope: ActiveScope) => {
    setActiveScopeState(scope);
    publishActiveScope(scope);
  }, []);
  useEffect(() => {
    publishActiveScope(activeScope);
  }, [activeScope]);

  const toggleSplit = useCallback(
    (rightId?: string) => {
      const m = /^\/doc\/([^/]+)/.exec(loc.pathname);
      // Legacy answered all three dead ends out loud rather than returning silently: Ctrl \ is
      // pressed blind, so "nothing happened" reads as a broken chord.
      if (!m) {
        toast('פיצול מסך זמין מתוך מסמך', 'warn');
        return;
      }
      if (split && !rightId) {
        setSplit(null);
        // Closing the split leaves one article on screen, and the keys have to follow it back —
        // otherwise they stay addressed to a pane that no longer exists and nothing responds.
        setActiveScope('article');
        toast('פיצול מסך בוטל');
        return;
      }
      const right = rightId ?? tabs.find((t) => t.docId !== m[1])?.docId;
      // One open tab is the normal state at the start of a shift. Legacy asked which document to
      // put on the other side instead of doing nothing.
      if (!right) {
        palette.open({ mode: 'split' });
        return;
      }
      setSplit({ left: m[1], right });
      // Opening the split makes the pane you were already reading the active one.
      setActiveScope('split-left');
    },
    [loc.pathname, split, tabs, setActiveScope, palette, toast],
  );

  const value = useMemo<Nav>(
    () => ({
      tabs,
      activeTab,
      openDoc,
      closeTab,
      setActiveTab,
      split,
      toggleSplit,
      back: () => nav(-1),
      forward: () => nav(1),
      canBack: pos.current > 0,
      canForward: pos.current < stack.current.length - 1,
      trail: stack.current.slice(0, pos.current + 1),
      setTitle: (p, t) => {
        titles.current.set(p, t);
        const e = stack.current.find((x) => x.path === p);
        if (e) e.title = t;
        // The map is a ref, so the effect above cannot see this write. A page reporting the title
        // of the screen that is *currently* open is naming the tab, so name it here.
        if (p === loc.pathname) document.title = docTitle(t);
      },
      activeScope,
      setActiveScope,
    }),
    // `loc.pathname` keeps canBack/canForward/trail in sync with the ref-based stack.
    [tabs, activeTab, openDoc, closeTab, split, toggleSplit, nav, loc.pathname, activeScope, setActiveScope],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useNav = (): Nav => {
  const v = useContext(Ctx);
  if (!v) throw new Error('NavProvider missing');
  return v;
};
