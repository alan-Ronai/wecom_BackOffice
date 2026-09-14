import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { PERMISSIONS } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { ROLE_ADMIN } from '../msw/fixtures.js';

const asAdmin = () => server.use(withMe({ roles: ['admin'], permissions: [...PERMISSIONS] }));

describe('admin · groups → roles', () => {
  it('will not save a half-filled mapping, and says why', async () => {
    asAdmin();
    let saved: unknown;
    server.use(
      http.put('/api/v1/admin/groups-map', async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({ ok: true, auditId: 'a' });
      }),
    );
    renderWithProviders(<App />, { route: '/admin/groups' });
    await waitFor(() => expect(screen.getByLabelText('שם קבוצה 1')).toHaveValue('KB-Leads'));

    // A clean map has nothing to save.
    expect(screen.getByRole('button', { name: 'שמור' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '✚ הוסף מיפוי' }));
    expect(screen.getByText('יש מיפוי בלי מזהה קבוצה או בלי תפקיד')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'שמור' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('מזהה קבוצה 2'), 'g-admins');
    await userEvent.type(screen.getByLabelText('שם קבוצה 2'), 'IT-Admins');
    await userEvent.selectOptions(screen.getByLabelText('תפקיד לקבוצה 2'), ROLE_ADMIN);
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }));

    await waitFor(() =>
      expect(saved).toEqual({
        entries: [
          { idpGroupId: 'g-leads', idpGroupName: 'KB-Leads', roleId: expect.any(String) },
          { idpGroupId: 'g-admins', idpGroupName: 'IT-Admins', roleId: ROLE_ADMIN },
        ],
      }),
    );
    expect(await screen.findByText('המיפוי נשמר')).toBeInTheDocument();
  });

  it('shows how many users each mapped role already reaches, and removes a row', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/groups' });
    const row = (await screen.findByLabelText('שם קבוצה 1')).closest('tr') as HTMLElement;
    // From the role matrix: the lead role has 12 users today.
    expect(within(row).getByText('12')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('הסר מיפוי 1'));
    expect(await screen.findByText('אין מיפויים')).toBeInTheDocument();
  });
});

describe('admin · sessions', () => {
  it('names the user and the device instead of printing uuids and user agents', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/sessions' });
    const table = await screen.findByRole('table');
    expect(await within(table).findByText('ענבר ל.')).toBeInTheDocument();
    expect(within(table).getByText(/Chrome · Windows/)).toBeInTheDocument();
    expect(within(table).getByText(/Safari · iOS/)).toBeInTheDocument();
    expect(within(table).getByText('10.20.4.17')).toBeInTheDocument();
    // The second fixture session is long past its expiry.
    expect(within(table).getByText('פג')).toBeInTheDocument();
  });

  it('confirms before revoking and reports it', async () => {
    asAdmin();
    let revoked: string | undefined;
    server.use(
      http.delete('/api/v1/admin/sessions/:id', ({ params }) => {
        revoked = String(params.id);
        return HttpResponse.json({ ok: true, auditId: 'a' });
      }),
    );
    renderWithProviders(<App />, { route: '/admin/sessions' });
    await userEvent.click(await screen.findByLabelText('נתק ענבר ל.'));
    expect(await screen.findByText(/יידרש להיכנס מחדש/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'נתק' }));
    await waitFor(() => expect(revoked).toBe('cccccccc-cccc-4ccc-8ccc-ccccccccccc1'));
    expect(await screen.findByText('החיבור נותק')).toBeInTheDocument();
  });

  it('hides revoke from someone without users.manage', async () => {
    server.use(withMe({ roles: ['lead'], permissions: ['docs.read', 'audit.read'] }));
    renderWithProviders(<App />, { route: '/admin/sessions' });
    await screen.findByRole('table');
    expect(screen.queryByLabelText(/^נתק /)).not.toBeInTheDocument();
  });
});
