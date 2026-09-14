import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';

const dataNav = () => screen.findByRole('navigation', { name: 'נתונים' });

describe('the "נתונים" sidebar section', () => {
  it('lists the four connected-data destinations', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const nav = await dataNav();
    for (const label of ['מסמכי מקור', 'קבצי נתונים', 'גרף קשרים', 'לוחות בקרה'])
      expect(within(nav).getByText(label)).toBeInTheDocument();
  });

  it('navigates to each of them', async () => {
    renderWithProviders(<App />, { route: '/library' });
    let nav = await dataNav();

    await userEvent.click(within(nav).getByText('גרף קשרים'));
    expect(await screen.findByTestId('graph-svg')).toBeInTheDocument();

    nav = await dataNav();
    await userEvent.click(within(nav).getByText('לוחות בקרה'));
    expect(await screen.findByText('כיסוי')).toBeInTheDocument();

    nav = await dataNav();
    await userEvent.click(within(nav).getByText('קבצי נתונים'));
    expect(await screen.findByTestId('data-files')).toBeInTheDocument();
  });

  it('badges the data files that import nothing until a column is mapped', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const nav = await dataNav();
    // Exactly one fixture file (`agents-scripts.csv`) has an all-`ignore` mapping.
    await waitFor(() =>
      expect(within(nav).getByText('קבצי נתונים').querySelector('.cnt.badge')).toHaveTextContent('1'),
    );
    // The other entries carry no badge — nothing about them needs attention.
    expect(within(nav).getByText('גרף קשרים').querySelector('.cnt')).toBeNull();
  });

  it('marks the current section as active', async () => {
    renderWithProviders(<App />, { route: '/dashboards' });
    const nav = await dataNav();
    expect(within(nav).getByText('לוחות בקרה')).toHaveClass('on');
    expect(within(nav).getByText('גרף קשרים')).not.toHaveClass('on');
  });
});

describe('palette actions for the connected-data screens', () => {
  const openPalette = async () => {
    await userEvent.keyboard('{Control>}k{/Control}');
    return screen.findByPlaceholderText(/חפש מסמך/);
  };

  it('offers the three new destinations', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await screen.findAllByText('ספריית ידע');
    await openPalette();

    await userEvent.type(screen.getByPlaceholderText(/חפש מסמך/), 'גרף');
    expect(await screen.findByText('גרף קשרים – מה מפנה למה')).toBeInTheDocument();
  });

  it('runs one of them', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await screen.findAllByText('ספריית ידע');
    await openPalette();
    await userEvent.type(screen.getByPlaceholderText(/חפש מסמך/), 'לוחות');
    await userEvent.click(await screen.findByText('לוחות בקרה – כיסוי, רעננות, שימוש'));
    expect(await screen.findByText('צינור הצעות')).toBeInTheDocument();
  });

  it('offers "focus the current document in the graph" only on a document route', async () => {
    const { unmount } = renderWithProviders(<App />, { route: '/library' });
    await screen.findAllByText('ספריית ידע');
    await openPalette();
    await userEvent.type(screen.getByPlaceholderText(/חפש מסמך/), 'מקד');
    await waitFor(() => expect(screen.queryByText('גרף קשרים – מקד על המסמך הנוכחי')).toBeNull());
    unmount();

    renderWithProviders(<App />, { route: '/doc/11111111-1111-4111-8111-111111111111' });
    await screen.findByText(/15 שלבים/);
    await openPalette();
    await userEvent.type(screen.getByPlaceholderText(/חפש מסמך/), 'מקד');
    expect(await screen.findByText('גרף קשרים – מקד על המסמך הנוכחי')).toBeInTheDocument();
  });
});
