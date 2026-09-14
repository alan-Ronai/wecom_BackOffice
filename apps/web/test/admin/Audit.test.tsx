import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PERMISSIONS } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { asDenied, withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { U2 } from '../msw/fixtures.js';

const asAdmin = () => server.use(withMe({ roles: ['admin'], permissions: [...PERMISSIONS] }));

function recordQueries(): URLSearchParams[] {
  const seen: URLSearchParams[] = [];
  server.events.on('request:start', ({ request }) => {
    const u = new URL(request.url);
    if (u.pathname === '/api/v1/admin/audit' && request.method === 'GET') seen.push(u.searchParams);
  });
  return seen;
}

describe('admin · audit explorer', () => {
  it('narrows on the server by entity, actor and range, and every filter is removable', async () => {
    asAdmin();
    const queries = recordQueries();
    renderWithProviders(<App />, { route: '/admin/audit' });
    await screen.findByText('docs.publish');

    // The default range is the last seven days, sent as an ISO `from`.
    await waitFor(() => expect(queries.at(-1)?.get('from')).toMatch(/^\d{4}-/));

    await userEvent.selectOptions(screen.getByLabelText('סוג ישות'), 'role');
    await waitFor(() => expect(queries.at(-1)?.get('entityType')).toBe('role'));

    await userEvent.selectOptions(screen.getByLabelText('מבצע הפעולה'), U2);
    await waitFor(() => expect(queries.at(-1)?.get('actorId')).toBe(U2));

    await userEvent.click(screen.getByRole('button', { name: 'הכל' }));
    await waitFor(() => expect(queries.at(-1)?.get('from')).toBe(null));

    // A narrowed-to-nothing list must be removable where the operator is looking.
    await userEvent.click(screen.getByRole('button', { name: /ישות: תפקיד/ }));
    await waitFor(() => expect(queries.at(-1)?.get('entityType')).toBe(null));
    await userEvent.click(screen.getByRole('button', { name: /משתמש: דנה ר./ }));
    await waitFor(() => expect(queries.at(-1)?.get('actorId')).toBe(null));
  });

  it('opens a drawer with computed before/after rows, not a JSON blob', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/audit' });
    await screen.findByText('docs.publish');
    await userEvent.click(screen.getAllByRole('button', { name: 'לפני / אחרי' })[0]);

    const drawer = await screen.findByRole('dialog', { name: 'פרטי רשומת ביקורת' });
    // One row per changed field, with both sides side by side.
    expect(within(drawer).getByText('currentVersion')).toBeInTheDocument();
    expect(within(drawer).getByText('draft')).toBeInTheDocument();
    expect(within(drawer).getByText('published')).toBeInTheDocument();
    // The request id is what ties a complaint to a log line.
    expect(within(drawer).getByText('req-1')).toBeInTheDocument();

    await userEvent.click(within(drawer).getByRole('button', { name: 'סגור' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'פרטי רשומת ביקורת' })).not.toBeInTheDocument(),
    );
  });

  it('surfaces a failed detail fetch inside the drawer rather than an empty panel', async () => {
    asAdmin();
    server.use(asDenied('get', '/admin/audit/:id'));
    renderWithProviders(<App />, { route: '/admin/audit' });
    await screen.findByText('docs.publish');
    await userEvent.click(screen.getAllByRole('button', { name: 'לפני / אחרי' })[0]);
    expect(await screen.findByText('לא ניתן לטעון פרטי הרשומה')).toBeInTheDocument();
  });

  it('says "no records in this range" instead of rendering an empty table', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/audit' });
    await userEvent.selectOptions(await screen.findByLabelText('סוג ישות'), 'connector');
    expect(await screen.findByText('אין רשומות בטווח הזה')).toBeInTheDocument();
  });
});
