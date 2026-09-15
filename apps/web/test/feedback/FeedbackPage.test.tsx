import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { feedbackState, sampleFeedback } from '../msw/feedback-handlers.js';
import { U1 } from '../msw/fixtures.js';

describe('<FeedbackPage>', () => {
  beforeEach(() => {
    feedbackState.items = [
      sampleFeedback({ id: 'f0000000-0000-4000-8000-000000000001', kind: 'error' }),
      sampleFeedback({
        id: 'f0000000-0000-4000-8000-000000000002',
        kind: 'missing',
        status: 'in_review',
        assigneeId: U1,
        assigneeName: 'ענבר ל.',
      }),
      sampleFeedback({
        id: 'f0000000-0000-4000-8000-000000000003',
        kind: 'other',
        status: 'done',
        resolvedVersion: 3,
      }),
    ];
  });

  it('shows status tabs with counts, filters by tab and by kind', async () => {
    renderWithProviders(<App />, { route: '/feedback' });
    expect(await screen.findByRole('tab', { name: /חדש \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /טופל \(1\)/ })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(1 + 3); // header + 3 rows on "הכל"
    await userEvent.click(screen.getByRole('tab', { name: /בבדיקה/ }));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    // Scoped to the table: the same label is also one of the kind filter's <option>s.
    expect(within(screen.getByRole('table')).getByText('חסר מידע')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /הכל/ }));
    await userEvent.selectOptions(screen.getByLabelText('סוג משוב'), 'other');
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(screen.getByText('v3')).toBeInTheDocument(); // resolved version chip
  });

  it('filters by world, item type and assignee, and drives the tabs from the keyboard', async () => {
    renderWithProviders(<App />, { route: '/feedback' });
    await screen.findByRole('tab', { name: /חדש \(1\)/ });
    // §5.4 lists five filters; world, docType and assignee had no control at all.
    await userEvent.selectOptions(screen.getByLabelText('אחראי טיפול'), U1);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    await userEvent.selectOptions(screen.getByLabelText('אחראי טיפול'), '');
    expect(screen.getByLabelText('עולם תוכן')).toBeInTheDocument();
    expect(screen.getByLabelText('סוג פריט')).toBeInTheDocument();

    // The tabs are real buttons now: `role="tab"` promised Enter/Space and arrow keys, and
    // `<span role="tab" tabIndex={0}>` delivered neither.
    const all = screen.getByRole('tab', { name: /הכל/ });
    all.focus();
    await userEvent.keyboard('{ArrowLeft}'); // RTL: left is *forward* through the tabs
    await waitFor(() => expect(screen.getByRole('tab', { name: /חדש/ })).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
  });

  it('opens the drawer, deep-links to the step, records a decision and resolves by version', async () => {
    renderWithProviders(<App />, { route: '/feedback' });
    await userEvent.click(await screen.findByRole('link', { name: /מצאתי טעות/ }));
    const drawer = await screen.findByRole('complementary', { name: 'פרטי משוב' });
    expect(within(drawer).getByRole('link', { name: 'פתח מסמך' })).toHaveAttribute(
      'href',
      expect.stringMatching(/\/doc\/.+\/s2$/),
    );
    expect(within(drawer).getByText(/ניתן על גרסה v\d+/)).toBeInTheDocument();
    await userEvent.selectOptions(within(drawer).getByLabelText('סטטוס'), 'needs_update');
    await userEvent.type(within(drawer).getByLabelText('תיעוד החלטה'), 'צריך לעדכן את הסף');
    await userEvent.click(within(drawer).getByRole('button', { name: 'שמור' }));
    await waitFor(() =>
      expect(feedbackState.items[0]).toMatchObject({
        status: 'needs_update',
        decisionNote: 'צריך לעדכן את הסף',
      }),
    );
    await userEvent.selectOptions(
      within(drawer).getByLabelText('נסגר בגרסה'),
      String(feedbackState.items[0].documentVersion + 1),
    );
    await userEvent.click(within(drawer).getByRole('button', { name: 'סגור משוב' }));
    await waitFor(() =>
      expect(feedbackState.items[0]).toMatchObject({
        status: 'done',
        resolvedVersion: feedbackState.items[0].documentVersion + 1,
      }),
    );
    expect(await screen.findByText('המשוב נסגר')).toBeInTheDocument();

    // The drawer closes on Escape; its ✕ used to be an inert `<span role="button">`.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'פרטי משוב' })).toBeNull());
    // Whole-app render plus ~10 user-event round trips: under machine load (several lanes running
    // vitest at once) this sequence alone crossed the 15 s default three times today while every
    // step passed on its own. The budget is the test's, not the suite's.
  }, 40_000);

  it('analytics tab renders the PRD metrics', async () => {
    renderWithProviders(<App />, { route: '/feedback/analytics' });
    expect(await screen.findByText('זמן ממוצע לטיפול')).toBeInTheDocument();
    expect(screen.getByText('30.5 שעות')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument(); // change rate
    expect(screen.getByText(/מצאתי טעות/)).toBeInTheDocument(); // by kind
    expect(screen.getByRole('table', { name: 'פריטים עם הכי הרבה דיווחים' })).toBeInTheDocument();
  });

  it('is not available without feedback.manage', async () => {
    server.use(withMe({ permissions: ['docs.read'] }));
    renderWithProviders(<App />, { route: '/feedback' });
    expect(await screen.findByText('אין הרשאה לניהול משובים')).toBeInTheDocument();
  });
});
