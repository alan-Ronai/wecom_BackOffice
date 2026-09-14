import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { PERMISSIONS } from '@wecom/shared';
import { asDenied, withMe } from '../msw/handlers.js';
import { D_BROWSING } from '../msw/fixtures.js';
import { server } from '../msw/server.js';

/**
 * I15: every secondary query was coalesced with `?? []` and rendered as "empty" on failure, so a
 * 403 on `/blocks` (a user without `blocks.edit`) was indistinguishable from "no shared blocks
 * exist". On the pages where the query *is* the content, the failure is now surfaced.
 */
describe('a failed primary query is surfaced, not rendered as empty', () => {
  it('blocks', async () => {
    server.use(asDenied('get', '/blocks'));
    renderWithProviders(<App />, { route: '/blocks' });
    expect(await screen.findByText('לא ניתן לטעון בלוקים משותפים')).toBeInTheDocument();
  });

  it('CRM fields', async () => {
    server.use(asDenied('get', '/fields'));
    renderWithProviders(<App />, { route: '/fields' });
    expect(await screen.findByText('לא ניתן לטעון שדות CRM')).toBeInTheDocument();
  });

  it('sources', async () => {
    server.use(asDenied('get', '/sources'));
    renderWithProviders(<App />, { route: '/sources' });
    expect(await screen.findByText('לא ניתן לטעון מסמכי מקור')).toBeInTheDocument();
  });

  it('a category-scoped 403 on a document reads as "no permission", not "deleted"', async () => {
    server.use(asDenied('get', `/documents/${D_BROWSING}`));
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    expect(await screen.findByText('אין לך הרשאה למסמך הזה')).toBeInTheDocument();
  });

  it('the editor surfaces a scope denial instead of spinning forever', async () => {
    server.use(asDenied('get', `/documents/${D_BROWSING}`));
    renderWithProviders(<App />, { route: `/edit/${D_BROWSING}` });
    expect(await screen.findByText('אין לך הרשאה לערוך את המסמך הזה')).toBeInTheDocument();
  });

  it('admin roles', async () => {
    // The admin area is permission-gated; the point here is the *query* failure, not the guard.
    // The screen reads `/admin/roles/matrix` since stage 5 — that is the query that must speak up.
    server.use(
      withMe({ roles: ['admin'], permissions: [...PERMISSIONS] }),
      asDenied('get', '/admin/roles/matrix'),
    );
    renderWithProviders(<App />, { route: '/admin/roles' });
    expect(await screen.findByText('לא ניתן לטעון מטריצת ההרשאות')).toBeInTheDocument();
  });
});
