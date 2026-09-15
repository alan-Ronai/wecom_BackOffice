import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { escapeHtml, type DocumentCard, type Permission } from '@wecom/shared';
import { isSearchable, MIN_SEARCH_CHARS, useSearch } from '../../api/hooks/search.js';
import { useDebounced } from '../../lib/useDebounced.js';
import { useNav } from '../shell/navStore.js';
import { usePalette } from './paletteStore.js';
import { useEntityDialogs } from '../library/dialogs.js';
import { useSettings } from '../settings/SettingsDialog.js';
import { usePreferences, useSavePreferences } from '../../api/hooks/preferences.js';
import { useUiPrefs } from '../../api/hooks/uiPrefs.js';
import { useCan } from '../../api/hooks/me.js';
import { useTelemetry } from '../../api/hooks/collab.js';
import { Html } from '../Fmt.js';
import { TypeBadge, worldShort } from '../taxonomy/TypeBadge.js';
import { hitLabel } from './hitLabel.js';
import { localGroups } from './localHits.js';
import { useFocusTrap } from '../ui/useFocusTrap.js';
import type { ListDocumentsResponse, SearchHit } from '../../api/types.js';
import { results as nResults } from '../../lib/count.js';

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

/**
 * Said once, quietly, only while the query is too short to send. An agent who types two letters
 * and sees a shorter list than usual is owed the reason, and the reason is not "no results".
 */
