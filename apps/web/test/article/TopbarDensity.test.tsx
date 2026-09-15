/**
 * A-6. At 390 px the article topbar wrapped to 190 px — eleven controls in one wrapping flex row,
 * about a fifth of a phone screen of chrome before step 1 of the call. Below 480 px they collapse
 * into one `⋯`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { D_BROWSING } from '../msw/fixtures.js';

const real = window.matchMedia;

/** Makes exactly the topbar's query match, so nothing else in the app changes shape underneath. */
const atWidth = (px: number) => {
  window.matchMedia = ((q: string) => {
    const m = /max-width:\s*(\d+)px/.exec(q);
    return {
      matches: m ? px <= Number(m[1]) : false,
      media: q,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
};

const openArticle = async () => {
  const r = renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
  await screen.findByRole('heading', { name: /איטיות גלישה/ });
  return r;
};

afterEach(() => {
  window.matchMedia = real;
  vi.restoreAllMocks();
});

describe('article topbar density (A-6)', () => {
  it('keeps every action inline on a desktop width', async () => {
    atWidth(1440);
    await openArticle();
    expect(screen.getByRole('button', { name: /הדפסה/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'מצב תצוגה' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'פעולות נוספות' })).not.toBeInTheDocument();
  });

  it('collapses the actions into one overflow at 390 px, call pill still inline', async () => {
    atWidth(390);
    await openArticle();

    // The one control that does not go in the menu: the timer and the call-mode switch are what an
    // agent looks at during the thing this page exists for.
    expect(screen.getByRole('button', { name: /מצב שיחה|מצב קריאה/ })).toBeInTheDocument();

    // The eleven-control row is gone; one trigger stands in its place.
    expect(screen.queryByRole('button', { name: /הדפסה/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'מצב תצוגה' })).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'פעולות נוספות' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'פעולות נוספות' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    expect(within(menu).getByRole('menuitem', { name: /הדפסה/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /הצמד|מוצמד/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'קשרים' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitemradio', { name: 'תצוגת עבודה' })).toBeInTheDocument();
  });

  it('keeps the palette reachable — Ctrl K needs a keyboard a phone does not have', async () => {
    atWidth(390);
    await openArticle();
    await userEvent.click(screen.getByRole('button', { name: 'פעולות נוספות' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '🔍 חיפוש מהיר' }));
    // The palette's own dialog, opened from the menu rather than from the shortcut.
    expect(await screen.findByRole('dialog', { name: 'חיפוש' })).toBeInTheDocument();
  });
});
