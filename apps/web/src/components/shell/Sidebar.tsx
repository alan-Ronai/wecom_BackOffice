import { useLocation, useNavigate } from 'react-router-dom';
import type { Category } from '@wecom/shared';
import { useDocuments, usePinnedIds } from '../../api/hooks/documents.js';
import { useFields, useScripts } from '../../api/hooks/content.js';
import { useSources } from '../../api/hooks/pipeline.js';
import { useTrash } from '../../api/hooks/trash.js';
import { useMe } from '../../api/hooks/me.js';
import { usePreferences, useSavePreferences } from '../../api/hooks/preferences.js';
import { CATS, CAT_KEYS, SOURCE_FILES } from '../../lib/constants.js';
import { usePalette } from '../palette/paletteStore.js';
import { useSettings } from '../settings/SettingsDialog.js';

/** Port of legacy renderSidebar: brand, search trigger, nav counts, source files, categories, user. */
export function Sidebar({
  railMode,
  drawerOpen,
  onExpand,
  onCollapse,
  onNavigate,
}: {
  railMode: boolean;
  drawerOpen?: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onNavigate: () => void;
}) {
  const nav = useNavigate();
  const loc = useLocation();
  const palette = usePalette();
  const settings = useSettings();
  const me = useMe();
  const prefs = usePreferences();
  const savePrefs = useSavePreferences();

  const all = useDocuments({ sort: 'wave' });
  const pinned = usePinnedIds();
  const drafts = useDocuments({ drafts: true, sort: 'wave' });
  const trash = useTrash();
  const sources = useSources();
  const fields = useFields();
  const scripts = useScripts();

  const cards = all.data?.items ?? [];
  const counts = CAT_KEYS.reduce<Record<string, number>>((acc, c) => {
    acc[c] = cards.filter((x) => x.category === c).length;
    return acc;
  }, {});
  const pendingSrc = (sources.data ?? []).filter((s) => s.syncState === 'pending').length;
  const crmChanges = (fields.data ?? []).filter((f) => f.status !== 'ok').length;
  const dark = prefs.data?.theme === 'dark';

  const go = (to: string) => {
    onNavigate();
    nav(to);
  };
  const on = (path: string) => loc.pathname === path || loc.pathname.startsWith(path + '/');

  const toggleTheme = () => {
    const base = prefs.data ?? {
      theme: null,
      font: 'plex' as const,
      panel: true,
      callMode: true,
      sidebarExpanded: false,
    };
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    savePrefs.mutate({ ...base, theme: next });
  };

  const item = (label: string, to: string, count?: number | null, badge?: boolean) => (
    <div className={'snav' + (on(to) ? ' on' : '')} role="button" tabIndex={0} onClick={() => go(to)}>
      <span className="dot" />
      {label}
      {count != null ? <span className={'cnt' + (badge ? ' badge' : '')}>{String(count)}</span> : null}
    </div>
  );

  return (
    <aside
      className={'sidebar' + (railMode ? ' rail-mode' : '') + (drawerOpen ? ' open' : '')}
      id="sidebar"
      aria-label="ניווט ראשי"
    >
      <div className="rail-only">
        <span className="rail-logo" title="ספרייה" role="button" tabIndex={0} onClick={() => go('/library')}>
          w.
        </span>
        <span className="rail-btn" title="הרחב תפריט" role="button" tabIndex={0} onClick={onExpand}>
          ☰
        </span>
        <span
          className={'rail-btn' + (on('/pinned') ? ' on' : '')}
          title="מוצמדים"
          role="button"
          tabIndex={0}
          onClick={() => go('/pinned')}
        >
          ★
        </span>
        <span
          className={'rail-btn' + (on('/recent') ? ' on' : '')}
          title="נצפו לאחרונה"
          role="button"
          tabIndex={0}
          onClick={() => go('/recent')}
        >
          🕘
        </span>
        <span
          className={'rail-btn' + (on('/sources') ? ' on' : '')}
          title="מסמכי מקור"
          role="button"
          tabIndex={0}
          onClick={() => go('/sources')}
        >
          📄{pendingSrc ? <span className="b">{pendingSrc}</span> : null}
        </span>
        <span
          className="rail-btn"
          title="חיפוש · Ctrl K"
          role="button"
          tabIndex={0}
          onClick={() => palette.open()}
        >
          ⌕
        </span>
        <span
          className="rail-btn bottom"
          title="מצב כהה · Ctrl D"
          role="button"
          tabIndex={0}
          onClick={toggleTheme}
        >
          ◐
        </span>
      </div>

      <div className="brand">
        <span className="logo" role="button" tabIndex={0} onClick={() => go('/library')}>
          wecom.
        </span>
        <span className="tag">מאגר ידע פנימי</span>
        {!railMode && /^\/(doc|edit|history|sources)\b/.test(loc.pathname) ? (
          <span
            className="rail-btn"
            style={{ width: 28, height: 28 }}
            title="כווץ"
            role="button"
            tabIndex={0}
            onClick={onCollapse}
          >
            ⟨
          </span>
        ) : null}
      </div>

      <div
        className="search-trigger"
        role="button"
        tabIndex={0}
        onClick={() => {
          onNavigate();
          palette.open();
        }}
        aria-label="חיפוש בכל המקורות"
      >
        <span>חיפוש בכל המקורות…</span>
        <kbd>Ctrl K</kbd>
      </div>

      <div className="scroll">
        <nav>
          {item('ספריית ידע', '/library', cards.length)}
          {item('מוצמדים', '/pinned', pinned.data?.length ?? 0)}
          {item('נצפו לאחרונה', '/recent')}
          {item('טיוטות', '/drafts', drafts.data?.items.length || null, true)}
          {item('היסטוריית גרסאות', '/history')}
          {item('סל מיחזור', '/trash', trash.data?.items.length || null)}
          {item('מסמכי מקור', '/sources', pendingSrc || null, true)}
        </nav>

        <div className="sec-title">מקורות נתונים</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 10px' }}>
          {SOURCE_FILES.map((src) => {
            let meta = '';
            let warn = false;
            if (src.kind === 'docs') {
              const n = cards.filter((d) =>
                src.id === 'intl' ? d.category === 'intl' : d.category !== 'intl',
              ).length;
              meta = n + (src.id === 'topics' ? ' · מסונכרן' : '');
            } else if (src.kind === 'fields') {
              meta = crmChanges ? `${crmChanges} שינויים` : `${fields.data?.length ?? 0} · מסונכרן`;
              warn = crmChanges > 0;
            } else meta = String(scripts.data?.length ?? 0);
            return (
              <div
                key={src.id}
                className="src-row"
                role="button"
                tabIndex={0}
                onClick={() => {
                  onNavigate();
                  if (src.kind === 'fields') nav('/fields');
                  else if (src.kind === 'scripts') nav('/scripts');
                  else nav(src.id === 'intl' ? '/library/intl' : '/library');
                }}
              >
                <span className={'sq' + (warn ? ' warn' : '')} />
                <bdi className="lat" dir="ltr">
                  {src.file}
                </bdi>
                <span className={'meta' + (warn ? ' warn' : '')}>{meta}</span>
              </div>
            );
          })}
          <div className="src-add" role="button" tabIndex={0} onClick={() => go('/sources')}>
            + הוסף מקור (JSON / CSV)
          </div>
        </div>

        <div className="sec-title">קטגוריות</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 10px' }}>
          {CAT_KEYS.map((c: Category) => (
            <div
              key={c}
              className={'cat-row' + (loc.pathname === `/library/${c}` ? ' on' : '')}
              role="button"
              tabIndex={0}
              onClick={() => go(`/library/${c}`)}
            >
              <span>{CATS[c].label}</span>
              <span>{String(counts[c] ?? 0)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="user">
        <span className="avatar">{me.data?.user.initials ?? '·'}</span>
        <div
          className="who"
          role="button"
          tabIndex={0}
          style={{ cursor: 'pointer' }}
          title="הגדרות"
          onClick={settings.open}
        >
          <div>{me.data?.user.displayName ?? ''}</div>
          <div>{me.data?.roles.join(' · ') ?? ''}</div>
        </div>
        <span
          className={'toggle' + (dark ? ' on' : '')}
          title="מצב כהה · Ctrl D"
          role="button"
          tabIndex={0}
          onClick={toggleTheme}
        />
      </div>
    </aside>
  );
}
