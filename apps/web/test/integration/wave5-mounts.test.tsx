/**
 * V6 — every wave 5 component mounted into the shell, article, editor, review queue and identity.
 *
 * One describe per mount task. The lanes each proved their component in isolation; these tests
 * prove it is reachable from the screen the spec (§5) puts it on, behind the permission gate the
 * spec asks for. Copy is asserted against what the lanes actually shipped, not the plan's draft.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { fx } from '../msw/fixtures.js';
import { learningState } from '../msw/learning-handlers.js';
import { learningState as manageState } from '../msw/learning-manage.js';

const B = '/api/v1';
const side = async () => within(await screen.findByRole('complementary', { name: 'ניווט ראשי' }));
/** `fx.me` is the all-permissions admin; narrow it to exactly what a case is about. */
const withPermissions = (...permissions: string[]) =>
  server.use(http.get(`${B}/auth/me`, () => HttpResponse.json({ ...fx.me, permissions })));

describe('V6 shell mounts', () => {
  it('shows learning, manage and gaps entries with the badge of what is still owed', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const s = await side();
    const nav = await s.findByRole('navigation', { name: 'למידה' });
    expect(within(nav).getByText('הלמידה שלי')).toBeInTheDocument();
    // two open + one overdue in the default MSW state; completed history is deliberately excluded.
    expect(await within(nav).findByText('3')).toBeInTheDocument();
    expect(within(nav).getByText('ניהול למידה')).toBeInTheDocument();
    expect(within(nav).getByText('פערי ידע')).toBeInTheDocument();
  });

  it('hides manage and gaps from an agent and shows no badge with nothing owed', async () => {
    withPermissions('docs.read', 'learning.read');
    learningState.my = { open: [], overdue: [], completed: [], invalidated: [] };
    renderWithProviders(<App />, { route: '/library' });
    const s = await side();
    const nav = await s.findByRole('navigation', { name: 'למידה' });
    expect(within(nav).getByText('הלמידה שלי')).toBeInTheDocument();
    expect(within(nav).queryByText('ניהול למידה')).toBeNull();
    expect(within(nav).queryByText('פערי ידע')).toBeNull();
    expect(within(nav).queryByText('0')).toBeNull();
  });

  it('drops the whole section for a user with none of the three permissions', async () => {
    withPermissions('docs.read');
    renderWithProviders(<App />, { route: '/library' });
    const s = await side();
    await s.findByRole('navigation', { name: 'נתונים' });
    expect(s.queryByRole('navigation', { name: 'למידה' })).toBeNull();
  });
});

describe('V6 article mounts', () => {
  it('shows the refresh banner with a link to the assignment, and the learning items in the panel', async () => {
    learningState.docLearning = {
      items: [
        {
          id: 'b0000000-0000-4000-8000-0000000000aa',
          kind: 'quiz',
          title: 'שאלון גלישה',
          description: '',
          worldSlug: 'tech',
          status: 'published',
          currentVersion: 2,
          estimatedMinutes: 4,
          needsUpdate: false,
          updatedAt: '2026-09-15T08:00:00.000Z',
          publishedAt: '2026-09-15T08:00:00.000Z',
          entryCount: 1,
          questionCount: 3,
          assignedUsers: 5,
          completionRate: 0.4,
        },
      ],
      refreshRequired: true,
      refreshAssignmentId: 'a0000000-0000-4000-8000-0000000000bb',
      lastSignificantChange: { version: 4, at: '2026-09-15T08:00:00.000Z', reasons: ['outcome'] },
    };
    renderWithProviders(<App />, { route: `/doc/${fx.docBrowsing.id}` });
    const banner = await screen.findByRole('status', { name: 'רענון ידע נדרש' });
    expect(within(banner).getByRole('link', { name: 'למטלת הרענון' })).toHaveAttribute(
      'href',
      '/learning/a0000000-0000-4000-8000-0000000000bb',
    );
    // the manager chip counts the items that teach this document
    expect(await screen.findByText('כלול בפריט למידה אחד')).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'פריטי למידה' });
    expect(within(list).getByText(/שאלון · שאלון גלישה/)).toBeInTheDocument();
  });

  it('renders nothing extra when no learning item references the document', async () => {
    manageState.items = [];
    renderWithProviders(<App />, { route: `/doc/${fx.docBrowsing.id}` });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('status', { name: 'רענון ידע נדרש' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'פריטי למידה' })).toBeNull();
  });
});

