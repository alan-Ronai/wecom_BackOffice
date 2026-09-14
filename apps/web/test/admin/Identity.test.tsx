import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { PERMISSIONS } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { asDenied, withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';

const asAdmin = () => server.use(withMe({ roles: ['admin'], permissions: [...PERMISSIONS] }));

const capturePut = () => {
  const seen: unknown[] = [];
  server.use(
    http.put('/api/v1/admin/identity', async ({ request }) => {
      const body = await request.json();
      seen.push(body);
      return HttpResponse.json({
        oidc: {
          enabled: true,
          issuer: 'https://x',
          clientId: 'c',
          hasSecret: true,
          redirectUri: 'https://y',
          groupsClaim: true,
        },
        paloalto: { enabled: true, host: 'h', hasApiKey: true, subnets: [] },
        local: { breakGlassEnabled: true },
        sessionHours: 8,
      });
    }),
  );
  return seen;
};

describe('admin · identity', () => {
  it('shows that a secret exists without ever rendering it', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/identity' });
    expect(await screen.findByLabelText('Issuer')).toHaveValue(
      'https://login.microsoftonline.com/wecom/v2.0',
    );
    // The settings carry `hasSecret`, never the secret; the field says so and offers a replacement.
    expect(screen.getAllByText('מוגדר')).toHaveLength(2);
    expect(screen.queryByLabelText('Client secret')).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'החלף' })[0]);
    expect(screen.getByLabelText('Client secret')).toHaveValue('');
  });

  it('omits untouched secrets from the PUT so an unrelated save cannot wipe them', async () => {
    asAdmin();
    const puts = capturePut();
    renderWithProviders(<App />, { route: '/admin/identity' });
    const hours = await screen.findByLabelText('אורך מושב (שעות)');
    await userEvent.clear(hours);
    await userEvent.type(hours, '12');
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    const body = puts[0] as { sessionHours: number; oidc: Record<string, unknown> };
    expect(body.sessionHours).toBe(12);
    expect(body.oidc).not.toHaveProperty('clientSecret');
    expect(await screen.findByText('ההגדרות נשמרו')).toBeInTheDocument();
  });

  it('sends a replaced secret exactly once, when it was typed', async () => {
    asAdmin();
    const puts = capturePut();
    renderWithProviders(<App />, { route: '/admin/identity' });
    await userEvent.click((await screen.findAllByRole('button', { name: 'החלף' }))[0]);
    await userEvent.type(screen.getByLabelText('Client secret'), 'brand-new-secret');
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect((puts[0] as { oidc: { clientSecret: string } }).oidc.clientSecret).toBe('brand-new-secret');
  });

  it('refuses a session length the schema would reject rather than losing the whole form', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/identity' });
    const hours = await screen.findByLabelText('אורך מושב (שעות)');
    await userEvent.clear(hours);
    await userEvent.type(hours, '200');
    expect(screen.getByText('בין שעה אחת ל-72 שעות')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'שמור' })).toBeDisabled();
  });

  it('reports each provider test on its own terms', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/identity' });
    const [oidcTest, paTest] = await screen.findAllByRole('button', { name: 'בדוק חיבור' });

    await userEvent.click(oidcTest);
    expect(await screen.findByText(/גילוי OIDC הצליח/)).toBeInTheDocument();

    // A failing gateway must not read as a success just because the request itself returned 200.
    await userEvent.click(paTest);
    expect(await screen.findByText(/השער לא השיב/)).toBeInTheDocument();
  });

  it('offers a real end-to-end sign-in that returns to this screen', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/identity' });
    expect(await screen.findByRole('link', { name: 'כניסת בדיקה' })).toHaveAttribute(
      'href',
      'http://kb.test/api/v1/auth/login?returnTo=%2Fadmin%2Fidentity',
    );
  });

  it('surfaces a 403 instead of an empty form', async () => {
    asAdmin();
    server.use(asDenied('get', '/admin/identity'));
    renderWithProviders(<App />, { route: '/admin/identity' });
    expect(await screen.findByText('לא ניתן לטעון הגדרות הזהות')).toBeInTheDocument();
  });

  it('keeps the screen out of the nav for anyone without system.admin', async () => {
    server.use(withMe({ roles: ['lead'], permissions: ['docs.read', 'audit.read'] }));
    renderWithProviders(<App />, { route: '/admin/audit' });
    await screen.findByRole('link', { name: 'יומן פעולות' });
    expect(screen.queryByRole('link', { name: 'זהות וכניסה' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'משתמשים' })).not.toBeInTheDocument();
  });
});
