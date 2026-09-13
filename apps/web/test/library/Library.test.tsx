import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { state, withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { D_INTL } from '../msw/fixtures.js';

describe('<LibraryPage>', () => {
  it('groups cards by wave with pinned first and the auto CRM card', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const grid = await screen.findByTestId('library-grid');
    await waitFor(() => expect(within(grid).getAllByTestId('rule').length).toBeGreaterThan(1));
    const rules = within(grid)
      .getAllByTestId('rule')
      .map((r) => r.textContent);
    expect(rules[0]).toMatch(/מוצמדים/);
    expect(rules[1]).toMatch(/גל 1/);
    expect(within(grid).getByText('שדות CRM שמשתנים השבוע')).toBeInTheDocument();
  });

  it('filters by facet and category', async () => {
    renderWithProviders(<App />, { route: '/library/intl' });
    await screen.findByRole('heading', { name: /חו"ל ונדידה/ });
    expect(await screen.findByText('אין גלישה בחו"ל')).toBeInTheDocument();
    const facets = document.querySelector('.facets') as HTMLElement;
    await userEvent.click(within(facets).getByText('גל 2'));
    await waitFor(() => expect(screen.queryByText('אין גלישה בחו"ל')).not.toBeInTheDocument());
    expect(screen.getByText('רכישת חבילת חו"ל לפני טיסה')).toBeInTheDocument();
  });

  it('toggles pin from the star', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const card = (await screen.findByText('אין גלישה בחו"ל')).closest('.tcard')!;
    await userEvent.click(within(card as HTMLElement).getByTitle('הצמד'));
    await waitFor(() => expect(state.pins.has(D_INTL)).toBe(true));
  });

  it('hides create/import without docs.create', async () => {
    server.use(withMe({ permissions: ['docs.read'] }));
    renderWithProviders(<App />, { route: '/library' });
    await screen.findByTestId('library-grid');
    expect(screen.queryByRole('button', { name: /פריט ידע חדש/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /ייבוא/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'ייצוא' })).toBeInTheDocument();
  });

  it('lists CRM fields with their change state', async () => {
    renderWithProviders(<App />, { route: '/fields' });
    expect(await screen.findByText('שינויים לבדיקה')).toBeInTheDocument();
    expect(screen.getAllByText('שונה שם').length).toBeGreaterThan(0);
  });

  it('lists shared blocks with their action count', async () => {
    renderWithProviders(<App />, { route: '/blocks' });
    await screen.findByRole('heading', { name: /בלוקים משותפים/ });
    expect(await screen.findByText('ריענון SIM')).toBeInTheDocument();
    expect(screen.getAllByText(/פעולות/).length).toBeGreaterThan(0);
  });
});