describe('V6 editor mounts', () => {
  it('pre-ticks the significant-change checkbox from the preview, sends it, and toasts the flag', async () => {
    learningState.changePreview = { significant: true, reasons: ['תוצאה השתנתה בשלב 3'], affectedItems: 2 };
    let sent: { significantChange?: boolean } | undefined;
    server.use(
      http.post(`${B}/documents/:id/publish`, async ({ request }) => {
        sent = (await request.json()) as { significantChange?: boolean };
        return HttpResponse.json({
          document: fx.docBrowsing,
          version: 4,
          auditId: 'a0000000-0000-4000-8000-0000000000cc',
          changeFlag: {
            significant: true,
            reasons: ['תוצאה השתנתה בשלב 3'],
            affectedItems: 2,
            refreshAssignments: 5,
          },
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<App />, { route: `/edit/${fx.docBrowsing.id}` });
    await user.click(await screen.findByRole('button', { name: /פרסם/ }));
    const box = await screen.findByRole('checkbox', { name: 'שינוי מהותי – דרוש רענון' });
    // The detector already decided; the editor is confirming, not guessing.
    await waitFor(() => expect(box).toBeChecked());
    expect(screen.getByText(/שני פריטי למידה מושפעים/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'אישור' }));
    await waitFor(() => expect(sent?.significantChange).toBe(true));
    expect(await screen.findByText(/5 רענונים נוצרו/)).toBeInTheDocument();
  });

  it('unticking the box is an explicit override, sent as false', async () => {
    learningState.changePreview = { significant: true, reasons: ['תוצאה השתנתה'], affectedItems: 1 };
    let sent: { significantChange?: boolean } | undefined;
    server.use(
      http.post(`${B}/documents/:id/publish`, async ({ request }) => {
        sent = (await request.json()) as { significantChange?: boolean };
        return HttpResponse.json({
          document: fx.docBrowsing,
          version: 4,
          auditId: 'a0000000-0000-4000-8000-0000000000cd',
          changeFlag: { significant: false, reasons: [], affectedItems: 0, refreshAssignments: 0 },
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<App />, { route: `/edit/${fx.docBrowsing.id}` });
    await user.click(await screen.findByRole('button', { name: /פרסם/ }));
    const box = await screen.findByRole('checkbox', { name: 'שינוי מהותי – דרוש רענון' });
    await waitFor(() => expect(box).toBeChecked());
    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'אישור' }));
    await waitFor(() => expect(sent?.significantChange).toBe(false));
  });

  it('says nothing about a significant change while the preview is still in flight', async () => {
    let sent: Record<string, unknown> | undefined;
    server.use(
      // The preview never lands: a fast editor, or a slow API — the case where an unticked box
      // means "not known yet" rather than "no".
      http.get(`${B}/documents/:id/change-preview`, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
      http.post(`${B}/documents/:id/publish`, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          document: fx.docBrowsing,
          version: 4,
          auditId: 'a0000000-0000-4000-8000-0000000000ce',
          changeFlag: { significant: true, reasons: [], affectedItems: 1, refreshAssignments: 3 },
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<App />, { route: `/edit/${fx.docBrowsing.id}` });
    await user.click(await screen.findByRole('button', { name: /פרסם/ }));
    const box = await screen.findByRole('checkbox', { name: 'שינוי מהותי – דרוש רענון' });
    expect(box).toBeDisabled();
    expect(screen.getByText('בודק אם השינוי מהותי…')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'אישור' }));
    await waitFor(() => expect(sent).toBeTruthy());
    // Silence, so the server's own detector decides — not `significantChange: false`.
    expect(sent).not.toHaveProperty('significantChange');
  });
});

describe('V6 review-queue mounts', () => {
  it('disables approve and explains the approver rule when the row says this caller may not', async () => {
    server.use(
      http.get(`${B}/reviews`, () =>
        HttpResponse.json({
          items: [
            {
              id: 'e0000000-0000-4000-8000-000000000001',
              documentId: fx.docIntl.id,
              requestedBy: 'f0000000-0000-4000-8000-000000000009',
              requestedByName: 'דנה ר.',
              note: 'לבדיקה',
              status: 'open',
              decidedBy: null,
              decidedByName: null,
              decisionNote: null,
              createdAt: '2026-09-15T08:00:00.000Z',
              decidedAt: null,
              title: fx.docIntl.title,
              category: 'intl',
              canApprove: false,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 50,
        }),
      ),
    );
    renderWithProviders(<App />, { route: '/reviews' });
    const approve = await screen.findByRole('button', { name: `אשר ופרסם את ${fx.docIntl.title}` });
    expect(approve).toBeDisabled();
    expect(screen.getByText('אישור דורש תפקיד מאשר')).toBeInTheDocument();
  });

  it('turns a 403 APPROVER_REQUIRED into a message instead of an unhandled rejection', async () => {
    server.use(
      http.post(`${B}/documents/:id/review-decision`, () =>
        HttpResponse.json({ code: 'APPROVER_REQUIRED', message: 'נדרש תפקיד מאשר' }, { status: 403 }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<App />, { route: '/reviews' });
    await user.click(await screen.findByRole('button', { name: /אשר ופרסם את/ }));
    await user.click(await screen.findByRole('button', { name: 'אישור' }));
    expect(await screen.findByText(/נדרש תפקיד מאשר כדי לאשר ולפרסם מסקירה/)).toBeInTheDocument();
  });
});

describe('V6 identity mounts', () => {
  it('shows the workflow settings card on /admin/identity', async () => {
    renderWithProviders(<App />, { route: '/admin/identity' });
    const card = await screen.findByRole('region', { name: 'תהליך עבודה ולמידה' });
    expect(within(card).getByRole('checkbox', { name: 'דרוש מאשר לפרסום' })).toBeInTheDocument();
  });
});
