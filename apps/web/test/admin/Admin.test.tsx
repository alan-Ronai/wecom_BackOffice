import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PERMISSIONS } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';

const asAdmin = () => server.use(withMe({ roles: ['admin'], permissions: [...PERMISSIONS] }));

describe('admin', () => {
  it('blocks non-admins', async () => {
    renderWithProviders(<App />, { route: '/admin/users' });
    expect(await screen.findByText('אין הרשאה לאזור הניהול')).toBeInTheDocument();
  });

  it('shows the permission matrix to admins and locks the admin role', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/roles' });
    expect(await screen.findByText('docs.publish')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('columnheader').length).toBeGreaterThan(1));
    expect(screen.getByLabelText('roles.manage · admin')).toBeDisabled();
    expect(screen.getByLabelText('docs.publish · admin')).toBeEnabled();
  });

  it('lists users with their roles and scope', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/users' });
    expect(await screen.findByText('ענבר ל.')).toBeInTheDocument();
    expect(await screen.findByText(/טיפול בשיחה/)).toBeInTheDocument();
  });

  it('renders system status', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/system' });
    expect(await screen.findByText(/מסד נתונים/)).toBeInTheDocument();
    expect(screen.getByText(/מודל/)).toBeInTheDocument();
    expect(await screen.findByText('kb-2025-06-12.dump')).toBeInTheDocument();
  });

  it('shows the audit log with a before/after diff', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/audit' });
    expect(await screen.findByText('docs.publish')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'לפני / אחרי' }));
    expect(await screen.findByText('לפני')).toBeInTheDocument();
  });

  it('lists sessions and group mappings', async () => {
    asAdmin();
    const { unmount } = renderWithProviders(<App />, { route: '/admin/sessions' });
    expect(await screen.findByText('Chrome/128')).toBeInTheDocument();
    unmount();
    renderWithProviders(<App />, { route: '/admin/groups' });
    await waitFor(() => expect(screen.getByLabelText('שם קבוצה 1')).toHaveValue('KB-Leads'));
  });
});
