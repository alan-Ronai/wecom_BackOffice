import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Category, DocumentCard } from '@wecom/shared';
import {
  useDeleteDocument,
  useDocuments,
  useTogglePin,
  useCreateDocument,
} from '../../api/hooks/documents.js';
import { useBlocks, useFields, useScripts } from '../../api/hooks/content.js';
import { useCan } from '../../api/hooks/me.js';
import { useBulkDocuments, useSaveView, useViews, type SavedView } from '../../api/hooks/collab.js';
import { useUiPrefs } from '../../api/hooks/uiPrefs.js';
import { useHotkeys } from '../../lib/keys.js';
import { CATS, WAVES } from '../../lib/constants.js';
import { download, fmtDate } from '../../lib/format.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { useNav } from '../shell/navStore.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { DocCard } from './DocCard.js';
import { Facets, type FacetValue } from './Facets.js';
import { AutoCrmCard } from './AutoCrmCard.js';
import { CardMenu, type MenuItem } from './CardMenu.js';
import { LibraryToolbar } from './LibraryToolbar.js';
import { DocList } from './DocList.js';
import { BulkBar } from './BulkBar.js';
import type { ListDocumentsQuery } from '../../api/types.js';

export type LibraryMode = 'library' | 'pinned' | 'recent' | 'drafts';

const MONTH_MS = 30 * 864e5;

