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
import { fx, D_BROWSING, T } from '../msw/fixtures.js';

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

describe('W6 article mounts', () => {
  it('renders the type badge, tags and a feedback button in the header and on the active step', async () => {
    server.use(
      http.get(`${B}/documents/${D_BROWSING}`, () =>
        HttpResponse.json({ ...fx.docBrowsing, docType: 'R', tags: ['apn', 'esim'] }),
      ),
    );
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await screen.findByRole('heading', { level: 1, name: fx.docBrowsing.title });
    expect(screen.getByText('טיפול')).toBeInTheDocument(); // DOC_TYPE_LABELS.R
    expect(screen.getByText('#apn')).toBeInTheDocument();
    const buttons = await screen.findAllByRole('button', { name: 'דיווח על בעיה / משוב' });
    expect(buttons.length).toBeGreaterThanOrEqual(2); // header + active step
  });

  it('shows the unavailable page on NOT_PUBLISHED instead of "moved to the trash"', async () => {
    server.use(
      http.get(`${B}/documents/${D_BROWSING}`, () =>
        HttpResponse.json({ code: 'NOT_PUBLISHED', message: 'פריט זה אינו זמין כרגע' }, { status: 404 }),
      ),
    );
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    expect(await screen.findByRole('heading', { name: 'פריט זה אינו זמין כרגע' })).toBeInTheDocument();
    expect(screen.getByText('הפריט קיים אך אינו מפורסם, אינו בתוקף או הועבר לארכיון.')).toBeInTheDocument();
    // Not the generic "gone" page: telling a reader to check the trash sends them the wrong way.
    expect(screen.queryByText(/סל המיחזור/)).toBeNull();
  });

  it('switches to the source pane and back', async () => {
    server.use(
      http.get(`${B}/documents/${D_BROWSING}/source`, () =>
        HttpResponse.json({
          documentId: D_BROWSING,
          html: '<h2>מקור הידע</h2><p>טקסט מקור</p>',
          text: 'טקסט מקור',
          version: 2,
          etag: 's2',
          updatedById: null,
          updatedByName: null,
          updatedAt: T,
        }),
      ),
    );
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await screen.findByRole('heading', { level: 1, name: fx.docBrowsing.title });
    await userEvent.click(await screen.findByRole('button', { name: 'מקור' }));
    expect(await screen.findByText('טקסט מקור')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'תצוגת עבודה' }));
    expect(await screen.findByRole('heading', { level: 1, name: fx.docBrowsing.title })).toBeVisible();
  });

  it('offers prev/next inside the topic', async () => {
    const topicId = fx.topics[0]!.id;
    server.use(
      http.get(`${B}/documents/${D_BROWSING}`, () =>
        HttpResponse.json({ ...fx.docBrowsing, docType: 'R', topics: [topicId] }),
      ),
      http.get(`${B}/topics/${topicId}/items`, () =>
        HttpResponse.json({
          topic: fx.topics[0],
          world: fx.worlds[1],
          groups: [
            {
              docType: 'M',
              items: [
                {
                  id: fx.docIntl.id,
                  slug: 'm',
                  title: 'אבחון גלישה',
                  docType: 'M',
                  kind: 'steps',
                  status: 'published',
                  worlds: ['tech'],
                  description: '',
                  tags: [],
                  updatedAt: T,
                },
              ],
            },
            {
              docType: 'R',
              items: [
                {
                  id: D_BROWSING,
                  slug: 'browsing',
                  title: fx.docBrowsing.title,
                  docType: 'R',
                  kind: 'steps',
                  status: 'published',
                  worlds: ['tech'],
                  description: '',
                  tags: [],
                  updatedAt: T,
                },
              ],
            },
          ],
        }),
      ),
    );
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await screen.findByRole('heading', { level: 1, name: fx.docBrowsing.title });
    expect(await screen.findByRole('button', { name: /הקודם בנושא: אבחון גלישה/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /הבא בנושא/ })).toBeNull();
  });
});

describe('W6 library mounts', () => {
  it('passes the taxonomy filters from the URL to GET /documents and shows the type badge', async () => {
    let seen: URL | null = null;
    server.use(
      http.get(`${B}/documents`, ({ request }) => {
        seen = new URL(request.url);
        return HttpResponse.json({
          items: [{ ...fx.cards[0]!, docType: 'O', tags: ['apn'] }],
          total: 1,
          page: 1,
          pageSize: 50,
        });
      }),
    );
    renderWithProviders(<App />, { route: '/library?world=tech&docType=O&tag=apn' });
    const grid = await screen.findByTestId('library-grid');
    await waitFor(() => expect(seen?.searchParams.get('docType')).toBe('O'));
    expect(seen!.searchParams.get('world')).toBe('tech');
    expect(seen!.searchParams.getAll('tag')).toEqual(['apn']);
    // The card badge is `compact`, so its label lives in the title attribute.
    expect(await within(grid).findByTitle('תפעול')).toBeInTheDocument(); // DOC_TYPE_LABELS.O
  });

  it('shows the status actions to an editor', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const grid = await screen.findByTestId('library-grid');
    await userEvent.click((await within(grid).findAllByTitle('פעולות'))[0]!);
    expect(await screen.findByText('סמן כלא בתוקף')).toBeInTheDocument();
  });

  it('hides them from a read-only reader', async () => {
    server.use(http.get(`${B}/auth/me`, () => HttpResponse.json({ ...fx.me, permissions: ['docs.read'] })));
    renderWithProviders(<App />, { route: '/library' });
    const grid = await screen.findByTestId('library-grid');
    await userEvent.click((await within(grid).findAllByTitle('פעולות'))[0]!);
    await screen.findByText('🕓 היסטוריית גרסאות');
    expect(screen.queryByText('סמן כלא בתוקף')).toBeNull();
  });

  it('marks an invalid item on its card', async () => {
    server.use(
      http.get(`${B}/documents`, () =>
        HttpResponse.json({
          items: [{ ...fx.cards[0]!, status: 'invalid' }],
          total: 1,
          page: 1,
          pageSize: 50,
        }),
      ),
    );
    renderWithProviders(<App />, { route: '/library' });
    const grid = await screen.findByTestId('library-grid');
    expect(await within(grid).findByText('לא בתוקף')).toBeInTheDocument();
  });
});
