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
}

const Ctx = createContext<Nav | null>(null);
const MAX_TABS = 8;

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
  const [tabs, setTabs] = useState<Tab[]>(() => load('kb.tabs', [] as Tab[]));
  const [activeTab, setActiveTab] = useState(() => load('kb.activeTab', 0));
  const [split, setSplit] = useState<Split>(null);
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

  const openDoc = useCallback(
    (id: string, o: { title?: string; newTab?: boolean; step?: string } = {}) => {
      setTabs((t) => {
        const i = t.findIndex((x) => x.docId === id);
        let next = t.slice();
        let act = i;
        if (i < 0) {
          if (o.newTab || !t.length || !t[activeTab]) {
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
        setActiveTab(Math.max(0, act));
        return next;
      });
      nav(`/doc/${id}${o.step ? '/' + o.step : ''}`);
    },
    [nav, activeTab],
  );

  const closeTab = useCallback(
    (i: number) => {
      setTabs((t) => {
        const next = t.filter((_, j) => j !== i);
        const wasActive = i === activeTab;
        const act = Math.max(0, Math.min(activeTab >= i ? activeTab - 1 : activeTab, next.length - 1));
        setActiveTab(act);
        if (wasActive) nav(next.length ? `/doc/${next[act].docId}` : '/library');
        return next;
      });
    },
    [activeTab, nav],
  );

  const toggleSplit = useCallback(
    (rightId?: string) => {
      const m = /^\/doc\/([^/]+)/.exec(loc.pathname);
      if (!m) return;
      if (split && !rightId) {
        setSplit(null);
        return;
      }
      const right = rightId ?? tabs.find((t) => t.docId !== m[1])?.docId;
      if (right) setSplit({ left: m[1], right });
    },
    [loc.pathname, split, tabs],
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
      },
    }),
    // `loc.pathname` keeps canBack/canForward/trail in sync with the ref-based stack.
    [tabs, activeTab, openDoc, closeTab, split, toggleSplit, nav, loc.pathname],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useNav = (): Nav => {
  const v = useContext(Ctx);
  if (!v) throw new Error('NavProvider missing');
  return v;
};
