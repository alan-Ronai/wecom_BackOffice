import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { escapeHtml, type Permission } from '@wecom/shared';
import { useSearch } from '../../api/hooks/search.js';
import { useDebounced } from '../../lib/useDebounced.js';
import { useNav } from '../shell/navStore.js';
import { usePalette } from './paletteStore.js';
import { useEntityDialogs } from '../library/dialogs.js';
import { useSettings } from '../settings/SettingsDialog.js';
import { usePreferences, useSavePreferences } from '../../api/hooks/preferences.js';
import { useCan } from '../../api/hooks/me.js';
import { Html } from '../Fmt.js';
import type { SearchHit } from '../../api/types.js';

/**
 * Tab cycles these filters, and the key is sent verbatim as `?types=` — so the keys must be the
 * group names `GET /search` understands (`documents,steps,blocks,fields,scripts,actions`),
 * not UI-local nicknames. `actions` is resolved locally and never reaches the server.
 */
const TYPES: [string, string][] = [
  ['all', 'הכל'],
  ['documents', 'מסמכים'],
  ['steps', 'שלבים'],
  ['fields', 'שדות CRM'],
  ['blocks', 'בלוקים'],
  ['scripts', 'תסריטים'],
  ['actions', 'פעולות'],
];

const GROUP_LABEL: Record<string, string> = Object.fromEntries(
  TYPES.filter(([k]) => k !== 'all').map(([k, l]) => [k, l]),
);

interface LocalAction {
  id: string;
  title: string;
  kbd?: string;
  icon: string;
  run: () => void;
}
type Row =
  | { kind: 'group'; label: string }
  | { kind: 'hit'; hit: SearchHit }
  | { kind: 'action'; action: LocalAction };

const hi = (text: string, q: string): string => {
  if (!q) return escapeHtml(text);
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return escapeHtml(text);
  return (
    escapeHtml(text.slice(0, i)) +
    '<mark>' +
    escapeHtml(text.slice(i, i + q.length)) +
    '</mark>' +
    escapeHtml(text.slice(i + q.length))
  );
};

