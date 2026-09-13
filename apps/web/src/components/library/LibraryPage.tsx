import { Fragment, useMemo, useRef, useState } from 'react';
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
    return list;
  }, [docs.data, facets]);

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
        <div className="lib-body">
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

          <div className="grid" data-testid="library-grid">
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

      {menu ? (
        <CardMenu items={menuItems(menu.card)} anchor={menu.anchor} onClose={() => setMenu(null)} />
      ) : null}
    </>
  );
}
