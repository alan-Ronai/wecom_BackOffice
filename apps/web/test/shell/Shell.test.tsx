import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { D_BROWSING } from '../msw/fixtures.js';

describe('<Shell>', () => {
  it('renders sidebar counts and category rows', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await waitFor(() => expect(screen.getAllByText('ספריית ידע').length).toBeGreaterThan(0));
    // Wave 4: the world rows come from `GET /worlds`, so this one resolves asynchronously. The
    // name is scoped to `.world-name` because the library toolbar's world select now offers the
    // same six names as `<option>`s.
    await waitFor(() =>
      expect(screen.getAllByText('חו"ל ונדידה').some((el) => el.classList.contains('world-name'))).toBe(true),
    );
    expect(screen.getByRole('button', { name: /חיפוש בכל המקורות/ })).toBeInTheDocument();
    expect(screen.getByText('ענבר ל.')).toBeInTheDocument();
  });

  it('collapses to a rail on document routes and expands back', async () => {
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await waitFor(() => expect(document.querySelector('#app')).toHaveClass('rail'));
    await userEvent.click(screen.getByTitle('הרחב תפריט'));
    await waitFor(() => expect(document.querySelector('#app')).not.toHaveClass('rail'));
  });

  it('opens the palette with Ctrl+K and closes it with Escape', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await screen.findAllByText('ספריית ידע');
    await userEvent.keyboard('{Control>}k{/Control}');
    const input = await screen.findByPlaceholderText(/חפש מסמך/);
    expect(input).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByPlaceholderText(/חפש מסמך/)).toBeNull());
  });

  it('opens the keymap with ?', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await screen.findAllByText('ספריית ידע');
    await userEvent.keyboard('?');
    expect(await screen.findByText('חיפוש בכל המקורות')).toBeInTheDocument();
    expect(screen.getByText('מפת הקיצורים')).toBeInTheDocument();
  });

  it('toggles the theme with Ctrl+D', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await screen.findAllByText('ספריית ידע');
    const before = document.documentElement.dataset.theme;
    await userEvent.keyboard('{Control>}d{/Control}');
    await waitFor(() => expect(document.documentElement.dataset.theme).not.toBe(before));
  });
});
