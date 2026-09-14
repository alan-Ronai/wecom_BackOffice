import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { fx } from '../msw/fixtures.js';

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
});
