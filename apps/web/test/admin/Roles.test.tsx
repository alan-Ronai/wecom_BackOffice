import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { PERMISSIONS } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { asDenied, withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { ROLE_LEAD } from '../msw/fixtures.js';

const asAdmin = () => server.use(withMe({ roles: ['admin'], permissions: [...PERMISSIONS] }));

describe('admin · role matrix', () => {
  it('groups permissions by resource and shows how many users each role has', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/roles' });
    expect(await screen.findByText('docs.publish')).toBeInTheDocument();
    // The resource headers and the per-permission descriptions only exist on the matrix route.
    expect(screen.getAllByRole('columnheader', { name: 'מסמכים' }).length).toBe(1);
    expect(screen.getByText('פרסום גרסה')).toBeInTheDocument();
    expect(screen.getByText('12 משתמשים')).toBeInTheDocument();
  });

  it('locks the permissions the admin role may never lose', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/roles' });
    expect(await screen.findByLabelText('roles.manage · admin')).toBeDisabled();
    expect(screen.getByLabelText('users.manage · admin')).toBeDisabled();
    // Everything else on that column stays editable.
    expect(screen.getByLabelText('docs.publish · admin')).toBeEnabled();
  });

  it('stages several toggles and saves one PATCH per changed role', async () => {
    asAdmin();
    const patched: { id: string; body: unknown }[] = [];
    server.use(
      http.patch('/api/v1/admin/roles/:id', async ({ params, request }) => {
        patched.push({ id: String(params.id), body: await request.json() });
        return HttpResponse.json({ id: params.id, name: 'lead', system: true, permissions: [] });
      }),
    );
    renderWithProviders(<App />, { route: '/admin/roles' });

    const auditCell = await screen.findByLabelText('audit.read · lead');
    expect(screen.getByRole('button', { name: 'שמור' })).toBeDisabled();

    await userEvent.click(auditCell);
    await userEvent.click(screen.getByLabelText('docs.publish · lead'));
    // The count is cells, not roles: "how many requests will this make" is not the question an
    // operator is asking after five minutes of ticking. Still one save, though — two cells on one
    // role are one round trip and one audit entry.
    const dirtySave = await screen.findByRole('button', { name: 'שמור (2 שינויים)' });
    await userEvent.click(dirtySave);

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].id).toBe(ROLE_LEAD);
    const perms = (patched[0].body as { permissions: string[] }).permissions;
    expect(perms).toContain('audit.read');
    expect(perms).not.toContain('docs.publish');
    expect(await screen.findByText('נשמרו 1 תפקידים')).toBeInTheDocument();
  });

  it('dims a permission a role only has because the role under it does (3c)', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/roles' });

    // `lead ⊃ agent`, and `agent` holds docs.read — so lead's docs.read is inherited, not chosen.
    const leadRead = await screen.findByLabelText('docs.read · agent');
    expect(leadRead.closest('td')).not.toHaveClass('inherited');
    expect(screen.getByLabelText('docs.read · lead').closest('td')).toHaveClass('inherited');
    expect(screen.getByLabelText('docs.read · lead')).toHaveAttribute('title', 'בירושה מתפקיד agent');

    // docs.edit is lead's own — agent does not have it.
    expect(screen.getByLabelText('docs.edit · lead').closest('td')).not.toHaveClass('inherited');
    // The column header says what the role is built on.
    expect(screen.getByText('כולל את lead')).toBeInTheDocument();
    // A custom role is an ad-hoc set, not a rung, so it is never named as a base — even when its
    // permissions happen to be a subset of a system role's.
    expect(screen.queryByText('כולל את צוות חו"ל')).not.toBeInTheDocument();
  });

  it('says what changes before anything is written (3c)', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/roles' });

    await screen.findByLabelText('audit.read · lead');
    expect(screen.getByRole('button', { name: 'מה משתנה' })).toBeDisabled();
    await userEvent.click(screen.getByLabelText('audit.read · lead'));
    await userEvent.click(screen.getByLabelText('docs.publish · lead'));
    await userEvent.click(screen.getByRole('button', { name: 'מה משתנה' }));

    // By name: the onboarding tour is also a `role="dialog"` on a first visit.
    const dialog = await screen.findByRole('dialog', { name: 'מה משתנה' });
    // One line per cell, each saying which way it went and how many people it reaches.
    expect(within(dialog).getByText('audit.read')).toBeInTheDocument();
    expect(within(dialog).getByText('docs.publish')).toBeInTheDocument();
    expect(within(dialog).getAllByText('12 משתמשים')).toHaveLength(2);
  });

  it('offers delete for custom roles only, and names the blast radius', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/roles' });
    await screen.findByText('docs.publish');
    // Three system roles, one custom.
    expect(screen.getAllByText('מערכת')).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'מחק' }));
    expect(await screen.findByText(/יוסר מ-9 משתמשים/)).toBeInTheDocument();
  });

  it('surfaces a 403 rather than an empty matrix', async () => {
    asAdmin();
    server.use(asDenied('get', '/admin/roles/matrix'));
    renderWithProviders(<App />, { route: '/admin/roles' });
    expect(await screen.findByText('לא ניתן לטעון מטריצת ההרשאות')).toBeInTheDocument();
  });

  it('renders read-only for someone without roles.manage', async () => {
    server.use(withMe({ roles: ['lead'], permissions: ['docs.read', 'audit.read'] }));
    renderWithProviders(<App />, { route: '/admin/roles' });
    expect(await screen.findByLabelText('docs.publish · lead')).toBeDisabled();
    expect(screen.queryByRole('button', { name: '✚ תפקיד' })).not.toBeInTheDocument();
  });
});