const SHORT_QUERY_HINT = `הקלידו לפחות ${MIN_SEARCH_CHARS} תווים לחיפוש בכל המקורות`;

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
  const ui = useUiPrefs();
  const qc = useQueryClient();
  const can = useCan();
  const track = useTelemetry();

  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const trap = useFocusTrap<HTMLDivElement>(true);
  const debounced = useDebounced(q, 120);
  const search = useSearch(debounced, type);

  /**
   * Below `MIN_SEARCH_CHARS` no request was made for what is typed now — but `keepPreviousData`
   * outlives the query key, so the *previous*, longer query's hits and its footer count would stay
   * on screen and read as an answer to the current two letters. They are not one, so they go.
   */
  const data = isSearchable(debounced) ? search.data : undefined;
  /** What the operator has typed, not what the debounce has caught up to — the hint must not lag. */
  const short = q.trim().length > 0 && !isSearchable(q);

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
      { id: 'reviews', title: 'סקירות ממתינות להחלטה', icon: '📤', run: () => go('/reviews') },
      { id: 'notifications', title: 'מרכז התראות', icon: '🔔', run: () => go('/notifications') },
      { id: 'views', title: 'תצוגות שמורות בספרייה', icon: '🗂', run: () => go('/library') },
      { id: 'templates', title: 'תבניות — פריט ידע חדש מתבנית', icon: '▤', run: () => go('/edit/new') },
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
        id: 'scripts',
        title: 'תסריטים – נוסח אחיד ללקוח',
        icon: '“',
        // A script is a type-T document; the library filtered to that type is where they live.
        run: () => go('/library?docType=T'),
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
    const groups = data?.groups ?? [];
    for (const g of groups) {
      // Legacy narrowed the pool to documents whenever the palette was asked *which document*
      // ("איזה מסמך לפתוח בלשונית חדשה?" / "…להציג לצד הנוכחי?"). A CRM field or a block is not an
      // answer to that question, and picking one navigated to `/doc/<field name>`. A step hit
      // still qualifies — it carries the document it belongs to.
      const hits = mode === 'search' ? g.hits : g.hits.filter((h) => h.documentId ?? h.type === 'document');
      if (!hits.length) continue;
      out.push({ kind: 'group', label: GROUP_LABEL[g.type] ?? g.type });
      for (const hit of hits) out.push({ kind: 'hit', hit });
    }
    /*
     * Too short to send: answer out of the cache instead of going blank. Every row here is a
     * document — the one thing `newtab`/`split` mode asks for — so the mode filter above has
     * nothing left to do, and the type filter is honoured by not offering documents under a
     * `fields`/`blocks`/`scripts` tab that the local cache cannot speak for.
     */
    if (!isSearchable(debounced) && (type === 'all' || type === 'documents')) {
      const byId = new Map<string, DocumentCard>();
      for (const [, page] of qc.getQueriesData<ListDocumentsResponse>({ queryKey: ['documents'] }))
        for (const c of page?.items ?? []) if (!byId.has(c.id)) byId.set(c.id, c);
      for (const g of localGroups({
        cards: [...byId.values()],
        lastSeen: ui.prefs.lastSeen,
        needle: debounced,
      })) {
        out.push({ kind: 'group', label: g.label });
        for (const hit of g.hits) out.push({ kind: 'hit', hit });
      }
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
  }, [data, actions, debounced, mode, type, qc, ui.prefs.lastSeen]);

  const selectable = rows.filter((r) => r.kind !== 'group');
  const current = selectable[Math.min(sel, Math.max(0, selectable.length - 1))];

  // Legacy's `draw()` ended by scrolling the selected row into view. The result box shows about
  // six rows and holds up to forty, so without this, arrowing down moves a selection nobody can
  // see and ↵ opens something the operator never read.
  useEffect(() => {
    if (!open) return;
    document.querySelector('.palette .ri.on')?.scrollIntoView({ block: 'nearest' });
  }, [open, sel, rows]);

  if (!open) return null;

  const choose = (row: Row | undefined, newTab = false) => {
    palette.close();
    if (!row || row.kind === 'group') return;
    // What people actually reach for through the palette is the input for deciding which of these
    // deserve their own affordance; batched, so it costs one request per 10 s at most.
    track({
      kind: 'palette',
      ...(row.kind === 'hit' && row.hit.documentId ? { documentId: row.hit.documentId } : {}),
    });
    // W5 §13: a *search* result that was actually opened, distinct from the palette being used
    // at all — the pair is what says whether the search answered the question.
    // Only when there really is a document behind the hit. `row.hit.id` for a field, block or tag
    // is not a document id, and `telemetry_events.document_id` is an FK — the server dropped those
    // rows silently, so `search_click` was under-reporting without saying so.
    if (row.kind === 'hit' && row.hit.documentId)
      track({ kind: 'search_click', documentId: row.hit.documentId });
    if (row.kind === 'action') {
      row.action.run();
      return;
    }
    const h = row.hit;
    if (mode === 'split') {
      // Same resolution as `newtab`: a document hit names itself in `id`, a step hit names its
      // document in `documentId`. The rows list is already narrowed to those two.
      const id = h.documentId ?? h.id;
      if (id) nav.toggleSplit(id);
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
  /**
   * M4 — the footer states what the search said, and says nothing when there was no search.
   *
   * Below `MIN_SEARCH_CHARS` there is no response to report, and the line was inventing one out of
   * whatever was to hand: `selectable.length` (which counts the local *actions* as results), `0`
   * files, and a `1ms` that no query ever took. A measurement nobody measured is worse than no
   * measurement — an operator reading "7 תוצאות ב-0 קבצים · 1ms" has been told the corpus was
   * searched and holds nothing.
   *
   * So the server's row is the server's numbers, and below the threshold it is a plain count of
   * the local rows — hits only, never the actions — or nothing at all when there are none.
   */
  const localHitCount = rows.reduce((n, r) => n + (r.kind === 'hit' ? 1 : 0), 0);
  const stat = data
    ? `${nResults(data.total)} ב-${data.files} קבצים · ${Math.max(1, Math.round(data.tookMs))}ms`
    : localHitCount
      ? nResults(localHitCount)
      : '';

  return (
    <div
      className="overlay dark"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) palette.close();
      }}
    >
      <div ref={trap} className="palette" role="dialog" aria-modal="true" aria-label="חיפוש">
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
        {short ? (
          <div className="hint" role="status">
            {SHORT_QUERY_HINT}
          </div>
        ) : null}
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
              const label = hitLabel(h);
              return (
                <div
                  key={`${h.type}:${h.id}`}
                  className={'ri' + (isOn ? ' on' : '')}
                  role="button"
                  tabIndex={0}
                  // A-2: the keyboard and a screen reader get the same label the eye gets — the
                  // item type, the world and the knowledge item, not the ingest filename.
                  aria-label={label.aria}
                  onMouseEnter={() => setSel(mine)}
                  onClick={(e) => choose(row, e.ctrlKey || e.metaKey)}
                >
                  <span className={'ic' + (h.type === 'step' ? ' round' : h.type === 'block' ? ' red' : '')}>
                    {h.type === 'step' ? h.num : h.type === 'block' ? '⧉' : '📄'}
                  </span>
                  <div className="tx">
                    <Html className="t" as="div" html={hi(h.title, debounced.trim())} />
                    <div className="m">
                      {/* The same two chips the library card renders, in the same order, so a
                          result and a card describe an item identically (A-2). */}
                      {label.world ? <span className="chip chip-blue">{worldShort(label.world)}</span> : null}
                      {label.docType ? <TypeBadge docType={label.docType} compact /> : null}
                      {label.item ? <span className="hit-item">{label.item}</span> : null}
                      {label.rest.length ? <span className="hit-rest">{label.rest.join(' · ')}</span> : null}
                    </div>
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
          {stat ? <span className="stat">{stat}</span> : null}
        </div>
      </div>
    </div>
  );
}
