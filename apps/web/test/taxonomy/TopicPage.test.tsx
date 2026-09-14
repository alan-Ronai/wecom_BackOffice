import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { http, HttpResponse } from 'msw';
import { fx, D_BROWSING } from '../msw/fixtures.js';
import { state } from '../msw/handlers.js';
import { server } from '../msw/server.js';

describe('TopicPage', () => {
  it('renders the topic header and groups in PRD order with type badges', async () => {
    renderWithProviders(<App />, { route: `/topic/${fx.topics[0]!.id}` });
    expect(await screen.findByRole('heading', { name: /תקלות גלישה/ })).toBeInTheDocument();
    const groups = screen.getAllByTestId('topic-group');
    expect(groups.map((g) => g.getAttribute('data-doctype'))).toEqual(['M', 'O']);
    expect(screen.getByText('אבחון גלישה')).toBeInTheDocument();
    expect(screen.getAllByText('אבחון').length).toBeGreaterThan(0); // DOC_TYPE_LABELS.M
    expect(screen.getByText('apn')).toBeInTheDocument(); // tag chip
    // Scoped to the group: the shell's world nav also carries "SIM / eSIM".
    expect(within(groups[1]!).getByText('SIM')).toBeInTheDocument(); // second world chip
  });

  it('shows an empty state for an unknown topic', async () => {
    renderWithProviders(<App />, { route: '/topic/00000000-0000-4000-8000-000000000000' });
    expect(await screen.findByText(/הנושא לא נמצא/)).toBeInTheDocument();
  });

  it('records a topic view, while opening an article in the topic does not', async () => {
    // `/analytics`'s "נושאים נצפים" reads `topic_views`, and the article only reads this list for
    // prev/next — counting that as a browse falsifies the metric, unrecoverably once it has run.
    const topicId = fx.topics[0]!.id;
    const page = renderWithProviders(<App />, { route: `/topic/${topicId}` });
    await screen.findByRole('heading', { name: /תקלות גלישה/ });
    await waitFor(() => expect(state.topicViews).toEqual([topicId]));
    page.unmount();

    server.use(
      http.get(`/api/v1/documents/${D_BROWSING}`, () =>
        HttpResponse.json({ ...fx.docBrowsing, topics: [topicId] }),
      ),
    );
    const article = renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await screen.findByRole('heading', { level: 1, name: fx.docBrowsing.title });
    // Wait for the prev/next control the article fetches that list *for*, so the assertion below
    // cannot pass merely because the request had not been made yet.
    expect(await screen.findByRole('button', { name: /בנושא:/ })).toBeInTheDocument();
    expect(state.topicViews).toEqual([topicId]);
    article.unmount();
  });
});
