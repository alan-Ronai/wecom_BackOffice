import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';

const unauthenticated = () =>
  server.use(
    http.get('/api/v1/auth/me', () =>
      HttpResponse.json({ code: 'UNAUTHENTICATED', message: 'לא מחובר' }, { status: 401 }),
    ),
  );

describe('auth', () => {
  it('redirects unauthenticated users to /login with the SSO link and a returnTo param', async () => {
    unauthenticated();
    renderWithProviders(<App />, { route: '/library/intl' });
    const link = await screen.findByRole('link', { name: 'כניסה עם חשבון Microsoft' });
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
    expect(await screen.findByLabelText('דוא״ל')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('דוא״ל'), 'admin@wecom.co.il');
    await userEvent.type(screen.getByLabelText('סיסמה'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'כניסה מקומית' }));
    await waitFor(() => expect(body).toEqual({ email: 'admin@wecom.co.il', password: 'secret' }));
  });

  it('renders the Palo Alto hint when the server reports that fallback', async () => {
    unauthenticated();
    server.use(
      http.get('/api/v1/auth/providers', () =>
        HttpResponse.json({ providers: ['entra'], fallback: 'paloalto' }),
      ),
    );
    renderWithProviders(<App />, { route: '/library' });
    expect(await screen.findByText(/הזדהו מול השער הארגוני/)).toBeInTheDocument();
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
