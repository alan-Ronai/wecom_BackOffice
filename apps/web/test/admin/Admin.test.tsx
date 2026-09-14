import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { PERMISSIONS } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { asDenied, withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';

const asAdmin = () => server.use(withMe({ roles: ['admin'], permissions: [...PERMISSIONS] }));

describe('admin', () => {
  it('blocks non-admins', async () => {
    // The demo persona is an administrator, so this needs an explicitly narrower user.
    server.use(withMe({ roles: ['agent'], permissions: ['docs.read', 'notes.write'] }));
    renderWithProviders(<App />, { route: '/admin/users' });
    expect(await screen.findByText('אין הרשאה לאזור הניהול')).toBeInTheDocument();
  });

  // The users and roles screens have their own suites — `test/admin/Users.test.tsx` and
  // `test/admin/Roles.test.tsx`.

  it('renders the operator diagnostics from /admin/system', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/system' });
    expect(await screen.findByText(/מסד נתונים/)).toBeInTheDocument();
    expect(screen.getByText(/תור עבודות/)).toBeInTheDocument();
    // Fields that only exist on the real AdminSystemSchema payload.
    expect(await screen.findByText('kb-2026-09-12.dump')).toBeInTheDocument();
    expect(screen.getByText('qwen2.5:3b-instruct-q4_K_M')).toBeInTheDocument();
    expect(screen.getByText('wecom-wordpress')).toBeInTheDocument();
    expect(screen.getByText(/גרסה 0.1.0/)).toBeInTheDocument();
  });

  it('surfaces a 403 on /admin/system instead of blank rows', async () => {
    asAdmin();
    server.use(asDenied('get', '/admin/system'));
    renderWithProviders(<App />, { route: '/admin/system' });
    expect(await screen.findByText('לא ניתן לטעון מצב מערכת')).toBeInTheDocument();
  });

  // The audit explorer, sessions and group mappings have their own suites —
  // `test/admin/Audit.test.tsx` and `test/admin/GroupsSessions.test.tsx`.
});
