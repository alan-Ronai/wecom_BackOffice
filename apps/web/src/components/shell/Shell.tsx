import { useCallback } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useEvents } from '../../api/events.js';
import { usePreferences, useSavePreferences } from '../../api/hooks/preferences.js';
import { KEYMAP } from '../../lib/constants.js';
import { useHotkeys } from '../../lib/keyboard.js';
import { Palette } from '../palette/Palette.js';
import { usePalette } from '../palette/paletteStore.js';
import { Peek } from '../article/Peek.js';
import { useModal } from '../ui/Modal.js';
import { NavProvider, useNav } from './navStore.js';
import { Sidebar } from './Sidebar.js';
import { TabStrip } from './TabStrip.js';
import { DrawerProvider, useDrawer } from './MobileDrawer.js';
import { Tour } from './Tour.js';

const RAIL_ROUTES = /^\/(doc|edit|history|sources)\b/;

function ShellInner() {
  const loc = useLocation();
  const prefs = usePreferences();
  const savePrefs = useSavePreferences();
  const palette = usePalette();
  const modal = useModal();
  const nav = useNav();
  const drawer = useDrawer();
  useEvents();

  const expanded = prefs.data?.sidebarExpanded ?? false;
  const railMode = RAIL_ROUTES.test(loc.pathname) && !expanded;
  const onDocRoute = /^\/doc\//.test(loc.pathname);

  const setExpanded = useCallback(
    (v: boolean) => {
      const base = prefs.data ?? {
        theme: null,
        font: 'plex' as const,
        panel: true,
        callMode: true,
        sidebarExpanded: false,
      };
      savePrefs.mutate({ ...base, sidebarExpanded: v });
    },
    [prefs.data, savePrefs],
  );

  const toggleTheme = useCallback(() => {
    const base = prefs.data ?? {
      theme: null,
      font: 'plex' as const,
      panel: true,
      callMode: true,
      sidebarExpanded: false,
    };
    savePrefs.mutate({
      ...base,
      theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark',
    });
  }, [prefs.data, savePrefs]);

  useHotkeys(
    {
      'ctrl+k': (e) => {
        e.preventDefault();
        palette.open();
      },
      'ctrl+d': (e) => {
        e.preventDefault();
        toggleTheme();
      },
      'ctrl+\\': (e) => {
        e.preventDefault();
        nav.toggleSplit();
      },
      'alt+t': (e) => {
        e.preventDefault();
        palette.open({ mode: 'newtab' });
      },
      'alt+ArrowLeft': (e) => {
        e.preventDefault();
        if (document.dir === 'rtl') nav.forward();
        else nav.back();
      },
      'alt+ArrowRight': (e) => {
        e.preventDefault();
        if (document.dir === 'rtl') nav.back();
        else nav.forward();
      },
      '?': (e) => {
        e.preventDefault();
        modal.open({
          title: '⌨️ כל הקיצורים',
          body: (
            <div className="keymap">
              {KEYMAP.map(([k, d]) => (
                <div key={k}>
                  <span>{d}</span>
                  <kbd>{k}</kbd>
                </div>
              ))}
            </div>
          ),
        });
      },
      w: () => {
        if (onDocRoute && nav.tabs.length) nav.closeTab(nav.activeTab);
      },
      Escape: () => {
        if (palette.state.open) palette.close();
        else if (drawer.open) drawer.setOpen(false);
        else if (nav.split) nav.toggleSplit();
      },
    },
    [palette, modal, nav, drawer, onDocRoute, toggleTheme],
  );

  return (
    <div id="app" className={railMode ? 'rail' : undefined}>
      {/* 6f: the first stop for a keyboard user, before the sidebar's ~30 links. */}
      <a className="skip-link" href="#content">
        דלג לתוכן
      </a>
      <Sidebar
        railMode={railMode}
        drawerOpen={drawer.open}
        onExpand={() => setExpanded(true)}
        onCollapse={() => setExpanded(false)}
        onNavigate={() => drawer.setOpen(false)}
      />
      <main className="content" id="content">
        {onDocRoute ? <TabStrip /> : null}
        <div id="view" className="view on">
          <Outlet />
        </div>
      </main>
      <Palette />
      <Peek />
      <Tour />
    </div>
  );
}

export function Shell() {
  return (
    <NavProvider>
      <DrawerProvider>
        <ShellInner />
      </DrawerProvider>
    </NavProvider>
  );
}
