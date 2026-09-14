import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Permission } from '@wecom/shared';
import { useDocuments, usePinnedIds } from '../../api/hooks/documents.js';
import { useFields, useTextDocuments } from '../../api/hooks/content.js';
import { useSources } from '../../api/hooks/pipeline.js';
import { useDataFiles } from '../../api/hooks/stage4.js';
import { useTrash } from '../../api/hooks/trash.js';
import { useCan, useMe } from '../../api/hooks/me.js';
import { useSyncLinks } from '../../api/hooks/stage5.js';
import { usePreferences, useSavePreferences } from '../../api/hooks/preferences.js';
import { cat, SOURCE_FILES } from '../../lib/constants.js';
import { useWorlds, useTopics } from '../../api/hooks/taxonomy.js';
import { useFeedbackList } from '../../api/hooks/feedback.js';
import { useMyLearning } from '../../api/hooks/learning.js';
import { usePalette } from '../palette/paletteStore.js';
import { useSettings } from '../settings/SettingsDialog.js';
import { NotificationBell } from '../notifications/NotificationBell.js';
import { useFocusTrap } from '../ui/useFocusTrap.js';

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
  const drawer = useFocusTrap<HTMLElement>(!!drawerOpen);
  const nav = useNavigate();
  const loc = useLocation();
  const palette = usePalette();
  const settings = useSettings();
  const me = useMe();
  const can = useCan();
  const prefs = usePreferences();
  const savePrefs = useSavePreferences();

  /**
   * The admin section's entries, each gated on the permission its route needs, so the nav lists
   * what this operator can actually open. The sync queue is listed here too — it is an operator's
   * worklist, not a reader's.
   */
  const adminLinks: [label: string, to: string, needs: Permission][] = [
    ['משתמשים', '/admin/users', 'users.manage'],
    ['תפקידים והרשאות', '/admin/roles', 'roles.manage'],
    ['מיפוי קבוצות', '/admin/groups', 'roles.manage'],
    ['חיבורים פעילים', '/admin/sessions', 'users.manage'],
    ['יומן פעולות', '/admin/audit', 'audit.read'],
    ['זהות וכניסה', '/admin/identity', 'system.admin'],
    ['מחברים', '/admin/connectors', 'connectors.manage'],
    ['מצב מערכת', '/admin/system', 'system.admin'],
  ];
  const visibleAdmin = adminLinks.filter(([, , needs]) => can(needs));
  const maySync = can('sources.manage') || can('suggestions.apply');
  // Only fetched for someone who can see the queue, and only for its counts.
  const syncLinks = useSyncLinks({ pageSize: 1 }, { enabled: maySync });
  const pendingSync = maySync
    ? (syncLinks.data?.counts.pendingImport ?? 0) +
      (syncLinks.data?.counts.pendingPush ?? 0) +
      (syncLinks.data?.counts.conflict ?? 0)
    : 0;

  const all = useDocuments({ sort: 'wave' });
  const pinned = usePinnedIds();
  const drafts = useDocuments({ drafts: true, sort: 'wave' });
  const trash = useTrash();
  const sources = useSources();
  const dataFiles = useDataFiles();
  const fields = useFields();
  // `scripts.json` is `docType: 'T'` documents since the 0030 fold. `total` rather than
  // `items.length` so the count stays right if the corpus ever outgrows one page.
  const scripts = useTextDocuments('T');

  /**
   * Wave 4: the sidebar's world list is data, not the six `CATS` keys — an admin can add a world
   * from `/admin/taxonomy` and it has to appear without a deploy. `CATS` survives as the icon /
   * colour table for the six seeded slugs, with a fallback for everything else.
   */
  const worlds = useWorlds();
  const [openWorld, setOpenWorld] = useState<string | null>(null);
  const topics = useTopics(openWorld ?? undefined);
  const mayFeedback = can('feedback.manage');
  // One row, fetched only for its `counts`; the badge is the editor's actionable backlog.
  const feedback = useFeedbackList({ pageSize: 1 }, mayFeedback);
  const openFeedback = mayFeedback
    ? (feedback.data?.counts.new ?? 0) + (feedback.data?.counts.in_review ?? 0)
    : 0;
  const mayLearn = can('learning.read');
  // Fetched only for its counts; the badge is what this user still owes, not what they finished.
  const myLearning = useMyLearning(mayLearn);
  const dueLearning = mayLearn
    ? (myLearning.data?.open.length ?? 0) + (myLearning.data?.overdue.length ?? 0)
    : 0;

  const cards = all.data?.items ?? [];
  const worldRows = worlds.data ?? [];
  const counts = worldRows.reduce<Record<string, number>>((acc, w) => {
    acc[w.slug] = w.itemCount;
    return acc;
  }, {});
  const pendingSrc = (sources.data ?? []).filter((s) => s.syncState === 'pending').length;
  // A data file with nothing but `ignore` in its mapping imports nothing, so it is the one state
  // worth a badge: the file is linked but still inert until someone maps a column.
  const unmappedFiles = (dataFiles.data?.items ?? []).filter((f) =>
    f.mapping.every((m) => m.field === 'ignore'),
  ).length;
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
      ref={drawer}
      className={'sidebar' + (railMode ? ' rail-mode' : '') + (drawerOpen ? ' open' : '')}
      id="sidebar"
      aria-label="ניווט ראשי"
      // At 390 px this element *is* the drawer: it slides in over the content behind a scrim,
      // which makes it modal in fact, so it says so and traps focus while it is open. On a wide
      // screen it is ordinary page furniture and neither applies.
      aria-modal={drawerOpen || undefined}
      role={drawerOpen ? 'dialog' : undefined}
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
          className={'rail-btn' + (on('/graph') ? ' on' : '')}
          title="גרף קשרים"
          role="button"
          tabIndex={0}
          onClick={() => go('/graph')}
        >
          ⁂
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
        <NotificationBell onOpenFull={() => go('/notifications')} />
        {!railMode &&
        /^\/(doc|edit|history|sources|data|graph|topic|feedback\/|analytics)\b/.test(loc.pathname) ? (
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
          {item('התראות', '/notifications')}
          {can('docs.publish') ? item('סקירות', '/reviews') : null}
          {item('סל מיחזור', '/trash', trash.data?.items.length || null)}
        </nav>

        <div className="sec-title">נתונים</div>
        <nav aria-label="נתונים">
          {item('מסמכי מקור', '/sources', pendingSrc || null, true)}
          {item('קבצי נתונים', '/data', unmappedFiles || null, true)}
          {item('גרף קשרים', '/graph')}
          {item('לוחות בקרה', '/dashboards')}
          {mayFeedback ? item('משוב', '/feedback', openFeedback || null, true) : null}
          {can('analytics.read') ? item('נתוני שימוש', '/analytics') : null}
        </nav>

        {/* wave 5 — the learner's own backlog, the manager's authoring surface and the gap list.
            The badge counts what the signed-in user still owes (open + overdue), never history. */}
        {mayLearn || can('learning.manage') || can('gaps.read') ? (
          <>
            <div className="sec-title">למידה</div>
            <nav aria-label="למידה">
              {mayLearn ? item('הלמידה שלי', '/learning', dueLearning || null, true) : null}
              {can('learning.manage') ? item('ניהול למידה', '/learning/manage') : null}
              {can('gaps.read') ? item('פערי ידע', '/gaps') : null}
            </nav>
          </>
        ) : null}

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
            } else meta = String(scripts.data?.total ?? 0);
            return (
              <div
                key={src.id}
                className="src-row"
                role="button"
                tabIndex={0}
                onClick={() => {
                  onNavigate();
                  if (src.kind === 'fields') nav('/fields');
                  else if (src.kind === 'scripts') nav('/library?docType=T');
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
          <div className="src-add" role="button" tabIndex={0} onClick={() => go('/data')}>
            + הוסף מקור (JSON / CSV)
          </div>
        </div>

        {visibleAdmin.length || maySync ? (
          <>
            <div className="sec-title">ניהול</div>
            <nav>
              {maySync ? item('תור סנכרון', '/sync', pendingSync || null, true) : null}
              {visibleAdmin.map(([label, to]) => (
                <div
                  key={to}
                  className={'snav' + (on(to) ? ' on' : '')}
                  role="button"
                  tabIndex={0}
                  onClick={() => go(to)}
                >
                  <span className="dot" />
                  {label}
                </div>
              ))}
            </nav>
          </>
        ) : null}

        <div className="sec-title">עולמות תוכן</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 10px' }}>
          {worldRows.map((w) => (
            <div key={w.slug}>
              <div
                className={'cat-row' + (loc.pathname === `/library/${w.slug}` ? ' on' : '')}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setOpenWorld((cur) => (cur === w.slug ? null : w.slug));
                  go(`/library/${w.slug}`);
                }}
              >
                <span>
                  <span aria-hidden="true">{cat(w.slug).icon} </span>
                  <span className="world-name">{w.name}</span>
                </span>
                <span>{String(counts[w.slug] ?? 0)}</span>
              </div>
              {openWorld === w.slug
                ? (topics.data ?? []).map((t) => (
                    <div
                      key={t.id}
                      className={'cat-row sub' + (loc.pathname === `/topic/${t.id}` ? ' on' : '')}
                      role="button"
                      tabIndex={0}
                      style={{ paddingInlineStart: 22 }}
                      onClick={() => go(`/topic/${t.id}`)}
                    >
                      <span>{t.name}</span>
                      <span>{String(t.itemCount)}</span>
                    </div>
                  ))
                : null}
            </div>
          ))}
          {can('taxonomy.manage') ? (
            <div className="src-add" role="button" tabIndex={0} onClick={() => go('/admin/taxonomy')}>
              ⚙ ניהול עולמות ונושאים
            </div>
          ) : null}
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