/** Port of legacy KB.palette — server search merged with local actions. */
export function Palette() {
  const palette = usePalette();
  const open = palette.state.open;
  const mode = open ? (palette.state.mode ?? 'search') : 'search';
  const nav = useNav();
  const go = useNavigate();
  const loc = useLocation();
  const dialogs = useEntityDialogs();
  const settings = useSettings();
  const prefs = usePreferences();
  const savePrefs = useSavePreferences();
  const can = useCan();

  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(q, 120);
  const search = useSearch(debounced, type);

  useEffect(() => {
    if (!open) return;
    setQ(palette.state.open ? (palette.state.query ?? '') : '');
    setType(palette.state.open ? (palette.state.type ?? 'all') : 'all');
    setSel(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open, palette.state]);

  const actions = useMemo<LocalAction[]>(() => {
    const p = prefs.data;
    const base = p ?? {
      theme: null,
      font: 'plex' as const,
      panel: true,
      callMode: true,
      sidebarExpanded: false,
    };
    const docId = /^\/doc\/([^/]+)/.exec(loc.pathname)?.[1];
    const list: LocalAction[] = [];
    if (docId) {
      list.push({
        id: 'hist',
        title: 'היסטוריית גרסאות של המסמך',
        kbd: 'H',
        icon: '🕓',
        run: () => go(`/history/${docId}`),
      });
      list.push({ id: 'edit', title: 'ערוך את המסמך', kbd: 'E', icon: '✏', run: () => go(`/edit/${docId}`) });
      list.push({
        id: 'graph-focus',
        title: 'גרף קשרים – מקד על המסמך הנוכחי',
        icon: '⁂',
        run: () => go(`/graph?focus=doc:${docId}&depth=2`),
      });
    }
    list.push(
      { id: 'new', title: 'צור פריט ידע חדש', kbd: 'Ctrl N', icon: '✚', run: () => go('/edit/new') },
      {
        id: 'dark',
        title: document.documentElement.dataset.theme === 'dark' ? 'מצב בהיר' : 'מצב כהה',
        kbd: 'Ctrl D',
        icon: '◐',
        run: () =>
          savePrefs.mutate({
            ...base,
            theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark',
          }),
      },
      { id: 'split', title: 'פיצול מסך', kbd: 'Ctrl \\', icon: '⫿', run: () => nav.toggleSplit() },
      {
        id: 'sources',
        title: 'מסמכי מקור (Word) – עיבוד שינויים',
        icon: '📄',
        run: () => go('/sources'),
      },
      { id: 'trash', title: 'סל מיחזור', icon: '🗑', run: () => go('/trash') },
      { id: 'pinned', title: 'מוצמדים', icon: '★', run: () => go('/pinned') },
      { id: 'recent', title: 'נצפו לאחרונה', icon: '🕘', run: () => go('/recent') },
      { id: 'fields', title: 'שדות CRM – מה השתנה השבוע', icon: 'CRM', run: () => go('/fields') },
      { id: 'blocks', title: 'בלוקים משותפים', icon: '⧉', run: () => go('/blocks') },
      { id: 'data', title: 'קבצי נתונים (JSON / CSV) – מיפוי וייבוא', icon: '📊', run: () => go('/data') },
      { id: 'graph', title: 'גרף קשרים – מה מפנה למה', icon: '⁂', run: () => go('/graph') },
      {
        id: 'dashboards',
        title: 'לוחות בקרה – כיסוי, רעננות, שימוש',
        icon: '▦',
        run: () => go('/dashboards'),
      },
      {
        id: 'font',
        title:
          base.font === 'rubik'
            ? 'מערכת טיפוגרפיה: עבור ל-Plex Hebrew (מוצע)'
            : 'מערכת טיפוגרפיה: עבור ל-Rubik (נוכחי)',
        icon: 'Aא',
        run: () => savePrefs.mutate({ ...base, font: base.font === 'rubik' ? 'plex' : 'rubik' }),
      },
      { id: 'type', title: 'הגדרות תצוגה וטיפוגרפיה', icon: '⚙', run: settings.open },
      { id: 'print', title: 'הדפסה', icon: '🖨', run: () => window.print() },
    );

    /**
     * The operator actions. Gated on the same permission as the route each one opens, so the
     * palette never offers a destination that answers "אין הרשאה".
     */
    const gated: [Permission, string, string, string][] = [
      ['sources.manage', 'sync', 'תור סנכרון – מה ממתין לייבוא או לדחיפה', '⟳'],
      ['sources.manage', 'sync/parity', 'דו״ח התאמה – מה זהה ומה לא', '⚖'],
      ['connectors.manage', 'admin/connectors', 'מחברים – הגדרה, בדיקה והרצה', '🔌'],
      ['connectors.manage', 'admin/connectors/new', 'מחבר חדש', '✚'],
      ['users.manage', 'admin/users', 'משתמשים – תפקידים והיקף קטגוריות', '👥'],
      ['roles.manage', 'admin/roles', 'תפקידים והרשאות – מטריצת הרשאות', '🛡'],
      ['roles.manage', 'admin/groups', 'מיפוי קבוצות Entra לתפקידים', '🔗'],
      ['users.manage', 'admin/sessions', 'חיבורים פעילים – ניתוק מושב', '🖥'],
      ['audit.read', 'admin/audit', 'יומן פעולות – מי שינה מה ומתי', '🧾'],
      ['system.admin', 'admin/identity', 'זהות וכניסה – OIDC, שער, אורך מושב', '🪪'],
      ['system.admin', 'admin/system', 'מצב מערכת', '⚙'],
    ];
    for (const [needs, to, title, icon] of gated)
      if (can(needs)) list.push({ id: to, title, icon, run: () => go(`/${to}`) });

    return list;
  }, [can, go, loc.pathname, nav, prefs.data, savePrefs, settings.open]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const groups = search.data?.groups ?? [];
    for (const g of groups) {
      if (!g.hits.length) continue;
      out.push({ kind: 'group', label: GROUP_LABEL[g.type] ?? g.type });
      for (const hit of g.hits) out.push({ kind: 'hit', hit });
    }
    if (mode === 'search' && (type === 'all' || type === 'actions')) {
      const needle = debounced.trim().toLowerCase();
      const matching = needle
        ? actions.filter((a) => a.title.toLowerCase().includes(needle))
        : actions.slice(0, 6);
      if (matching.length) {
        out.push({ kind: 'group', label: 'פעולות' });
        for (const action of matching) out.push({ kind: 'action', action });
      }
    }
    return out;
  }, [search.data, actions, debounced, mode, type]);

  const selectable = rows.filter((r) => r.kind !== 'group');
  const current = selectable[Math.min(sel, Math.max(0, selectable.length - 1))];

  if (!open) return null;

  const choose = (row: Row | undefined, newTab = false) => {
    palette.close();
    if (!row || row.kind === 'group') return;
    if (row.kind === 'action') {
      row.action.run();
      return;
    }
    const h = row.hit;
    if (mode === 'split') {
      if (h.documentId) nav.toggleSplit(h.documentId);
      return;
    }
    if (mode === 'newtab') {
      if (h.documentId ?? h.id) nav.openDoc(h.documentId ?? h.id, { title: h.title, newTab: true });
      return;
    }
    if (h.type === 'document') nav.openDoc(h.id, { title: h.title, newTab });
    else if (h.type === 'step' && h.documentId)
      nav.openDoc(h.documentId, { title: h.title, step: h.stepKey, newTab });
    else if (h.type === 'field') dialogs.showField(h.id);
    else if (h.type === 'block') dialogs.showBlock(h.id);
    else if (h.type === 'script') dialogs.showScript(h.title, h.snippet);
  };

  const cycleType = (back: boolean) => {
    const keys = TYPES.map((t) => t[0]).filter((k) => mode === 'search' || k === 'all' || k === 'documents');
    const i = keys.indexOf(type);
    setType(keys[(i + (back ? -1 : 1) + keys.length) % keys.length]);
    setSel(0);
  };

  let selIdx = -1;
  const stat = `${search.data?.total ?? selectable.length} תוצאות ב-${search.data?.files ?? 0} קבצים · ${Math.max(1, Math.round(search.data?.tookMs ?? 1))}ms`;

  return (
    <div
      className="overlay dark"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) palette.close();
      }}
    >
      <div className="palette" role="dialog" aria-label="חיפוש">
        <div className="in">
          <span className="ic">⌕</span>
          <input
            ref={inputRef}
            type="text"
            value={q}
            placeholder={
              mode === 'newtab'
                ? 'איזה מסמך לפתוח בלשונית חדשה?'
                : mode === 'split'
                  ? 'איזה מסמך להציג לצד הנוכחי?'
                  : 'חפש מסמך, שלב, שדה CRM, תסריט או פעולה…'
            }
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(selectable.length - 1, s + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(current, e.ctrlKey || e.metaKey);
              } else if (e.key === 'Tab') {
                e.preventDefault();
                cycleType(e.shiftKey);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                palette.close();
              }
            }}
          />
          <div className="types">
            {TYPES.filter(([k]) => mode === 'search' || k === 'all' || k === 'documents').map(([k, l]) => (
              <span
                key={k}
                className={k === type ? 'on' : ''}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setType(k);
                  setSel(0);
                }}
              >
                {l}
              </span>
            ))}
          </div>
          <kbd role="button" tabIndex={0} onClick={palette.close}>
            Esc
          </kbd>
        </div>
        <div className="res">
          {!rows.length ? (
            <div className="empty">אין תוצאות</div>
          ) : (
            rows.map((row, i) => {
              if (row.kind === 'group')
                return (
                  <div className="gh" key={`g${i}`}>
                    {row.label}
                  </div>
                );
              selIdx++;
              const mine = selIdx;
              const isOn = mine === Math.min(sel, selectable.length - 1);
              if (row.kind === 'action')
                return (
                  <div
                    key={row.action.id}
                    className={'ri' + (isOn ? ' on' : '')}
                    role="button"
                    tabIndex={0}
                    onMouseEnter={() => setSel(mine)}
                    onClick={() => choose(row, false)}
                  >
                    <span className="ic">{row.action.icon}</span>
                    <div className="tx">
                      <div className="t">{row.action.title}</div>
                      <div className="m" />
                    </div>
                    {row.action.kbd ? <kbd>{row.action.kbd}</kbd> : null}
                  </div>
                );
              const h = row.hit;
              return (
                <div
                  key={`${h.type}:${h.id}`}
                  className={'ri' + (isOn ? ' on' : '')}
                  role="button"
                  tabIndex={0}
                  onMouseEnter={() => setSel(mine)}
                  onClick={(e) => choose(row, e.ctrlKey || e.metaKey)}
                >
                  <span className={'ic' + (h.type === 'step' ? ' round' : h.type === 'block' ? ' red' : '')}>
                    {h.type === 'step' ? h.num : h.type === 'block' ? '⧉' : '📄'}
                  </span>
                  <div className="tx">
                    <Html className="t" as="div" html={hi(h.title, debounced.trim())} />
                    <div className="m">{h.meta}</div>
                  </div>
                  {isOn ? <kbd>↵</kbd> : null}
                </div>
              );
            })
          )}
        </div>
        <div className="foot">
          <span>↑↓ ניווט</span>
          <span>↵ פתיחה</span>
          <span>Tab סוג תוצאה</span>
          <span>Ctrl ↵ בלשונית</span>
          <span className="stat">{stat}</span>
        </div>
      </div>
    </div>
  );
}
