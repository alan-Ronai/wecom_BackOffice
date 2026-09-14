import type { Preferences } from '@wecom/shared';

/** Applies the stored preferences to <html> exactly as legacy KB.applyPrefs did. */
export function applyPrefs(p: Preferences): void {
  const root = document.documentElement;
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = p.theme ?? (dark ? 'dark' : 'light');
  root.dataset.font = p.font === 'rubik' ? 'rubik' : 'plex';
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: null,
  font: 'plex',
  panel: true,
  callMode: true,
  sidebarExpanded: false,
  paneMode: 'work',
};
