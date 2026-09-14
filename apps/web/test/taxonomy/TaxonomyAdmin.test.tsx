import { describe, it, expect } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { PERMISSIONS } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe, state } from '../msw/handlers.js';
import { server } from '../msw/server.js';

const asAdmin = () => server.use(withMe({ roles: ['admin'], permissions: [...PERMISSIONS] }));

describe('admin taxonomy', () => {
  it('lists worlds, shows the topics of the selected world, creates a topic and reorders', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/taxonomy' });
    // Scoped to the page's own list: the shell's world nav carries the same labels.
    const worlds = await screen.findByTestId('worlds-list');
    expect(await within(worlds).findByText('תמיכה טכנית')).toBeInTheDocument();
    await userEvent.click(within(worlds).getByText('תמיכה טכנית'));
    const topics = await screen.findByTestId('topics-list');
    expect(
      within(topics)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining('תקלות גלישה'), expect.stringContaining('הגדרות APN')]);
    await userEvent.click(within(topics).getAllByRole('button', { name: 'למטה' })[0]!);
    expect(state.topics[0]!.name).toBe('הגדרות APN');
    await userEvent.type(screen.getByLabelText('שם נושא חדש'), 'נתבים');
    await userEvent.type(screen.getByLabelText('מזהה נושא חדש'), 'routers');
    await userEvent.click(screen.getByRole('button', { name: '✚ נושא' }));
    expect(await within(await screen.findByTestId('topics-list')).findByText(/נתבים/)).toBeInTheDocument();
    expect(state.topics.some((t) => t.slug === 'routers' && t.worldSlug === 'tech')).toBe(true);
  });

  it('asks before forcing a 409, and refuses to force past any other error', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/taxonomy' });
    const worlds = await screen.findByTestId('worlds-list');
    await within(worlds).findByText('תמיכה טכנית');
    const row = within(worlds).getAllByRole('listitem')[0]!; // 'sim', itemCount 3 → 409
    await userEvent.click(within(row).getByRole('button', { name: 'השבת' }));
    await userEvent.click(await screen.findByRole('button', { name: 'אישור' }));
    // The 409 is the *only* answer that means "it still has items in it".
    await userEvent.click(await screen.findByRole('button', { name: 'אישור' }));
    await waitFor(() => expect(state.worlds.find((w) => w.slug === 'sim')!.active).toBe(false));

    // A 500 must not be reported as WORLD_IN_USE, and must never be retried with force.
    let forced = false;
    server.use(
      http.delete('/api/v1/worlds/:slug', ({ request }) => {
        if (new URL(request.url).searchParams.get('force') === 'true') forced = true;
        return HttpResponse.json({ code: 'INTERNAL', message: 'תקלה' }, { status: 500 });
      }),
    );
    const tech = within(await screen.findByTestId('worlds-list')).getAllByRole('listitem')[1]!;
    await userEvent.click(within(tech).getByRole('button', { name: 'השבת' }));
    await userEvent.click(await screen.findByRole('button', { name: 'אישור' }));
    expect(await screen.findByText('השבתת עולם התוכן נכשלה')).toBeInTheDocument();
    expect(forced).toBe(false);
  });

  it('reactivates a deactivated topic and rejects a slug the contract would 400', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/taxonomy' });
    const worlds = await screen.findByTestId('worlds-list');
    await userEvent.click(await within(worlds).findByText('תמיכה טכנית'));
    const topics = await screen.findByTestId('topics-list');
    const first = within(topics).getAllByRole('listitem')[0]!;
    await userEvent.click(within(first).getByRole('button', { name: 'השבת' }));
    await userEvent.click(await screen.findByRole('button', { name: 'אישור' }));
    // Deactivation used to be one-way: the row offered "השבת" and never "הפעל".
    const back = await within(await screen.findByTestId('topics-list')).findByRole('button', {
      name: 'הפעל',
    });
    await userEvent.click(back);
    await waitFor(() => expect(state.topics.every((t) => t.active)).toBe(true));

    await userEvent.type(screen.getByLabelText('שם נושא חדש'), 'נתבים');
    await userEvent.type(screen.getByLabelText('מזהה נושא חדש'), 'נתבים');
    await userEvent.click(screen.getByRole('button', { name: '✚ נושא' }));
    expect(await screen.findByText(/המזהה חייב להיות/)).toBeInTheDocument();
    expect(state.topics.some((t) => t.name === 'נתבים')).toBe(false);
  });

  /**
   * D-M4: drag ordering was asked for by the spec and the lane shipped ↑/↓ instead, for reasons
   * that hold (keyboard, aria-labels, disabled at the ends). So drag is *added*, and the point of
   * this case is that both paths reach the same `PUT /worlds/reorder`.
   */
  it('reorders worlds by dragging, and keeps the ↑/↓ buttons as the keyboard path', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/taxonomy' });
    const worlds = await screen.findByTestId('worlds-list');
    await within(worlds).findByText('תמיכה טכנית');
    // The msw handler writes `position` rather than resequencing the array, like the server.
    const order = () => [...state.worlds].sort((a, b) => a.position - b.position).map((w) => w.slug);
    const before = order();
    const rows = within(worlds).getAllByRole('listitem');

    const transfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: () => undefined,
      getData: () => '0',
    };
    fireEvent.dragStart(rows[0]!, { dataTransfer: transfer });
    fireEvent.dragOver(rows[2]!, { dataTransfer: transfer });
    fireEvent.drop(rows[2]!, { dataTransfer: transfer });

    const moved = [...before];
    moved.splice(2, 0, moved.splice(0, 1)[0]!);
    await waitFor(() => expect(order()).toEqual(moved));

    // The buttons still work, and still move by one.
    const first = within(await screen.findByTestId('worlds-list')).getAllByRole('listitem')[0]!;
    await userEvent.click(within(first).getByRole('button', { name: 'למטה' }));
    const swapped = [...moved];
    [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    await waitFor(() => expect(order()).toEqual(swapped));
  });

  it('hides mutations without taxonomy.manage', async () => {
    server.use(withMe({ roles: ['agent'], permissions: ['docs.read', 'users.manage'] }));
    renderWithProviders(<App />, { route: '/admin/taxonomy' });
    const worlds = await screen.findByTestId('worlds-list');
    expect(await within(worlds).findByText('תמיכה טכנית')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '✚ עולם תוכן' })).toBeNull();
  });
});
