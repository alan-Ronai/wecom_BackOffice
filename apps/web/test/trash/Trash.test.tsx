import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { state, withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';

describe('<TrashPage>', () => {
  it('shows countdown, impact and restores an item', async () => {
    renderWithProviders(<App />, { route: '/trash' });
    expect(await screen.findByText('2 קישורים שבורים')).toBeInTheDocument();
    expect(screen.getByText(/בעוד \d+ ימים|היום/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'שחזר' }));
    await waitFor(() => expect(state.trash.length).toBe(0));
    expect(await screen.findByText('סל המיחזור ריק')).toBeInTheDocument();
  });

  it('empties the bin after confirmation', async () => {
    renderWithProviders(<App />, { route: '/trash' });
    await screen.findByText('2 קישורים שבורים');
    await userEvent.click(screen.getByRole('button', { name: 'רוקן סל' }));
    const dialog = await screen.findByRole('dialog', { name: 'ריקון סל המיחזור' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'רוקן סל' }));
    await waitFor(() => expect(state.trash.length).toBe(0));
  });

  it('supports multi-select bulk restore', async () => {
    renderWithProviders(<App />, { route: '/trash' });
    await screen.findByText('2 קישורים שבורים');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(await screen.findByRole('button', { name: /שחזר 1 נבחרים/ }));
    await waitFor(() => expect(state.trash.length).toBe(0));
  });

  it('hides restore and purge without docs.restore', async () => {
    server.use(withMe({ permissions: ['docs.read'] }));
    renderWithProviders(<App />, { route: '/trash' });
    await screen.findByText('2 קישורים שבורים');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'שחזר' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'רוקן סל' })).toBeNull();
  });
});
