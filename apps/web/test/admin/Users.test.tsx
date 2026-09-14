import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { PERMISSIONS } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { ROLE_LEAD } from '../msw/fixtures.js';

const asAdmin = () => server.use(withMe({ roles: ['admin'], permissions: [...PERMISSIONS] }));

/** The querystring of every `GET /admin/users` the page makes, in order. */
function recordQueries(): URLSearchParams[] {
  const seen: URLSearchParams[] = [];
  server.events.on('request:start', ({ request }) => {
    const u = new URL(request.url);
    if (u.pathname === '/api/v1/admin/users' && request.method === 'GET') seen.push(u.searchParams);
  });
  return seen;
}

/**
 * Scoped to the table on purpose: the shell's sidebar renders the signed-in user's name too, and
 * it renders instantly, so an unscoped `findByText` resolves against the sidebar before the list
 * has even arrived.
 */
const table = () => screen.findByRole('table');
const row = async (name: string) =>
  (await within(await table()).findByText(name)).closest('tr') as HTMLElement;

describe('admin · users', () => {
  it('shows source, scope, groups, session count and last login', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/users' });

    const inbar = await row('ענבר ל.');
    expect(within(inbar).getByText('Entra')).toBeInTheDocument();
    expect(within(inbar).getByText('כל הקטגוריות')).toBeInTheDocument();
    expect(within(inbar).getByText('KB-Editors, IT-Admins')).toBeInTheDocument();
    expect(within(inbar).getByText('2')).toBeInTheDocument();

    // A scoped grant renders the category, not "all".
    const dana = await row('דנה ר.');
    expect(within(dana).getByText('חו"ל ונדידה')).toBeInTheDocument();

    // A local account that has never signed in must not render a blank cell.
    const omer = await row('עומר ל.');
    expect(within(omer).getByText('מקומי')).toBeInTheDocument();
    expect(within(omer).getByText('מעולם לא')).toBeInTheDocument();
    expect(within(omer).getByText('ללא תפקיד')).toBeInTheDocument();
  });

  it('sends q, source and role to the server rather than filtering in the browser', async () => {
    asAdmin();
    const queries = recordQueries();
    renderWithProviders(<App />, { route: '/admin/users' });
    await row('ענבר ל.');

    await userEvent.click(screen.getByRole('tab', { name: 'GlobalProtect' }));
    await waitFor(() => expect(queries.at(-1)?.get('source')).toBe('paloalto'));
    await row('מאיה כ.');
    expect(within(await table()).queryByText('ענבר ל.')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'לא פעילים' }));
    await waitFor(() => expect(queries.at(-1)?.get('active')).toBe('false'));
    await row('עומר ל.');

    await userEvent.click(screen.getByRole('tab', { name: 'הכל' }));
    await userEvent.type(screen.getByLabelText('חיפוש משתמש'), 'דנה');
    await waitFor(() => expect(queries.at(-1)?.get('q')).toBe('דנה'));

    await userEvent.selectOptions(screen.getByLabelText('סינון לפי תפקיד'), ROLE_LEAD);
    await waitFor(() => expect(queries.at(-1)?.get('role')).toBe(ROLE_LEAD));
  });

  it('edits a role with a multi-category scope in one PATCH', async () => {
    asAdmin();
    let body: unknown;
    server.use(
      http.patch('/api/v1/admin/users/:id', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true, auditId: 'a' });
      }),
    );
    renderWithProviders(<App />, { route: '/admin/users' });
    await userEvent.click(await screen.findByLabelText('ערוך תפקיד של ענבר ל.'));

    await userEvent.click(screen.getByLabelText('כל הקטגוריות'));
    await userEvent.click(screen.getByLabelText('חו"ל ונדידה'));
    await userEvent.click(screen.getByLabelText('תמיכה טכנית'));
    await userEvent.click(screen.getByRole('button', { name: 'שמור תפקיד' }));

    // Both categories survive — the old single-select collapsed a two-category grant to one.
    await waitFor(() =>
      expect(body).toEqual({ roles: [{ roleId: ROLE_LEAD, categoryScope: ['intl', 'tech'] }] }),
    );
    expect(await screen.findByText('התפקיד עודכן')).toBeInTheDocument();
  });

  it('deactivates an account', async () => {
    asAdmin();
    let body: unknown;
    server.use(
      http.patch('/api/v1/admin/users/:id', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true, auditId: 'a' });
      }),
    );
    renderWithProviders(<App />, { route: '/admin/users' });
    await userEvent.click(await screen.findByLabelText('פעיל: דנה ר.'));
    await waitFor(() => expect(body).toEqual({ active: false }));
    expect(await screen.findByText('החשבון הושבת')).toBeInTheDocument();
  });

  it('offers an undo on a deactivation, and the undo puts it back (3b)', async () => {
    asAdmin();
    const bodies: unknown[] = [];
    server.use(
      http.patch('/api/v1/admin/users/:id', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ok: true, auditId: 'a' });
      }),
    );
    renderWithProviders(<App />, { route: '/admin/users' });
    await userEvent.click(await screen.findByLabelText('פעיל: דנה ר.'));

    // Deactivating is one click from locking somebody out mid-shift; the toast is the pause.
    await screen.findByText('החשבון הושבת');
    await userEvent.click(screen.getByRole('button', { name: 'בטל' }));

    await waitFor(() => expect(bodies).toEqual([{ active: false }, { active: true }]));
    expect(await screen.findByText('ההשבתה בוטלה')).toBeInTheDocument();
  });

  it('assigns one role across a selection in one pass (3b)', async () => {
    asAdmin();
    const patched: { id: string; body: { roles?: unknown } }[] = [];
    server.use(
      http.patch('/api/v1/admin/users/:id', async ({ params, request }) => {
        patched.push({ id: String(params.id), body: (await request.json()) as { roles?: unknown } });
        return HttpResponse.json({ ok: true, auditId: 'a' });
      }),
    );
    renderWithProviders(<App />, { route: '/admin/users' });

    await userEvent.click(await screen.findByLabelText('בחר את ענבר ל.'));
    await userEvent.click(screen.getByLabelText('בחר את דנה ר.'));
    expect(screen.getByText('2 נבחרו')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'הקצה תפקיד' }));
    const roleSelect = await screen.findByLabelText('תפקיד');
    // Options carry role ids as values, so select by the label the operator actually reads.
    await userEvent.selectOptions(roleSelect, within(roleSelect).getByRole('option', { name: 'admin' }));
    await userEvent.click(screen.getByRole('button', { name: 'שמור תפקיד' }));

    await waitFor(() => expect(patched).toHaveLength(2));
    expect(patched.every((p) => Array.isArray(p.body.roles))).toBe(true);
    expect(await screen.findByText('התפקיד הוקצה ל-שני משתמשים')).toBeInTheDocument();
    // The selection is spent, so a second click on the same button cannot repeat it by accident.
    expect(screen.queryByText('2 נבחרו')).not.toBeInTheDocument();
  });

  it('drops the selection when the filter changes, so a bulk action cannot reach a hidden row', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/users' });
    await userEvent.click(await screen.findByLabelText('בחר את ענבר ל.'));
    expect(screen.getByText('1 נבחרו')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'מקומי' }));
    expect(screen.queryByText(/נבחרו/)).not.toBeInTheDocument();
  });

  it('creates a local account and refuses a password the route would reject', async () => {
    asAdmin();
    let body: unknown;
    server.use(
      http.post('/api/v1/admin/users', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    renderWithProviders(<App />, { route: '/admin/users' });
    await userEvent.click(await screen.findByRole('button', { name: '✚ משתמש מקומי' }));

    await userEvent.type(screen.getByLabelText('דוא״ל'), 'svc@wecom.co.il');
    await userEvent.type(screen.getByLabelText('סיסמה'), 'short');
    expect(screen.getByText('לפחות 12 תווים')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'צור חשבון' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('סיסמה'), 'but-now-long-enough');
    await userEvent.type(screen.getByLabelText('שם לתצוגה'), 'חשבון שירות');
    await userEvent.click(screen.getByRole('button', { name: 'צור חשבון' }));

    await waitFor(() => expect(body).toMatchObject({ email: 'svc@wecom.co.il', displayName: 'חשבון שירות' }));
    expect(await screen.findByText('החשבון נוצר')).toBeInTheDocument();
  });

  it('hides every write control from a reader', async () => {
    server.use(withMe({ roles: ['lead'], permissions: ['docs.read', 'audit.read'] }));
    renderWithProviders(<App />, { route: '/admin/users' });
    await row('ענבר ל.');
    expect(screen.queryByRole('button', { name: '✚ משתמש מקומי' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('ערוך תפקיד של ענבר ל.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('פעיל: ענבר ל.')).toBeDisabled();
  });
});
