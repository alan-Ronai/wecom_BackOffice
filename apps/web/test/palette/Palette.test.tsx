import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';

const openPalette = async () => {
  await screen.findAllByText('ספריית ידע');
  await userEvent.keyboard('{Control>}k{/Control}');
  return screen.findByPlaceholderText(/חפש מסמך/);
};

describe('<Palette>', () => {
  it('searches the server and opens a step hit at its step', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const input = await openPalette();
    await userEvent.type(input, 'ריענון sim');
    const res = document.querySelector('.palette .res') as HTMLElement;
    const hit = await within(res).findByText(/ריענון SIM/);
    expect(hit.closest('.ri')).not.toBeNull();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(document.querySelector('.step.cur')?.getAttribute('data-step')).toBe('s11'));
  });

  it('lists local actions when empty and cycles types with Tab', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await openPalette();
    expect(await screen.findByText('צור פריט ידע חדש')).toBeInTheDocument();
    await userEvent.keyboard('{Tab}');
    await waitFor(() => expect(screen.getByText('מסמכים')).toHaveClass('on'));
  });

  it('shows the result stat footer', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const input = await openPalette();
    await userEvent.type(input, 'sim');
    await waitFor(() => expect(document.querySelector('.foot .stat')?.textContent).toMatch(/תוצאות/));
  });

  it('runs a local action', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await openPalette();
    const rows = await screen.findAllByText('מוצמדים');
    await userEvent.click(rows[rows.length - 1]);
    expect(await screen.findByRole('heading', { name: /מוצמדים/ })).toBeInTheDocument();
  });
});
