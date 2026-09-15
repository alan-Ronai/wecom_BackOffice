import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { RefreshBanner } from '../../src/components/learning/RefreshBanner.js';
import { LearningBadge } from '../../src/components/learning/LearningBadge.js';
import { NotificationList } from '../../src/components/notifications/NotificationList.js';
import { learningState } from '../msw/learning-handlers.js';
import { fx } from '../msw/fixtures.js';

const A_REFRESH = 'a0000000-0000-4000-8000-000000000009';

describe('article learning banners', () => {
  it('renders nothing when no refresh is required', async () => {
    const r = renderWithProviders(<RefreshBanner documentId={fx.docBrowsing.id} />);
    await new Promise((res) => setTimeout(res, 50));
    // The providers' own toast host is the only node; the banner itself renders nothing.
    expect(r.container.querySelector('.learning-refresh')).toBeNull();
    expect(screen.queryByText(/רענון ידע נדרש/)).not.toBeInTheDocument();
  });
  it('shows the refresh banner linking to the open refresh assignment', async () => {
    learningState.docLearning = {
      items: [],
      refreshRequired: true,
      refreshAssignmentId: A_REFRESH,
      lastSignificantChange: {
        version: 9,
        at: '2026-09-15T08:00:00.000Z',
        reasons: ['שינוי בהסתעפות'],
      },
    };
    renderWithProviders(<RefreshBanner documentId={fx.docBrowsing.id} />);
    expect(await screen.findByText(/רענון ידע נדרש/)).toBeInTheDocument();
    expect(screen.getByText(/שינוי בהסתעפות/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'למטלת הרענון' })).toHaveAttribute(
      'href',
      `/learning/${A_REFRESH}`,
    );
  });
  it('shows how many learning items include the document', async () => {
    learningState.docLearning.items = [
      {
        id: 'b0000000-0000-4000-8000-000000000001',
        kind: 'briefing',
        title: 't',
        description: '',
        worldSlug: 'tech',
        status: 'published',
        currentVersion: 1,
        estimatedMinutes: null,
        needsUpdate: false,
        updatedAt: '2026-09-15T08:00:00.000Z',
        publishedAt: null,
        entryCount: 1,
        questionCount: 0,
        assignedUsers: 3,
        completionRate: 0.5,
      },
    ];
    renderWithProviders(<LearningBadge documentId={fx.docBrowsing.id} />);
    expect(await screen.findByText('כלול בפריט למידה אחד')).toBeInTheDocument();
  });
  it('offers the wave 5 notification tabs', async () => {
    renderWithProviders(<NotificationList />);
    const learning = await screen.findByRole('tab', { name: /^למידה/ });
    expect(await screen.findByRole('tab', { name: /^פערי ידע/ })).toBeInTheDocument();
    await userEvent.click(learning);
    expect(learning).toHaveAttribute('aria-selected', 'true');
  });
});
