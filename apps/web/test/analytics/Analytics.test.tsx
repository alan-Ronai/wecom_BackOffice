import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PERMISSIONS } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { asDenied, withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';

const asLead = () => server.use(withMe({ roles: ['lead'], permissions: [...PERMISSIONS] }));
const asAnalystOnly = () =>
  server.use(withMe({ roles: ['analyst'], permissions: ['docs.read', 'analytics.read'] }));

describe('analytics page', () => {
  it('renders the four cards from /analytics/usage', async () => {
    asLead();
    renderWithProviders(<App />, { route: '/analytics' });
    expect(await screen.findByRole('heading', { name: /נתוני שימוש/ })).toBeInTheDocument();
    expect(await screen.findAllByText('גלישה איטית / חוסר גלישה')).not.toHaveLength(0); // item views + staleness
    expect(screen.getByText('הפעלת eSIM')).toBeInTheDocument(); // topic views
    expect(screen.getByText('zzz-none')).toBeInTheDocument(); // zero-result term
    expect(screen.getByText(/ימים ללא עדכון/)).toBeInTheDocument(); // staleness column header
  });

  it('offers "צור פריט" on zero-result terms only with docs.create', async () => {
    asLead();
    renderWithProviders(<App />, { route: '/analytics' });
    const btn = await screen.findByRole('button', { name: 'צור פריט' });
    await userEvent.click(btn);
    // Landed on /edit/new — the editor's title field is the stable marker there.
    expect(await screen.findByLabelText('שם פריט הידע')).toBeInTheDocument();
  });

  it('hides the shortcut without docs.create', async () => {
    asAnalystOnly();
    renderWithProviders(<App />, { route: '/analytics' });
    expect(await screen.findByText('zzz-none')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'צור פריט' })).not.toBeInTheDocument();
  });

  it('puts the world filter in the URL and refetches', async () => {
    asLead();
    renderWithProviders(<App />, { route: '/analytics' });
    await screen.findByText('zzz-none');
    await userEvent.selectOptions(screen.getByLabelText('עולם תוכן'), 'billing');
    expect(await screen.findByText(/מסונן: billing/)).toBeInTheDocument();
    // The filtered answer drops the item tables (staleness stays), so the refetch really happened.
    expect(screen.queryByRole('link', { name: 'גלישה איטית / חוסר גלישה' })).not.toBeInTheDocument();
  });

  it('shows a clear message on 403', async () => {
    asLead();
    server.use(asDenied('get', '/analytics/usage'));
    renderWithProviders(<App />, { route: '/analytics' });
    expect(await screen.findByText('אין הרשאה לצפות בנתוני שימוש')).toBeInTheDocument();
  });
});
