import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
    // Two cells, one role, one save — not two round trips and two audit entries.
    const dirtySave = await screen.findByRole('button', { name: 'שמור (1 שינויים)' });
    await userEvent.click(dirtySave);

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].id).toBe(ROLE_LEAD);
    const perms = (patched[0].body as { permissions: string[] }).permissions;
    expect(perms).toContain('audit.read');
    expect(perms).not.toContain('docs.publish');
    expect(await screen.findByText('נשמרו 1 תפקידים')).toBeInTheDocument();
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
