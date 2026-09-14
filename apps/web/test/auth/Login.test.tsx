import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { fx } from '../msw/fixtures.js';

const unauthenticated = () =>
  server.use(
    http.get('/api/v1/auth/me', () =>
      HttpResponse.json({ code: 'UNAUTHENTICATED', message: 'לא מחובר' }, { status: 401 }),
    ),
  );

const withProviders = (providers: string[], fallback = 'none') =>
  server.use(http.get('/api/v1/auth/providers', () => HttpResponse.json({ providers, fallback })));

/** Opens the break-glass disclosure, which is folded away whenever SSO is on offer. */
const openBreakGlass = async () =>
  userEvent.click(await screen.findByRole('button', { name: 'כניסה מקומית (מנהל מערכת בלבד)' }));

describe('auth', () => {
  it('redirects unauthenticated users to /login with the SSO link and a returnTo param', async () => {
    unauthenticated();
    renderWithProviders(<App />, { route: '/library/intl' });
    const link = await screen.findByRole('link', { name: 'כניסה עם חשבון Microsoft של wecom' });
    // The route's querystring is `returnTo`, not `next`.
    expect(link).toHaveAttribute('href', 'http://kb.test/api/v1/auth/login?returnTo=%2Flibrary%2Fintl');
  });

  it('offers the local break-glass form and posts `email`, not `username`', async () => {
    unauthenticated();
    let body: unknown;
    server.use(
      http.post('/api/v1/auth/local', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    renderWithProviders(<App />, { route: '/library' });
    await openBreakGlass();
    await userEvent.type(screen.getByLabelText('דוא״ל'), 'admin@wecom.co.il');
    await userEvent.type(screen.getByLabelText('סיסמה'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'כניסה' }));
    await waitFor(() => expect(body).toEqual({ email: 'admin@wecom.co.il', password: 'secret' }));
  });

  it('shows the break-glass form unfolded when it is the only way in', async () => {
    unauthenticated();
    withProviders(['local']);
    renderWithProviders(<App />, { route: '/library' });
    expect(await screen.findByLabelText('דוא״ל')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Microsoft/ })).not.toBeInTheDocument();
  });

  it('tells bad credentials apart from a throttled account', async () => {
    unauthenticated();
    server.use(
      http.post('/api/v1/auth/local', () =>
        HttpResponse.json({ code: 'UNAUTHENTICATED', message: 'no' }, { status: 401 }),
      ),
    );
    renderWithProviders(<App />, { route: '/library' });
    await openBreakGlass();
    await userEvent.type(screen.getByLabelText('דוא״ל'), 'admin@wecom.co.il');
    await userEvent.type(screen.getByLabelText('סיסמה'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'כניסה' }));
    expect(await screen.findByText('כתובת דוא״ל או סיסמה שגויים')).toBeInTheDocument();

    server.use(
      http.post('/api/v1/auth/local', () =>
        HttpResponse.json({ code: 'RATE_LIMITED', message: 'slow down' }, { status: 429 }),
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'כניסה' }));
    expect(await screen.findByText('יותר מדי ניסיונות · נסו שוב בעוד דקה')).toBeInTheDocument();
  });

  it('says so when the server offers no way in at all', async () => {
    unauthenticated();
    withProviders([]);
    renderWithProviders(<App />, { route: '/library' });
    expect(await screen.findByText('לא הוגדרה שיטת כניסה בשרת')).toBeInTheDocument();
  });

  it('renders the Palo Alto hint when the gateway cannot name the caller', async () => {
    unauthenticated();
    withProviders(['entra'], 'paloalto');
    renderWithProviders(<App />, { route: '/library' });
    expect(await screen.findByText(/הזדהו מול השער הארגוני/)).toBeInTheDocument();
  });

  it('offers "המשך כ…" when GlobalProtect identifies the caller, and "לא אני" backs out of it', async () => {
    // `RequireAuth` 401s (no session cookie yet) while the gateway can still name the client, so
    // the login route re-probes `/auth/me` and gets a user back.
    let probes = 0;
    server.use(
      http.get('/api/v1/auth/me', () =>
        probes++ === 0
          ? HttpResponse.json({ code: 'UNAUTHENTICATED', message: 'לא מחובר' }, { status: 401 })
          : HttpResponse.json(fx.me),
      ),
    );
    withProviders(['entra', 'local'], 'paloalto');
    let loggedOut = false;
    server.use(
      http.post('/api/v1/auth/logout', () => {
        loggedOut = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    renderWithProviders(<App />, { route: '/library' });

    expect(await screen.findByText('זוהית אוטומטית דרך')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `המשך כ־${fx.me.user.displayName}` })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'לא אני' }));
    // Rejecting the identification discards the implicit session and falls back to the providers.
    await waitFor(() => expect(loggedOut).toBe(true));
    expect(screen.queryByText('זוהית אוטומטית דרך')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'כניסה עם חשבון Microsoft של wecom' })).toBeInTheDocument();
  });

  it('surfaces a server outage instead of the login page', async () => {
    server.use(
      http.get('/api/v1/auth/me', () =>
        HttpResponse.json({ code: 'INTERNAL', message: 'שגיאת שרת' }, { status: 500 }),
      ),
    );
    renderWithProviders(<App />, { route: '/library' });
    // useMe retries non-401 failures twice with backoff before surfacing the error.
    expect(await screen.findByText('השרת לא זמין', undefined, { timeout: 8000 })).toBeInTheDocument();
  });

  it('shows the app when authenticated', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await waitFor(() => expect(screen.getAllByText('ספריית ידע').length).toBeGreaterThan(0));
  });
});
