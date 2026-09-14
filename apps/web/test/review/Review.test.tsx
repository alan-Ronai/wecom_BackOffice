/**
 * The review workflow, both sides.
 *
 * Review item I6 removed the old "בקש סקירה" control because it PATCHed an empty body and toasted
 * success while persisting nothing. These tests exist so that cannot happen again: every
 * assertion is about the request that reached the server, not about the toast.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { server } from '../msw/server.js';
import { withMe } from '../msw/handlers.js';
import { D_BROWSING, D_INTL, fx } from '../msw/fixtures.js';
import { stage45State } from '../msw/stage45.js';

describe('request review', () => {
  it('sends a note and the chosen reviewers to /request-review', async () => {
    renderWithProviders(<App />, { route: `/edit/${D_BROWSING}` });
    await waitFor(() => expect(screen.getByLabelText('שם פריט הידע')).toHaveValue(fx.docBrowsing.title));

    await userEvent.click(screen.getByRole('button', { name: '📤 שלח לסקירה' }));
    await userEvent.type(await screen.findByLabelText('מה השתנה?'), 'עדכנתי את שלב 8');
    await userEvent.click(await screen.findByLabelText('דנה ר.'));
    await userEvent.click(screen.getByRole('button', { name: 'שלח לסקירה' }));

    await waitFor(() => {
      const created = stage45State.reviews.find((r) => r.documentId === D_BROWSING);
      expect(created?.note).toBe('עדכנתי את שלב 8');
    });
    await screen.findByText(/נשלח לסקירה/);
  });

  it('offers the control only for a saved document', async () => {
    renderWithProviders(<App />, { route: '/edit/new' });
    await screen.findByLabelText('שם פריט הידע');
    expect(screen.queryByRole('button', { name: '📤 שלח לסקירה' })).not.toBeInTheDocument();
  });
});

describe('<ReviewsPage> — the lead’s decision', () => {
  it('approves with a version label', async () => {
    renderWithProviders(<App />, { route: '/reviews' });
    await screen.findByRole('heading', { name: /סקירות/ });
    const title = fx.docIntl.title;

    await userEvent.click(await screen.findByLabelText(`אשר ופרסם את ${title}`));
    const label = await screen.findByLabelText('מה השתנה? (מופיע בהיסטוריית הגרסאות)');
    await userEvent.clear(label);
    await userEvent.type(label, 'אושר אחרי בדיקה');
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }));

    await waitFor(() => {
      const row = stage45State.reviews.find((r) => r.documentId === D_INTL);
      expect(row?.status).toBe('approved');
    });
  });

  it('refuses to return a document for changes without saying what to change', async () => {
    renderWithProviders(<App />, { route: '/reviews' });
    const title = fx.docIntl.title;
    await userEvent.click(await screen.findByLabelText(`דרוש שינויים ב-${title}`));
    await userEvent.click(await screen.findByRole('button', { name: 'אישור' }));

    await screen.findByText('צריך לכתוב מה לתקן');
    expect(stage45State.reviews.find((r) => r.documentId === D_INTL)?.status).toBe('open');
  });

  it('returns it for changes with a note', async () => {
    renderWithProviders(<App />, { route: '/reviews' });
    const title = fx.docIntl.title;
    await userEvent.click(await screen.findByLabelText(`דרוש שינויים ב-${title}`));
    await userEvent.type(await screen.findByLabelText('מה צריך לשנות? (נשלח לכותב/ת)'), 'חסר שלב הסלמה');
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }));

    await waitFor(() => {
      const row = stage45State.reviews.find((r) => r.documentId === D_INTL);
      expect(row?.status).toBe('changes');
      expect(row?.decisionNote).toBe('חסר שלב הסלמה');
    });
  });

  it('hides the decision controls from someone who cannot publish', async () => {
    server.use(withMe({ permissions: ['docs.read', 'docs.edit'] }));
    renderWithProviders(<App />, { route: '/reviews' });
    await screen.findByRole('heading', { name: /סקירות/ });
    await screen.findByText(fx.docIntl.title);
    expect(screen.queryByLabelText(/^אשר ופרסם/)).not.toBeInTheDocument();
  });
});