export function LibraryPage({ mode }: { mode: LibraryMode }) {
  const { category } = useParams<{ category?: string }>();
  const cat = mode === 'library' && category && category in CATS ? (category as Category) : undefined;
  const go = useNavigate();
  const nav = useNav();
  const can = useCan();
  const modal = useModal();
  const toast = useToast();
  const [facets, setFacets] = useState<FacetValue>({ wave: 'all', flag: null });
  const [menu, setMenu] = useState<{ card: DocumentCard; anchor: HTMLElement } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── 6a: saved views, density, list mode, multi-select, change indicators ─ */
  const { prefs, save: savePrefs, changedSinceSeen } = useUiPrefs();
  const viewsQ = useViews();
  const views = useSaveView();
  const bulk = useBulkDocuments();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const lastPicked = useRef<number>(-1);
  const listMode = prefs.libraryView === 'list';

  const query: ListDocumentsQuery = {
    sort: 'wave',
    ...(cat ? { category: cat } : {}),
    ...(mode === 'pinned' ? { pinned: true } : {}),
    ...(mode === 'recent' ? { recent: true } : {}),
    ...(mode === 'drafts' ? { drafts: true } : {}),
  };
  const docs = useDocuments(query);
  const blocks = useBlocks();
  const fields = useFields();
  const scripts = useScripts();
  const togglePin = useTogglePin();
  const remove = useDeleteDocument();
  const create = useCreateDocument();

  const items = useMemo(() => {
    let list = docs.data?.items ?? [];
    if (facets.wave !== 'all') list = list.filter((c) => c.wave === facets.wave);
    if (facets.flag === 'hh') list = list.filter((c) => c.priority === 'hh');
    if (facets.flag === 'month') list = list.filter((c) => Date.parse(c.updatedAt) > Date.now() - MONTH_MS);
    if (facets.flag === 'partial') list = list.filter((c) => c.status === 'partial');
    if (facets.flag === 'changed') list = list.filter((c) => changedSinceSeen(c.id, c.updatedAt));
    return list;
  }, [docs.data, facets, changedSinceSeen]);

  // A selection that outlives the filter it was made under would silently act on invisible
  // documents, so it is narrowed to what is on screen whenever the result set changes.
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const visible = new Set(items.map((c) => c.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setCursor((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items]);

  const toggleSelect = useCallback(
    (id: string, range = false) => {
      const index = items.findIndex((c) => c.id === id);
      setSelected((prev) => {
        const next = new Set(prev);
        if (range && lastPicked.current >= 0 && index >= 0) {
          const [a, b] = [lastPicked.current, index].sort((x, y) => x - y);
          for (const c of items.slice(a, b + 1)) next.add(c.id);
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      if (index >= 0) lastPicked.current = index;
    },
    [items],
  );

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const runBulk = async (action: Parameters<typeof bulk.mutateAsync>[0]['action'], extra = {}) => {
    const ids = [...selected];
    if (!ids.length) return;
    if (action === 'delete') {
      const ok = await modal.confirm(
        'מחיקה מרובה',
        `${ids.length} פריטים יועברו לסל המיחזור ל-30 יום.`,
        'העבר לסל',
        'danger',
      );
      if (!ok) return;
    }
    const res = await bulk.mutateAsync({ ids, action, ...extra });
    clearSelection();
    // The server enforces permissions per document, so "affected" is the honest number.
    toast(
      res.skipped.length
        ? `בוצע על ${res.affected} מתוך ${ids.length} · ${res.skipped.length} דולגו`
        : `בוצע על ${res.affected} פריטים`,
      res.skipped.length ? 'warn' : 'ok',
    );
  };

  const exportSelected = () => {
    const chosen = items.filter((c) => selected.has(c.id));
    download(
      `wecom-kb-selection-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ exportedAt: new Date().toISOString(), documents: chosen }, null, 2),
    );
    toast(`${chosen.length} פריטים יוצאו`, 'ok');
  };

  /* Saved views. The query is the local filter state, so applying one is a pure UI change. */
  const applyView = (v: SavedView | null) => {
    savePrefs({ savedViewId: v?.id ?? null });
    const q = (v?.query ?? {}) as {
      category?: Category;
      wave?: FacetValue['wave'];
      flag?: FacetValue['flag'];
    };
    setFacets({ wave: q.wave ?? 'all', flag: q.flag ?? null });
    go(q.category ? `/library/${q.category}` : '/library');
  };

  const saveCurrentView = async () => {
    const name = await modal.prompt('תצוגה שמורה', 'שם התצוגה (למשל: חו"ל · ממתין לעדכון)');
    if (!name?.trim()) return;
    const created = await views.create.mutateAsync({
      name: name.trim().slice(0, 60),
      query: { ...(cat ? { category: cat } : {}), wave: facets.wave, flag: facets.flag },
      shared: false,
    });
    savePrefs({ savedViewId: created.id });
    toast('התצוגה נשמרה', 'ok');
  };

  const deleteView = async (v: SavedView) => {
    const ok = await modal.confirm('מחיקת תצוגה', `"${v.name}" תימחק.`, 'מחק', 'danger');
    if (!ok) return;
    await views.remove.mutateAsync(v.id);
    if (prefs.savedViewId === v.id) savePrefs({ savedViewId: null });
  };

  const title =
    mode === 'pinned'
      ? 'מוצמדים'
      : mode === 'recent'
        ? 'נצפו לאחרונה'
        : mode === 'drafts'
          ? 'טיוטות'
          : cat
            ? CATS[cat].label
            : 'ספריית ידע';
  const srcFile = cat === 'intl' ? 'intl-roaming.json' : 'topics.json';
  const lastUpd = items
    .map((c) => c.updatedAt)
    .sort()
    .pop();
  const waves = new Set(items.map((c) => c.wave)).size;

  const openCard = (c: DocumentCard) => nav.openDoc(c.id, { title: c.title });

  const menuItems = (c: DocumentCard): MenuItem[] => {
    const list: MenuItem[] = [];
    if (can('docs.edit', c)) list.push({ label: '✏️ ערוך', run: () => go(`/edit/${c.id}`) });
    list.push({ label: '🕓 היסטוריית גרסאות', run: () => go(`/history/${c.id}`) });
    list.push({
      label: '⧉ פתח בלשונית',
      run: () => nav.openDoc(c.id, { title: c.title, newTab: true }),
    });
    list.push({
      label: c.pinned ? '☆ בטל הצמדה' : '★ הצמד',
      run: () => togglePin.mutate({ id: c.id, pinned: !c.pinned }),
    });
    if (can('docs.delete', c))
      list.push({
        label: '🗑 מחק',
        run: async () => {
          const ok = await modal.confirm(
            'מחיקת פריט ידע',
            `"${c.title}" יועבר לסל המיחזור ל-30 יום.` +
              (c.linksIn ? ` ${c.linksIn} מסמכים מקשרים אליו — הקישורים יישברו.` : ''),
            'העבר לסל',
            'danger',
          );
          if (!ok) return;
          await remove.mutateAsync(c.id);
          toast('הועבר לסל המיחזור', 'ok');
        },
      });
    return list;
  };

  const exportAll = async () => {
    const bundle = {
      exportedAt: new Date().toISOString(),
      app: 'wecom-kb',
      version: 2,
      documents: docs.data?.items ?? [],
      blocks: blocks.data ?? [],
      crmFields: fields.data ?? [],
      scripts: scripts.data ?? [],
    };
    download(
      `wecom-kb-export-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(bundle, null, 2),
    );
    toast('הספרייה יוצאה כ-JSON', 'ok');
  };

  const importFile = async (file: File) => {
    const text = await file.text();
    let added = 0;
    try {
      if (/\.csv$/i.test(file.name)) {
        const rows = text.split(/\r?\n/).filter((r) => r.trim());
        const head = rows
          .shift()!
          .split(',')
          .map((h) => h.trim().toLowerCase());
        const ix = (k: string) => head.indexOf(k);
        for (const r of rows) {
          const c = r.split(',').map((x) => x.trim().replace(/^"|"$/g, ''));
          const name = c[ix('title')] ?? c[0];
          if (!name) continue;
          await create.mutateAsync({
            title: name,
            description: c[ix('desc')] ?? '',
            category: (c[ix('cat')] in CATS ? c[ix('cat')] : 'tech') as Category,
            wave: (Number(c[ix('wave')]) || 2) as 1 | 2 | 3,
            priority: 'm',
            kind: 'steps',
            phases: [],
          });
          added++;
        }
      } else {
        const json = JSON.parse(text) as { documents?: unknown[] } | unknown[];
        const list = Array.isArray(json) ? json : (json.documents ?? []);
        for (const raw of list as Record<string, unknown>[]) {
          if (!raw?.title) continue;
          await create.mutateAsync({
            title: String(raw.title),
            description: String(raw.description ?? ''),
            category: ((raw.category as string) in CATS ? raw.category : 'tech') as Category,
            wave: ((raw.wave as number) || 2) as 1 | 2 | 3,
            priority: 'm',
            kind: 'steps',
            phases: [],
          });
          added++;
        }
      }
      toast(`יובאו ${added} פריטים מ-${file.name}`, 'ok');
    } catch (e) {
      toast(`הקובץ לא נקרא: ${(e as Error).message}`, 'warn');
    }
  };

  const pinnedCards = mode === 'library' ? items.filter((c) => c.pinned) : [];
  const showAuto = mode === 'library' && (!cat || cat === 'tech' || cat === 'intl');

  /**
   * 6a's keyboard-first list. Bound only in list mode so the card grid keeps behaving the way it
   * always has. The `library` scope outranks the shell's, so `Escape` clears a live selection —
   * the most local thing on screen — rather than closing something behind it.
   */
  useHotkeys(
    'library',
    listMode
      ? {
          j: () => setCursor((i) => Math.min(items.length - 1, i + 1)),
          k: () => setCursor((i) => Math.max(0, i - 1)),
          ArrowDown: (e) => {
            e.preventDefault();
            setCursor((i) => Math.min(items.length - 1, i + 1));
          },
          ArrowUp: (e) => {
            e.preventDefault();
            setCursor((i) => Math.max(0, i - 1));
          },
          x: () => {
            const c = items[cursor];
            if (c) toggleSelect(c.id);
          },
          p: () => {
            const c = items[cursor];
            if (c) togglePin.mutate({ id: c.id, pinned: !c.pinned });
          },
          Enter: () => {
            const c = items[cursor];
            if (c) openCard(c);
          },
          // Declining (`false`) hands `Escape` on to the shell, which is what should close a
          // palette or the split when there is no selection to clear.
          Escape: () => {
            if (!selected.size) return false;
            clearSelection();
          },
        }
      : {},
    [listMode, items, cursor, selected.size, toggleSelect, clearSelection, togglePin],
  );

  return (
    <>
      <div className="topbar">
        <Hamburger />
        <div className="crumb">
          <a role="button" tabIndex={0} onClick={() => go('/library')}>
            ספרייה
          </a>
          {cat || mode !== 'library' ? <span className="sep">/</span> : null}
          {cat || mode !== 'library' ? <b>{title}</b> : null}
        </div>
        <div className="actions">
          <input
            ref={fileRef}
            type="file"
            accept=".json,.csv"
            style={{ display: 'none' }}
            aria-label="ייבוא קובץ"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = '';
            }}
          />
          {can('docs.create') ? (
            <button className="btn" onClick={() => fileRef.current?.click()}>
              ייבוא JSON / CSV
            </button>
          ) : null}
          <button className="btn" onClick={() => void exportAll()}>
            ייצוא
          </button>
          {can('docs.create') ? (
            <button className="btn primary" onClick={() => go('/edit/new')}>
              ✚ פריט ידע חדש
            </button>
          ) : null}
        </div>
      </div>

      <div className="scroll-area">
        <div className="lib-body" data-density={prefs.density}>
          <div className="lib-head">
            <div>
              <h1>
                {title}
                <span>
                  {items.length} נושאים{mode === 'library' ? ` · ${waves} גלי כתיבה` : ''}
                </span>
              </h1>
              <p>
                {mode === 'library'
                  ? `מסודר לפי שכיחות פנייה · מקור: ${srcFile}${lastUpd ? ` · עודכן ${fmtDate(lastUpd)}` : ''}`
                  : mode === 'pinned'
                    ? 'מסמכים שהצמדת · מקש P מתוך מסמך'
                    : mode === 'recent'
                      ? 'לפי סדר צפייה אחרון'
                      : 'עריכות שלא פורסמו'}
              </p>
            </div>
            <Facets value={facets} onChange={setFacets} />
          </div>

          <LibraryToolbar
            views={viewsQ.data ?? []}
            activeViewId={prefs.savedViewId}
            onApplyView={applyView}
            onSaveView={() => void saveCurrentView()}
            onDeleteView={(v) => void deleteView(v)}
            density={prefs.density}
            onDensity={(d) => savePrefs({ density: d })}
            mode={prefs.libraryView}
            onMode={(m) => savePrefs({ libraryView: m })}
          />

          {listMode ? (
            <DocList
              items={items}
              cursor={cursor}
              selected={selected}
              changed={(c) => changedSinceSeen(c.id, c.updatedAt)}
              onCursor={setCursor}
              onToggleSelect={toggleSelect}
              onSelectAll={(next) => setSelected(next ? new Set(items.map((c) => c.id)) : new Set())}
              onOpen={openCard}
              onPin={(c) => togglePin.mutate({ id: c.id, pinned: !c.pinned })}
            />
          ) : null}

          <div className="grid" data-testid="library-grid" hidden={listMode}>
            {!items.length ? (
              <div className="empty" style={{ gridColumn: '1/-1' }}>
                <b>
                  {mode === 'pinned'
                    ? 'אין מסמכים מוצמדים'
                    : mode === 'recent'
                      ? 'עוד לא נצפו מסמכים'
                      : mode === 'drafts'
                        ? 'אין טיוטות פתוחות'
                        : 'אין נושאים תואמים'}
                </b>
                {mode === 'pinned'
                  ? 'לחץ ★ על כרטיס או P מתוך מסמך'
                  : mode === 'library'
                    ? 'נסה לשנות את המסננים'
                    : ''}
              </div>
            ) : mode === 'library' ? (
              <>
                {pinnedCards.length || showAuto ? (
                  <>
                    <div className="rule" data-testid="rule">
                      <span>{pinnedCards.length ? 'מוצמדים · נצפו הרבה השבוע' : 'מהנתונים · השבוע'}</span>
                    </div>
                    {pinnedCards.map((c) => (
                      <DocCard
                        key={c.id}
                        card={c}
                        onOpen={() => openCard(c)}
                        onPin={() => togglePin.mutate({ id: c.id, pinned: !c.pinned })}
                        onMenu={(anchor) => setMenu({ card: c, anchor })}
                      />
                    ))}
                    {showAuto ? <AutoCrmCard /> : null}
                  </>
                ) : null}
                {([1, 2, 3] as const).map((w) => {
                  const wt = items.filter((c) => c.wave === w && !c.pinned);
                  if (!wt.length) return null;
                  return (
                    <Fragment key={`w${w}`}>
                      <div className="rule" data-testid="rule">
                        <span>{WAVES[w]}</span>
                      </div>
                      {wt.map((c) => (
                        <DocCard
                          key={c.id}
                          card={c}
                          onOpen={() => openCard(c)}
                          onPin={() => togglePin.mutate({ id: c.id, pinned: !c.pinned })}
                          onMenu={(anchor) => setMenu({ card: c, anchor })}
                        />
                      ))}
                    </Fragment>
                  );
                })}
              </>
            ) : (
              items.map((c) => (
                <DocCard
                  key={c.id}
                  card={c}
                  onOpen={() => openCard(c)}
                  onPin={() => togglePin.mutate({ id: c.id, pinned: !c.pinned })}
                  onMenu={(anchor) => setMenu({ card: c, anchor })}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <BulkBar
        count={selected.size}
        busy={bulk.isPending}
        can={can}
        onAction={(a, extra) => void runBulk(a, extra)}
        onExport={exportSelected}
        onClear={clearSelection}
      />

      {menu ? (
        <CardMenu items={menuItems(menu.card)} anchor={menu.anchor} onClose={() => setMenu(null)} />
      ) : null}
    </>
  );
}
