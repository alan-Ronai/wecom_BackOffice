import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { feedbackState, sampleFeedback } from '../msw/feedback-handlers.js';

describe('<FeedbackPage>', () => {
  beforeEach(() => {
    feedbackState.items = [
      sampleFeedback({ id: 'f0000000-0000-4000-8000-000000000001', kind: 'error' }),
      sampleFeedback({
        id: 'f0000000-0000-4000-8000-000000000002',
        kind: 'missing',
        status: 'in_review',
        assigneeId: 'e0000000-0000-4000-8000-0000000000a1',
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
  });

  it('is not available without feedback.manage', async () => {
    server.use(withMe({ permissions: ['docs.read'] }));
    renderWithProviders(<App />, { route: '/feedback' });
    expect(await screen.findByText('אין הרשאה לניהול משובים')).toBeInTheDocument();
  });
});
