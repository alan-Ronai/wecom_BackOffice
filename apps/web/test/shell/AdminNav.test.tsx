import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PERMISSIONS } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';

const asAdmin = () => server.use(withMe({ roles: ['admin'], permissions: [...PERMISSIONS] }));

const sidebar = () => screen.getByRole('complementary', { name: 'ניווט ראשי' });

describe('shell · the ניהול section', () => {
  it('lists every admin destination for an admin, with the sync backlog as a badge', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/library' });
    await screen.findByText('ניהול');
    const nav = sidebar();
    for (const label of [
      'תור סנכרון',
      'משתמשים',
      'תפקידים והרשאות',
      'מיפוי קבוצות',
      'חיבורים פעילים',
      'יומן פעולות',
      'זהות וכניסה',
      'מחברים',
      'מצב מערכת',
    ])
      expect(within(nav).getByText(label)).toBeInTheDocument();

    // One import, one push and one conflict are waiting; the four synced links are not a backlog.
    const sync = within(nav).getByText('תור סנכרון').closest('.snav') as HTMLElement;
    await waitFor(() => expect(within(sync).getByText('3')).toBeInTheDocument());
  });

  it('navigates from the sidebar into the admin area', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/library' });
    await screen.findByText('ניהול');
    await userEvent.click(within(sidebar()).getByText('מחברים'));
    expect(await screen.findByRole('heading', { name: /מחברים/ })).toBeInTheDocument();
  });

  it('shows a reader only what their permissions open, and no section at all without any', async () => {
    server.use(withMe({ roles: ['lead'], permissions: ['docs.read', 'audit.read'] }));
    const { unmount } = renderWithProviders(<App />, { route: '/library' });
    await screen.findByText('ניהול');
    expect(within(sidebar()).getByText('יומן פעולות')).toBeInTheDocument();
    expect(within(sidebar()).queryByText('משתמשים')).not.toBeInTheDocument();
    expect(within(sidebar()).queryByText('תור סנכרון')).not.toBeInTheDocument();
    unmount();

    server.use(withMe({ roles: ['agent'], permissions: ['docs.read'] }));
    renderWithProviders(<App />, { route: '/library' });
    await screen.findAllByText('ספריית ידע');
    expect(screen.queryByText('ניהול')).not.toBeInTheDocument();
  });
});

describe('palette · operator actions', () => {
  it('offers the admin and sync destinations, gated on the same permissions as the routes', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/library' });
    await screen.findAllByText('ספריית ידע');
    await userEvent.click(screen.getByLabelText('חיפוש בכל המקורות'));

    const input = await screen.findByPlaceholderText(/חפש מסמך, שלב/);
    await userEvent.type(input, 'תור סנכרון');
    await userEvent.click(await screen.findByText('תור סנכרון – מה ממתין לייבוא או לדחיפה'));
    expect(await screen.findByText('דו״ח התאמה')).toBeInTheDocument();
  });

  it('hides an action whose route the user could not open', async () => {
    server.use(withMe({ roles: ['agent'], permissions: ['docs.read'] }));
    renderWithProviders(<App />, { route: '/library' });
    await screen.findAllByText('ספריית ידע');
    await userEvent.click(screen.getByLabelText('חיפוש בכל המקורות'));

    await userEvent.type(await screen.findByPlaceholderText(/חפש מסמך, שלב/), 'מחברים');
    expect(screen.queryByText('מחברים – הגדרה, בדיקה והרצה')).not.toBeInTheDocument();
  });
});
