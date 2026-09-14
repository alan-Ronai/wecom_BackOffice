/**
 * W6 — every wave 4 component mounted into the shell, article, library and editor.
 *
 * One describe per mount task. These are the only tests that assert the *seam*: the lanes each
 * proved their own component in isolation, and this file proves it is reachable from the screen
 * the spec (§5) puts it on, with the permission gate the spec asks for.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { fx } from '../msw/fixtures.js';

const B = '/api/v1';
const side = async () => within(await screen.findByRole('complementary', { name: 'ניווט ראשי' }));

describe('W6 shell mounts', () => {
  it('lists worlds and their topics from the API instead of the hard-coded categories', async () => {
    server.use(
      http.get(`${B}/worlds`, () =>
        HttpResponse.json({
          items: [
            ...fx.worlds,
            {
              ...fx.worlds[0]!,
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000099',
              slug: 'field',
              name: 'שטח',
              itemCount: 4,
            },
          ],
        }),
      ),
    );
    renderWithProviders(<App />, { route: '/library' });
    const s = await side();
    // 'שטח' is not one of the six `CATS` labels, so finding it proves the list is API-driven.
    expect(await s.findByText('שטח')).toBeInTheDocument();
    await userEvent.click(s.getByText('תמיכה טכנית'));
    expect(await s.findByText('תקלות גלישה')).toBeInTheDocument();
  });

  it('shows feedback and analytics entries only with the permissions, with the open count', async () => {
    server.use(
      http.get(`${B}/auth/me`, () =>
        HttpResponse.json({
          ...fx.me,
          permissions: [...fx.me.permissions, 'feedback.manage', 'analytics.read'],
        }),
      ),
      http.get(`${B}/feedback`, () =>
        HttpResponse.json({
          items: [],
          total: 0,
          page: 1,
          pageSize: 1,
          counts: { new: 4, in_review: 1, needs_update: 0, no_change: 0, done: 0 },
        }),
      ),
    );
    renderWithProviders(<App />, { route: '/library' });
    const s = await side();
    expect(await s.findByText('משוב')).toBeInTheDocument();
    expect(await s.findByText('5')).toBeInTheDocument(); // new + in_review
    expect(s.getByText('נתוני שימוש')).toBeInTheDocument();
  });

  it('hides them without the permissions', async () => {
    server.use(http.get(`${B}/auth/me`, () => HttpResponse.json({ ...fx.me, permissions: ['docs.read'] })));
    renderWithProviders(<App />, { route: '/library' });
    const s = await side();
    await s.findByText('ספריית ידע');
    expect(s.queryByText('משוב')).toBeNull();
    expect(s.queryByText('נתוני שימוש')).toBeNull();
    expect(s.queryByText('⚙ ניהול עולמות ונושאים')).toBeNull();
  });

  it('offers the taxonomy admin entry with taxonomy.manage', async () => {
    server.use(
      http.get(`${B}/auth/me`, () =>
        HttpResponse.json({ ...fx.me, permissions: [...fx.me.permissions, 'taxonomy.manage'] }),
      ),
    );
    renderWithProviders(<App />, { route: '/library' });
    const s = await side();
    expect(await s.findByText('⚙ ניהול עולמות ונושאים')).toBeInTheDocument();
  });
});
