/**
 * Library QOL, card 6a: saved views, density, keyboard list mode, multi-select + bulk actions,
 * and the per-user "changed since I last looked" indicator.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { fx, D_BROWSING, D_INTL } from '../msw/fixtures.js';
import { state } from '../msw/handlers.js';
import { stage45State } from '../msw/stage45.js';
import { DEFAULT_UI_PREFS } from '../../src/api/hooks/uiPrefs.js';

const LS_KEY = 'wecom.ui-prefs';
const mirror = (patch: Record<string, unknown>) =>
  window.localStorage.setItem(LS_KEY, JSON.stringify({ ...DEFAULT_UI_PREFS, ...patch }));

beforeEach(() => window.localStorage.clear());

describe('saved views', () => {
  it('lists the saved views and applies one', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await screen.findByTestId('library-grid');

    await userEvent.click(await screen.findByLabelText('תצוגה שמורה: חו"ל'));

    // Applying a view navigates to its category and records it in preferences.
    await screen.findByRole('heading', { name: /חו"ל ונדידה/ });
    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(LS_KEY) ?? '{}') as { savedViewId?: string };
      expect(saved.savedViewId).toBe(stage45State.views[0].id);
    });
  });

  it('saves the current filter as a new view', async () => {
    renderWithProviders(<App />, { route: '/library/tech' });
    await screen.findByTestId('library-grid');

    await userEvent.click(screen.getByText('גל 1'));
    await userEvent.click(screen.getByRole('button', { name: '✚ שמור תצוגה' }));
    await userEvent.type(await screen.findByLabelText('שם התצוגה (למשל: חו"ל · ממתין לעדכון)'), 'טכני גל 1');
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }));

    await waitFor(() => {
      const created = stage45State.views.find((v) => v.name === 'טכני גל 1');
      expect(created?.query).toMatchObject({ category: 'tech', wave: 1 });
    });
  });
});

describe('density and list mode persist to preferences', () => {
  it('switches density and stores it', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await screen.findByTestId('library-grid');

    await userEvent.click(screen.getByRole('button', { name: 'דחוס' }));

    await waitFor(() =>
      expect(document.querySelector('.lib-body')).toHaveAttribute('data-density', 'compact'),
    );
    const saved = JSON.parse(window.localStorage.getItem(LS_KEY) ?? '{}') as { density?: string };
    expect(saved.density).toBe('compact');
  });

  it('restores list mode from the stored preference', async () => {
    mirror({ libraryView: 'list' });
    renderWithProviders(<App />, { route: '/library' });
    await screen.findByTestId('doc-list');
    expect(screen.getByTestId('library-grid')).not.toBeVisible();
  });
});

describe('keyboard list mode', () => {
  const asList = async () => {
    mirror({ libraryView: 'list' });
    renderWithProviders(<App />, { route: '/library' });
    return screen.findByTestId('doc-list');
  };
  const cursorTitle = () => document.querySelector('.dl-row.cur .t > span:nth-child(2)')?.textContent;

  it('moves with J/K, selects with X and pins with P', async () => {
    const list = await asList();
    await waitFor(() => expect(within(list).getAllByRole('row').length).toBeGreaterThan(2));
    const first = cursorTitle();

    await userEvent.keyboard('j');
    await waitFor(() => expect(cursorTitle()).not.toBe(first));

    await userEvent.keyboard('x');
    await screen.findByText('1 נבחרו');

    await userEvent.keyboard('k');
    await waitFor(() => expect(cursorTitle()).toBe(first));

    // `docBrowsing` starts pinned, so P on the first row unpins it.
    expect(state.pins.has(D_BROWSING)).toBe(true);
    await userEvent.keyboard('p');
    await waitFor(() => expect(state.pins.has(D_BROWSING)).toBe(false));
  });

  it('clears the selection with Escape', async () => {
    await asList();
    await userEvent.keyboard('x');
    await screen.findByText('1 נבחרו');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('1 נבחרו')).not.toBeInTheDocument());
  });
});

describe('bulk actions', () => {
  it('applies a wave change to every selected document', async () => {
    mirror({ libraryView: 'list' });
    renderWithProviders(<App />, { route: '/library' });
    await screen.findByTestId('doc-list');

    await userEvent.click(await screen.findByLabelText(`בחר את ${fx.docBrowsing.title}`));
    await userEvent.click(await screen.findByLabelText(`בחר את ${fx.docIntl.title}`));
    await screen.findByText('2 נבחרו');

    const bar = screen.getByRole('region', { name: 'פעולות על הפריטים שנבחרו' });
    await userEvent.click(within(bar).getByRole('button', { name: 'שנה גל ▾' }));
    await userEvent.click(await within(bar).findByRole('button', { name: 'גל 3' }));

    await waitFor(() =>
      expect(stage45State.bulk.at(-1)).toEqual({
        action: 'set-wave',
        ids: expect.arrayContaining([D_BROWSING, D_INTL]) as string[],
      }),
    );
    // The bar closes once the action lands, so nothing is left "selected" but invisible.
    await waitFor(() => expect(screen.queryByText('2 נבחרו')).not.toBeInTheDocument());
  });

  it('confirms before a bulk delete', async () => {
    mirror({ libraryView: 'list' });
    renderWithProviders(<App />, { route: '/library' });
    await screen.findByTestId('doc-list');
    await userEvent.click(await screen.findByLabelText(`בחר את ${fx.docBrowsing.title}`));

    const bar = screen.getByRole('region', { name: 'פעולות על הפריטים שנבחרו' });
    await userEvent.click(within(bar).getByRole('button', { name: 'מחק' }));
    await screen.findByText(/יועברו לסל המיחזור/);
    await userEvent.click(screen.getByRole('button', { name: 'ביטול' }));

    expect(stage45State.bulk).toHaveLength(0);
  });
});

describe('changed since I last looked', () => {
  it('marks a document that changed after the last time this user opened it', async () => {
    // Seen a week ago; every fixture card was updated more recently than that.
    mirror({
      libraryView: 'list',
      lastSeen: { [D_BROWSING]: new Date(Date.parse(fx.cards[0].updatedAt) - 864e5).toISOString() },
    });
    renderWithProviders(<App />, { route: '/library' });
    const list = await screen.findByTestId('doc-list');

    await waitFor(() => expect(within(list).getAllByLabelText('השתנה מאז שצפית')).toHaveLength(1));
  });

  it('does not mark a document opened after its last change', async () => {
    mirror({
      libraryView: 'list',
      lastSeen: { [D_BROWSING]: new Date(Date.now() + 60_000).toISOString() },
    });
    renderWithProviders(<App />, { route: '/library' });
    const list = await screen.findByTestId('doc-list');
    await within(list).findByText(fx.docBrowsing.title);
    expect(within(list).queryByLabelText('השתנה מאז שצפית')).not.toBeInTheDocument();
  });

  it('stamps the last-seen map when the document is opened', async () => {
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await screen.findByRole('heading', { name: /איטיות גלישה/ });
    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(LS_KEY) ?? '{}') as {
        lastSeen?: Record<string, string>;
      };
      expect(saved.lastSeen?.[D_BROWSING]).toBeTruthy();
    });
  });
});
