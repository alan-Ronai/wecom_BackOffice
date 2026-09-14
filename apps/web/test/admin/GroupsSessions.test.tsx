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

    await userEvent.type(screen.getByLabelText('מזהה קבוצה 3'), 'g-admins');
    await userEvent.type(screen.getByLabelText('שם קבוצה 3'), 'IT-Admins');
    await userEvent.selectOptions(screen.getByLabelText('תפקיד לקבוצה 3'), ROLE_ADMIN);
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }));

    await waitFor(() =>
      expect(saved).toEqual({
        entries: [
          { idpGroupId: 'g-leads', idpGroupName: 'KB-Leads', roleId: expect.any(String) },
          { idpGroupId: 'g-new', idpGroupName: 'KB-New', roleId: expect.any(String) },
          { idpGroupId: 'g-admins', idpGroupName: 'IT-Admins', roleId: ROLE_ADMIN },
        ],
      }),
    );
    expect(await screen.findByText('המיפוי נשמר')).toBeInTheDocument();
  });

  it('sends the mapping fields only — never the job’s own sync bookkeeping', async () => {
    asAdmin();
    let saved: { entries: Record<string, unknown>[] } | undefined;
    server.use(
      http.put('/api/v1/admin/groups-map', async ({ request }) => {
        saved = (await request.json()) as typeof saved;
        return HttpResponse.json({ ok: true, auditId: 'a' });
      }),
    );
    renderWithProviders(<App />, { route: '/admin/groups' });
    await waitFor(() => expect(screen.getByLabelText('שם קבוצה 1')).toHaveValue('KB-Leads'));
    await userEvent.type(screen.getByLabelText('שם קבוצה 1'), ' ');
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }));

    // `lastSyncedAt` rides along on the read shape. Echoing it back would be the client asserting
    // a sync time it never observed — and the PUT body has no field for it.
    await waitFor(() => expect(saved).toBeDefined());
    expect(Object.keys(saved!.entries[0]).sort()).toEqual(['idpGroupId', 'idpGroupName', 'roleId']);
  });

  it('shows how many users each mapped role already reaches, and removes a row', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/groups' });
    const row = (await screen.findByLabelText('שם קבוצה 1')).closest('tr') as HTMLElement;
    // From the role matrix: the lead role has 12 users today.
    expect(within(row).getByText('12')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('הסר מיפוי 1'));
    await userEvent.click(screen.getByLabelText('הסר מיפוי 1'));
    expect(await screen.findByText('אין מיפויים')).toBeInTheDocument();
  });

  it('tells "synced an hour ago" apart from "saved since the last run" (3d)', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/groups' });
    const synced = (await screen.findByLabelText('שם קבוצה 1')).closest('tr') as HTMLElement;
    const pending = (screen.getByLabelText('שם קבוצה 2') as HTMLElement).closest('tr') as HTMLElement;
    // A mapping the nightly job has reconciled, and one added since — the second is not broken,
    // it simply takes effect tonight, and the screen has to say which is which.
    expect(within(synced).queryByText('טרם סונכרן')).not.toBeInTheDocument();
    expect(within(pending).getByText('טרם סונכרן')).toBeInTheDocument();
  });
});

