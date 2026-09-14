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
import { fx, D_BROWSING, REV_1, SRC_TECH, T } from '../msw/fixtures.js';

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

  it('offers the feedback button on every step, not only the active one in call mode', async () => {
    // §5.4 says "fixed … in the article header and per step": the point of the per-step entry is
    // that the agent reports from where the problem is. Gated on `callMode && cur` it existed on
    // one step at a time, and only inside call mode — and `>= 2` could not tell the difference.
    server.use(
      http.get(`${B}/me/preferences`, () => HttpResponse.json({ ...fx.me.preferences, callMode: false })),
    );
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await screen.findByRole('heading', { level: 1, name: fx.docBrowsing.title });
    const steps = document.querySelectorAll('[data-step]');
    expect(steps.length).toBeGreaterThan(1);
    const buttons = await screen.findAllByRole('button', { name: 'דיווח על בעיה / משוב' });
    expect(buttons.length).toBe(steps.length + 1); // one per step, plus the header
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

  it('opens an article in a world the seed table does not know', async () => {
    // The regression this locks down: `CATS[slug].label` on an admin-created world threw inside
    // `QuickSwitch`/`PrintFrame`, and with no error boundary the whole root unmounted — a blank
    // page with the URL still in the bar, which is exactly what spec §9 promises will work.
    server.use(
      http.get(`${B}/worlds`, () =>
        HttpResponse.json({
          items: [
            ...fx.worlds,
            { ...fx.worlds[0]!, id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000099', slug: 'field', name: 'שטח' },
          ],
        }),
      ),
      http.get(`${B}/documents/${D_BROWSING}`, () =>
        HttpResponse.json({ ...fx.docBrowsing, category: 'field', worlds: ['field'] }),
      ),
    );
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    expect(await screen.findByRole('heading', { level: 1, name: fx.docBrowsing.title })).toBeInTheDocument();
    // Falls back to the slug rather than crashing on `undefined.label`.
    expect(screen.getAllByText(/field/).length).toBeGreaterThan(0);
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
          latestRevisionId: REV_1,
        }),
      ),
      http.get(`${B}/documents/${D_BROWSING}`, () =>
        HttpResponse.json({ ...fx.docBrowsing, sourceId: SRC_TECH }),
      ),
    );
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await screen.findByRole('heading', { level: 1, name: fx.docBrowsing.title });
    await userEvent.click(await screen.findByRole('button', { name: 'מקור' }));
    expect(await screen.findByText('טקסט מקור')).toBeInTheDocument();
    // D-I9: the raw download reads its revision off the source document, so the mount — not just
    // the component with a hand-passed prop — actually renders it.
    expect(screen.getByRole('link', { name: 'הורד קובץ מקור' })).toHaveAttribute(
      'href',
      expect.stringContaining(`/sources/${SRC_TECH}/revisions/${REV_1}/raw`),
    );
    await userEvent.click(screen.getByRole('button', { name: 'תצוגת עבודה' }));
    expect(await screen.findByRole('heading', { level: 1, name: fx.docBrowsing.title })).toBeVisible();
  });

  it('falls back to the working view when a persisted pane mode has no source to show', async () => {
    // `paneMode` is a global preference; whether a document has a source is per-document. An
    // agent who switched to "מקור" on one item used to open the next one on the source pane's
    // empty state instead of the article — mid-call, reading as "the document is empty".
    server.use(
      http.get(`${B}/me/preferences`, () => HttpResponse.json({ ...fx.me.preferences, paneMode: 'source' })),
      http.get(`${B}/documents/${D_BROWSING}/source`, () =>
        HttpResponse.json({ code: 'NOT_FOUND', message: 'אין מקור' }, { status: 404 }),
      ),
    );
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    expect(await screen.findByRole('heading', { level: 1, name: fx.docBrowsing.title })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'מקור' })).toBeDisabled());
    expect(screen.queryByText('אין עדיין מסמך מקור לפריט זה')).toBeNull();
  });

  it('persists the pane choice through the preferences round trip', async () => {
    // Every PUT, not just the last: the shell writes preferences of its own (`lastSeen`,
    // `sidebarExpanded`), and whichever lands last would otherwise decide the assertion.
    const saved: Record<string, unknown>[] = [];
    server.use(
      http.get(`${B}/documents/${D_BROWSING}/source`, () =>
        HttpResponse.json({
          documentId: D_BROWSING,
          html: '<p>טקסט מקור</p>',
          text: 'טקסט מקור',
          version: 1,
          etag: 's1',
          updatedById: null,
          updatedByName: null,
          updatedAt: T,
          latestRevisionId: null,
        }),
      ),
      http.put(`${B}/me/preferences`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        saved.push(body);
        return HttpResponse.json(body);
      }),
    );
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await screen.findByRole('heading', { level: 1, name: fx.docBrowsing.title });
    await userEvent.click(await screen.findByRole('button', { name: 'מפוצל' }));
    // The choice has to follow the agent to the next machine, so it is written back, not local.
    await waitFor(() => expect(saved.some((b) => b.paneMode === 'split')).toBe(true));
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

describe('W6 source editor route', () => {
  it('gives an editor the editing surface', async () => {
    renderWithProviders(<App />, { route: `/edit/${D_BROWSING}/source` });
    expect(await screen.findByRole('button', { name: 'שמור גרסה' })).toBeInTheDocument();
    expect(screen.queryByText('אין הרשאה לערוך את מסמך המקור')).toBeNull();
  });

  it('refuses the editing surface to a reader who guesses the URL', async () => {
    // The chrome was gated but the editor itself was not: a read-only agent got a working TipTap
    // surface and an autosave firing `PUT …/source/draft` every three seconds against a server
    // that refuses all of it.
    server.use(http.get(`${B}/auth/me`, () => HttpResponse.json({ ...fx.me, permissions: ['docs.read'] })));
    renderWithProviders(<App />, { route: `/edit/${D_BROWSING}/source` });
    expect(await screen.findByText('אין הרשאה לערוך את מסמך המקור')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'שמור גרסה' })).toBeNull();
  });
});

