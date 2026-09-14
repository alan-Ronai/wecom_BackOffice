import type { Page } from '@playwright/test';

/**
 * The onboarding tour greets every first-time user (card 6e), which in a fresh browser context
 * means every spec. Specs that are not *about* the tour seed the dismissal before the app boots,
 * the same way a returning user arrives.
 *
 * Written through the same `localStorage` mirror `useUiPrefs` reads, so no route interception is
 * needed and the seeding stays honest about where the preference lives.
 *
 * `addInitScript` runs on **every** navigation, including a reload, so the seed is applied as a
 * *default*: anything the app has since written wins. Otherwise a spec that reloads to check a
 * preference persisted would be overwriting the very value it is asserting.
 */
const LS_KEY = 'wecom.ui-prefs';

const BASE = {
  theme: null,
  font: 'plex',
  panel: true,
  callMode: true,
  sidebarExpanded: false,
  tourDone: true,
};

export async function seedUiPrefs(page: Page, prefs: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript(
    ([key, seed]) => {
      const k = key as string;
      let existing: Record<string, unknown> = {};
      try {
        existing = JSON.parse(window.localStorage.getItem(k) ?? '{}') as Record<string, unknown>;
      } catch {
        existing = {};
      }
      window.localStorage.setItem(k, JSON.stringify({ ...(seed as object), ...existing }));
    },
    [LS_KEY, { ...BASE, ...prefs }] as const,
  );
}

export const skipTour = (page: Page): Promise<void> => seedUiPrefs(page);
