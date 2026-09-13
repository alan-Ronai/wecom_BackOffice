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
  it('redirects unauthenticated users to /login with the providers and a next param', async () => {
    unauthenticated();
    renderWithProviders(<App />, { route: '/library/intl' });
    const link = await screen.findByRole('link', { name: 'כניסה עם חשבון wecom' });
    expect(link).toHaveAttribute('href', '/api/v1/auth/login?next=%2Flibrary%2Fintl');
  });

  it('offers the local break-glass form', async () => {
    unauthenticated();
    renderWithProviders(<App />, { route: '/library' });
    expect(await screen.findByLabelText('שם משתמש')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('שם משתמש'), 'admin');
    await userEvent.type(screen.getByLabelText('סיסמה'), 'secret');
    expect(screen.getByRole('button', { name: 'כניסה מקומית' })).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText('ספריית ידע')).toBeInTheDocument());
  });
});
