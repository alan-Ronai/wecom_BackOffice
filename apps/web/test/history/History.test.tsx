import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { server } from '../msw/server.js';
import { withMe } from '../msw/handlers.js';
import { D_BROWSING } from '../msw/fixtures.js';

const D = D_BROWSING;

describe('<HistoryPage>', () => {
  it('lists versions, compares v6 to current, and offers restore', async () => {
    renderWithProviders(<App />, { route: `/history/${D}/6` });
    expect(await screen.findByText('v7 · נוכחי')).toBeInTheDocument();
    expect(screen.getByText('v6 · בהשוואה')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'שחזר ל-v6' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'הצג JSON' }));
    expect(await screen.findByText(/"slug": "browsing"/)).toBeInTheDocument();
  });

  it('restores through the confirmation dialog', async () => {
    renderWithProviders(<App />, { route: `/history/${D}/6` });
    await userEvent.click(await screen.findByRole('button', { name: 'שחזר ל-v6' }));
    const dialog = await screen.findByRole('dialog', { name: 'שחזור ל-v6' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'שחזר ל-v6' }));
    await waitFor(() => expect(screen.getByText(/שוחזר מגרסה v6/)).toBeInTheDocument());
  });

  it('hides restore without docs.restore', async () => {
    server.use(withMe({ permissions: ['docs.read'] }));
    renderWithProviders(<App />, { route: `/history/${D}/6` });
    await screen.findByText('v7 · נוכחי');
    await waitFor(() => expect(screen.queryByRole('button', { name: /שחזר ל-v/ })).toBeNull());
  });

  it('shows the picker without an id', async () => {
    renderWithProviders(<App />, { route: '/history' });
    expect(await screen.findByRole('heading', { name: 'היסטוריית גרסאות' })).toBeInTheDocument();
    expect(await screen.findByText('איטיות גלישה / חוסר גלישה')).toBeInTheDocument();
  });
});