describe('W6 editor mounts', () => {
  it('shows the metadata and ownership panels, the source link and the export button', async () => {
    renderWithProviders(<App />, { route: `/edit/${D_BROWSING}` });
    await screen.findByPlaceholderText('שם פריט הידע…');
    expect(await screen.findByLabelText('סוג פריט')).toBeInTheDocument(); // MetadataPanel
    expect(await screen.findByLabelText('גורם מקצועי אחראי')).toBeInTheDocument(); // OwnerFields
    expect(screen.getByRole('link', { name: 'ערוך מקור' })).toHaveAttribute(
      'href',
      `/edit/${D_BROWSING}/source`,
    );
    expect(screen.getByRole('button', { name: 'ייבוא מ-Word' })).toBeInTheDocument();
    // The old free-text category select is gone — the primary world lives in the metadata panel.
    expect(screen.queryByLabelText('קובץ יעד')).toBeNull();
  });

  it('publishes with the feedback the editor ticked', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.get(`${B}/documents/${D_BROWSING}/feedback`, () =>
        HttpResponse.json({
          items: [
            {
              id: '99999999-9999-4999-8999-999999999999',
              documentId: D_BROWSING,
              documentVersion: 7,
              docType: 'R',
              worldSlug: 'tech',
              stepKey: 's1',
              kind: 'error',
              text: 'טעות בשלב 1',
              status: 'new',
              userId: fx.me.user.id,
              userName: 'דנה',
              createdAt: T,
              assigneeId: null,
              decisionNote: null,
              decidedBy: null,
              decidedAt: null,
              resolvedVersion: null,
              documentTitle: fx.docBrowsing.title,
              assigneeName: null,
            },
          ],
        }),
      ),
      http.post(`${B}/documents/${D_BROWSING}/publish`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          document: { ...fx.docBrowsing, currentVersion: 8 },
          version: 8,
          auditId: '55555555-5555-4555-8555-555555555555',
        });
      }),
    );
    renderWithProviders(<App />, { route: `/edit/${D_BROWSING}` });
    await screen.findByPlaceholderText('שם פריט הידע…');
    await userEvent.click(await screen.findByRole('button', { name: /פרסם v/ }));
    const dialog = await screen.findByRole('dialog', { name: /פרסום v/ });
    await userEvent.type(within(dialog).getByLabelText(/מה השתנה/), 'תיקון');
    await userEvent.click(await within(dialog).findByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'אישור' }));
    await waitFor(() => expect(body?.resolveFeedbackIds).toEqual(['99999999-9999-4999-8999-999999999999']));
  });

  it('edits a text-kind item as a body, not as steps', async () => {
    server.use(
      http.get(`${B}/documents/${D_BROWSING}`, () =>
        HttpResponse.json({
          ...fx.docBrowsing,
          kind: 'text',
          docType: 'T',
          phases: [],
          bodyHtml: '<p>שלום, מדבר/ת נציג/ה</p>',
        }),
      ),
    );
    renderWithProviders(<App />, { route: `/edit/${D_BROWSING}` });
    await screen.findByPlaceholderText('שם פריט הידע…');
    // §5.3: the same TipTap component in a compact mode, not a raw-HTML textarea. The rendered
    // text is the assertion; the markup is the editor's business.
    const body = await screen.findByLabelText('תוכן הפריט');
    expect(body).toHaveTextContent('שלום, מדבר/ת נציג/ה');
    expect(within(body).queryByRole('textbox')).toBeNull(); // it *is* the textbox
    expect(screen.getByRole('button', { name: 'מודגש' })).toBeInTheDocument();
    // Compact drops the table and image controls; the raw HTML stays behind an explicit toggle.
    expect(screen.queryByRole('button', { name: 'טבלה' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'עריכת HTML' }));
    expect(await screen.findByLabelText('תוכן הפריט (HTML)')).toHaveValue('<p>שלום, מדבר/ת נציג/ה</p>');
    expect(screen.queryByText('+ קבוצת שלבים')).toBeNull();
  });
});
