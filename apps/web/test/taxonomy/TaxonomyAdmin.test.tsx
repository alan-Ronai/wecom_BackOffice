import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('hides mutations without taxonomy.manage', async () => {
    server.use(withMe({ roles: ['agent'], permissions: ['docs.read', 'users.manage'] }));
    renderWithProviders(<App />, { route: '/admin/taxonomy' });
    const worlds = await screen.findByTestId('worlds-list');
    expect(await within(worlds).findByText('תמיכה טכנית')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '✚ עולם תוכן' })).toBeNull();
  });
});
