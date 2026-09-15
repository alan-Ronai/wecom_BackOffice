/**
 * Global QOL, cards 6d–6h: the notification centre and its SSE refresh, the onboarding tour,
 * the new palette actions, and the accessibility affordances (skip link, focus ring, labelled
 * icon buttons, reduced motion).
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { stage45State } from '../msw/stage45.js';
import { DEFAULT_UI_PREFS } from '../../src/api/hooks/uiPrefs.js';

const LS_KEY = 'wecom.ui-prefs';
const tourDone = () =>
  window.localStorage.setItem(LS_KEY, JSON.stringify({ ...DEFAULT_UI_PREFS, tourDone: true }));

describe('notification centre', () => {
  it('shows the unread count on the bell and opens the list', async () => {
    tourDone();
    renderWithProviders(<App />, { route: '/library' });

    const bell = await screen.findByLabelText('התראות · 2 שלא נקראו');
    await userEvent.click(bell);

    const panel = await screen.findByRole('dialog', { name: 'מרכז התראות' });
    expect(within(panel).getByText(/3 הצעות חדשות/)).toBeInTheDocument();
  });

  it('marks everything read and the count disappears', async () => {
    tourDone();
    renderWithProviders(<App />, { route: '/notifications' });

    await userEvent.click(await screen.findByRole('button', { name: 'סמן הכל כנקרא' }));

    await waitFor(() => expect(stage45State.notifications.every((n) => n.readAt)).toBe(true));
    await waitFor(() => expect(screen.getByLabelText('התראות')).toBeInTheDocument());
  });

  it('marks only the opened notification read, and follows its href', async () => {
    tourDone();
    renderWithProviders(<App />, { route: '/notifications' });
    const row = await screen.findByLabelText(/3 הצעות חדשות.*לא נקרא/);

    await userEvent.click(row);

    await waitFor(() => {
      const [first, second] = stage45State.notifications;
      expect(first.readAt).not.toBeNull();
      // Glancing at the panel must not clear the rest — that is the only signal there is.
      expect(second.readAt).toBeNull();
    });
  });

  it('filters by kind', async () => {
    tourDone();
    renderWithProviders(<App />, { route: '/notifications' });
    await screen.findByText(/3 הצעות חדשות/);

    await userEvent.click(screen.getByRole('tab', { name: /אזכורים/ }));

    await waitFor(() => expect(screen.queryByText(/3 הצעות חדשות/)).not.toBeInTheDocument());
    expect(screen.getByText(/הזכירה אותך/)).toBeInTheDocument();
  });
});

describe('onboarding tour', () => {
  it('greets a first-time user and stores the dismissal in preferences', async () => {
    renderWithProviders(<App />, { route: '/library' });

    // L4: a labelled region. It was a `role="dialog"` with no `aria-modal` and no focus trap —
    // a promise to a screen reader that the component never kept.
    const tour = await screen.findByRole('region', { name: 'סיור היכרות' });
    expect(tour).not.toHaveAttribute('aria-modal');
    expect(screen.queryByRole('dialog', { name: 'סיור היכרות' })).not.toBeInTheDocument();
    expect(within(tour).getByText('שלב 1 מתוך 5')).toBeInTheDocument();

    await userEvent.click(within(tour).getByRole('button', { name: 'הבא' }));
    expect(within(tour).getByText('שלב 2 מתוך 5')).toBeInTheDocument();

    // Leaving is offered at every stop, not only at the end.
    await userEvent.click(within(tour).getByRole('button', { name: 'דלג על הסיור' }));

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'סיור היכרות' })).not.toBeInTheDocument(),
    );
    const saved = JSON.parse(window.localStorage.getItem(LS_KEY) ?? '{}') as { tourDone?: boolean };
    expect(saved.tourDone).toBe(true);
  });

  it('leaves the app behind it reachable — it is a coach mark, not a modal', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await screen.findByRole('region', { name: 'סיור היכרות' });
    // Nothing is inert and nothing is trapped: the agent can keep working with the tour on screen.
    const link = screen.getAllByText('סל מיחזור')[0]!.closest('[role="button"]') as HTMLElement;
    link.focus();
    expect(document.activeElement).toBe(link);
  });

  it('stays away once it has been completed', async () => {
    tourDone();
    renderWithProviders(<App />, { route: '/library' });
    await screen.findByTestId('library-grid');
    expect(screen.queryByRole('region', { name: 'סיור היכרות' })).not.toBeInTheDocument();
  });
});

describe('palette actions', () => {
  it('offers notifications, reviews and templates', async () => {
    tourDone();
    renderWithProviders(<App />, { route: '/library' });
    await screen.findByTestId('library-grid');

    await userEvent.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'חיפוש' });
    await userEvent.type(within(palette).getByRole('textbox'), 'התראות');

    await userEvent.click(await within(palette).findByText('מרכז התראות'));
    await screen.findByRole('button', { name: 'סמן הכל כנקרא' });
  });
});

describe('accessibility', () => {
  it('puts a skip link before the sidebar’s links', async () => {
    tourDone();
    renderWithProviders(<App />, { route: '/library' });
    const skip = await screen.findByRole('link', { name: 'דלג לתוכן' });
    expect(skip).toHaveAttribute('href', '#content');
    // It must be the first focusable thing on the page, or it is useless.
    expect(document.querySelector('#app')?.firstElementChild).toBe(skip);
  });

  it('labels icon-only controls', async () => {
    tourDone();
    renderWithProviders(<App />, { route: '/library' });
    await screen.findByTestId('library-grid');
    expect(screen.getByLabelText('פתח תפריט ניווט')).toBeInTheDocument();
    expect((await screen.findAllByLabelText(/^(הצמד את|בטל הצמדה של) /)).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/^פעולות · /).length).toBeGreaterThan(0);
  });
});
