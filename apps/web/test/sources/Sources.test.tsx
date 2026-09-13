import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { state, withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';

describe('<SourcesPage>', () => {
  it('renders tracked changes and accepts + publishes a suggestion', async () => {
    renderWithProviders(<App />, { route: '/sources' });
    expect(await screen.findByText('מעל 5 מגה')).toHaveClass('r-del');
    expect(screen.getByText('מעל 6 מגה')).toHaveClass('r-add');

    await userEvent.click(await screen.findByRole('button', { name: 'אשר' }));
    await waitFor(() => expect(state.suggestions[0].status).toBe('accepted'));

    await userEvent.click(screen.getByRole('button', { name: 'פרסם לספרייה' }));
    const dialog = await screen.findByRole('dialog', { name: 'פרסום לספרייה' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'פרסם' }));
    await waitFor(() => expect(state.suggestions[0].status).toBe('applied'));
  });

  it('toggles between changed paragraphs and the whole document', async () => {
    renderWithProviders(<App />, { route: '/sources' });
    await screen.findByText('מעל 5 מגה');
    expect(screen.queryByText(/בדיקת חסימת גלישה בארץ/)).toBeNull();
    await userEvent.click(screen.getByText('כל המסמך'));
    expect(await screen.findByText(/בדיקת חסימת גלישה בארץ/)).toBeInTheDocument();
  });

  it('processes a source on demand', async () => {
    renderWithProviders(<App />, { route: '/sources' });
    await userEvent.click(await screen.findByRole('button', { name: '⟳ עבד שינויים' }));
    await waitFor(() => expect(state.processed.length).toBe(1));
  });

  it('hides review actions without suggestions.review', async () => {
    server.use(withMe({ permissions: ['docs.read'] }));
    renderWithProviders(<App />, { route: '/sources' });
    await screen.findByText('מעל 5 מגה');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'אשר' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'פרסם לספרייה' })).toBeNull();
    expect(screen.queryByRole('button', { name: '⟳ עבד שינויים' })).toBeNull();
  });

  it('shows the local model state from health', async () => {
    renderWithProviders(<App />, { route: '/sources' });
    expect(await screen.findByText(/מודל מקומי · לא זמין/)).toBeInTheDocument();
  });
});
