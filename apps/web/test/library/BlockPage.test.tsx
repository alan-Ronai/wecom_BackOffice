import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { BLK_SIM, D_BROWSING, D_INTL } from '../msw/fixtures.js';
import { state, withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';

const route = `/blocks/${BLK_SIM}`;

describe('<BlockPage>', () => {
  it('shows the block content, its versions and usage split by mode', async () => {
    renderWithProviders(<App />, { route });

    expect(await screen.findByText(/בקש מהלקוח לאתחל מכשיר/)).toBeInTheDocument();
    const usage = screen.getByTestId('block-usage');
    expect(within(usage).getAllByText('מוטמע')).toHaveLength(2);
    expect(within(usage).getAllByText('מפנה')).toHaveLength(1);
    expect(screen.getByText(/2 הטמעות · 1 הפניות/)).toBeInTheDocument();
    // Newest version first, and one entry per version the block has had.
    const timeline = screen.getByText('עדכון v2').closest('ol')!;
    expect(
      within(timeline)
        .getAllByText(/^v\d$/)
        .map((n) => n.textContent),
    ).toEqual(['v2', 'v1']);
  });

  it('opens a using document at its step', async () => {
    renderWithProviders(<App />, { route });
    const usage = await screen.findByTestId('block-usage');
    await userEvent.click(within(usage).getByText(/אין גלישה בחו"ל/));
    await waitFor(() => expect(document.querySelector('.step.cur')).toHaveAttribute('data-step', 's7'));
  });

  it('"update all references" republishes each embedding document in sequence', async () => {
    renderWithProviders(<App />, { route });
    await screen.findByTestId('block-usage');

    // Two embeds, one reference — only the embeds need a republish, so the button says 2.
    await userEvent.click(screen.getByRole('button', { name: 'עדכן את כל ההפניות (2)' }));
    const dialog = await screen.findByRole('dialog', { name: 'עדכון כל ההפניות' });
    expect(within(dialog).getByText(/שני מסמכים מטמיעים את הבלוק/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'עדכן הכל' }));

    await waitFor(() => expect(state.published).toHaveLength(2));
    expect(state.published.map((p) => p.id).sort()).toEqual([D_BROWSING, D_INTL].sort());
    // One label per publish, naming the block and its version, so the document history explains itself.
    expect(state.published[0].label).toContain('ריענון SIM');
    expect(await screen.findByText('שני מסמכים עודכנו')).toBeInTheDocument();
  });

  it('edits the block through the existing block route', async () => {
    renderWithProviders(<App />, { route });
    await screen.findByTestId('block-usage');

    await userEvent.click(screen.getByRole('button', { name: '✎ ערוך בלוק' }));
    const dialog = await screen.findByRole('dialog', { name: '✎ עריכת בלוק משותף' });
    await userEvent.clear(within(dialog).getByLabelText('שם הבלוק'));
    await userEvent.type(within(dialog).getByLabelText('שם הבלוק'), 'ריענון SIM v2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'שמור' }));

    expect(await screen.findByText(/הבלוק נשמר/)).toBeInTheDocument();
  });

  it('refuses to save a block with no name', async () => {
    renderWithProviders(<App />, { route });
    await screen.findByTestId('block-usage');
    await userEvent.click(screen.getByRole('button', { name: '✎ ערוך בלוק' }));
    const dialog = await screen.findByRole('dialog', { name: '✎ עריכת בלוק משותף' });
    await userEvent.clear(within(dialog).getByLabelText('שם הבלוק'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'שמור' }));
    expect(await screen.findByText('לבלוק חייב להיות שם')).toBeInTheDocument();
  });

  it('warns with the impact before deleting', async () => {
    renderWithProviders(<App />, { route });
    await screen.findByTestId('block-usage');

    await userEvent.click(screen.getByRole('button', { name: '🗑 מחק בלוק' }));
    const dialog = await screen.findByRole('dialog', { name: 'מחיקת בלוק משותף' });
    expect(within(dialog).getByText(/שני מסמכים משתמשים בבלוק/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'מחק בלוק' }));
    expect(await screen.findByText('הבלוק הועבר לסל המיחזור')).toBeInTheDocument();
  });

  it('links into the graph focused on this block', async () => {
    renderWithProviders(<App />, { route });
    await screen.findByTestId('block-usage');
    await userEvent.click(screen.getByRole('button', { name: 'הצג בגרף' }));
    const g = await screen.findByTestId('graph-svg');
    await waitFor(() => expect(g.querySelector('.gnode.focus')).not.toBeNull());
  });

  it('hides editing and republishing without the permissions', async () => {
    server.use(withMe({ permissions: ['docs.read'] }));
    renderWithProviders(<App />, { route });
    await screen.findByTestId('block-usage');
    expect(screen.queryByRole('button', { name: '✎ ערוך בלוק' })).toBeNull();
    expect(screen.queryByRole('button', { name: /עדכן את כל ההפניות/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '🗑 מחק בלוק' })).toBeNull();
  });

  it('is reachable from the blocks list', async () => {
    renderWithProviders(<App />, { route: '/blocks' });
    await userEvent.click(await screen.findByText('ריענון SIM'));
    expect(await screen.findByTestId('block-usage')).toBeInTheDocument();
  });
});