describe('admin · Entra group search (3d)', () => {
  const search = async () => screen.findByLabelText('חפש קבוצה ב-Entra');

  it('fills a row from the directory instead of asking for a pasted object id', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/groups' });
    await userEvent.type(await search(), 'KB-Ed');
    // The GUID is the whole point: it is what nobody knows and what a typo silently breaks.
    await userEvent.click(await screen.findByRole('option', { name: /KB-Editors/ }));

    await waitFor(() => expect(screen.getByLabelText('מזהה קבוצה 3')).toHaveValue('g-editors'));
    expect(screen.getByLabelText('שם קבוצה 3')).toHaveValue('KB-Editors');
    // Only the role is left to choose, so the row is still incomplete and still unsaveable.
    expect(screen.getByRole('button', { name: 'שמור' })).toBeDisabled();
  });

  it('reuses a blank row rather than leaving one above the picked group', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/groups' });
    await screen.findByLabelText('שם קבוצה 1');
    await userEvent.click(screen.getByRole('button', { name: '✚ הוסף מיפוי' }));
    await userEvent.type(await search(), 'Support');
    await userEvent.click(await screen.findByRole('option', { name: /Support-L2/ }));

    await waitFor(() => expect(screen.getByLabelText('מזהה קבוצה 3')).toHaveValue('g-support'));
    expect(screen.queryByLabelText('מזהה קבוצה 4')).not.toBeInTheDocument();
  });

  it('will not offer a group that is already mapped', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/groups' });
    await userEvent.type(await search(), 'KB-N');
    const option = await screen.findByRole('option', { name: /KB-New/ });
    expect(option).toBeDisabled();
    expect(within(option).getByText('כבר ממופה')).toBeInTheDocument();
  });

  it('points at the identity screen when no issuer is configured, rather than shrugging', async () => {
    asAdmin();
    server.use(
      http.get('/api/v1/admin/groups/search', () =>
        HttpResponse.json({ code: 'OIDC_NOT_CONFIGURED', message: 'לא מוגדר' }, { status: 503 }),
      ),
    );
    renderWithProviders(<App />, { route: '/admin/groups' });
    await userEvent.type(await search(), 'KB');
    expect(await screen.findByText(/הגדירו אותו במסך הזהויות/)).toBeInTheDocument();
  });

  it('says a Graph outage is an outage and leaves the manual id field usable', async () => {
    asAdmin();
    server.use(
      http.get('/api/v1/admin/groups/search', () =>
        HttpResponse.json({ code: 'GRAPH_UNAVAILABLE', message: 'נכשל' }, { status: 502 }),
      ),
    );
    renderWithProviders(<App />, { route: '/admin/groups' });
    await userEvent.type(await search(), 'KB');
    expect(await screen.findByText(/אפשר להזין מזהה קבוצה ידנית/)).toBeInTheDocument();
    expect(screen.getByLabelText('מזהה קבוצה 1')).toBeEnabled();
  });

  it('is hidden from a viewer who cannot edit the map', async () => {
    // `audit.read` opens the admin console without `roles.manage`, which is the shape of a real
    // read-only auditor account — the search fills a field they may not change.
    server.use(withMe({ roles: ['lead'], permissions: ['docs.read', 'audit.read'] }));
    renderWithProviders(<App />, { route: '/admin/groups' });
    await screen.findByRole('table');
    expect(screen.queryByLabelText('חפש קבוצה ב-Entra')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '✚ הוסף מיפוי' })).not.toBeInTheDocument();
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
    await userEvent.click(await screen.findByLabelText('נתק דנה ר.'));
    expect(await screen.findByText(/יידרש להיכנס מחדש/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'נתק' }));
    await waitFor(() => expect(revoked).toBe('cccccccc-cccc-4ccc-8ccc-ccccccccccc2'));
    expect(await screen.findByText('החיבור נותק')).toBeInTheDocument();
  });

  it('marks this browser as "מכשיר זה" and warns before revoking it (3e)', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/sessions' });
    expect(await screen.findByText('מכשיר זה')).toBeInTheDocument();

    // Revoking your own session is a different sentence from revoking someone else's: you do not
    // "sign in again on that device", you are signed out here and now.
    await userEvent.click(screen.getByLabelText('נתק ענבר ל. (מכשיר זה)'));
    expect(await screen.findByText(/זהו החיבור הנוכחי/)).toBeInTheDocument();
  });

  it('disconnects every other session but never the current one (3e)', async () => {
    asAdmin();
    const revoked: string[] = [];
    server.use(
      http.delete('/api/v1/admin/sessions/:id', ({ params }) => {
        revoked.push(String(params.id));
        return HttpResponse.json({ ok: true, auditId: 'a' });
      }),
    );
    renderWithProviders(<App />, { route: '/admin/sessions' });
    await userEvent.click(await screen.findByRole('button', { name: 'נתק את כל האחרים' }));
    expect(await screen.findByText(/החיבור הנוכחי יישאר פעיל/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'נתק את כולם' }));

    await waitFor(() => expect(revoked).toEqual(['cccccccc-cccc-4ccc-8ccc-ccccccccccc2']));
    expect(await screen.findByText('כל שאר החיבורים נותקו')).toBeInTheDocument();
  });

  it('hides revoke from someone without users.manage', async () => {
    server.use(withMe({ roles: ['lead'], permissions: ['docs.read', 'audit.read'] }));
    renderWithProviders(<App />, { route: '/admin/sessions' });
    await screen.findByRole('table');
    expect(screen.queryByLabelText(/^נתק /)).not.toBeInTheDocument();
  });
});
