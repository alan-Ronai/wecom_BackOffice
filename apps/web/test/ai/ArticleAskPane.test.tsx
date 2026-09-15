import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { ArticleAskPane } from '../../src/components/ai/ArticleAskPane.js';
import { server } from '../msw/server.js';
import { withMe } from '../msw/handlers.js';

// X4a owns the chat transport; this lane owns where the pane sits and what it is handed.
vi.mock('../../src/components/ai/ChatPane.js', () => ({
  ChatPane: (p: { kind: string; documentId: string; readOnly?: boolean; context?: { stepKey?: string } }) => (
    <div data-testid="chat-pane">
      {p.kind}:{p.documentId}:{p.readOnly ? 'ro' : 'rw'}:{p.context?.stepKey ?? '-'}
    </div>
  ),
}));

describe('ArticleAskPane', () => {
  it('starts collapsed, opens on click, and mounts the read-only chat for the document', async () => {
    renderWithProviders(<ArticleAskPane documentId="doc-1" stepKey="s3" />, { route: '/doc/doc-1' });
    const toggle = await screen.findByRole('button', { name: 'שאל את המערכת' });
    expect(screen.queryByTestId('chat-pane')).toBeNull();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByTestId('chat-pane')).toHaveTextContent('article:doc-1:ro:s3');
    expect(screen.getByRole('region', { name: 'שאל את המערכת' })).toBeInTheDocument();
    expect(screen.getByText(/מבוססות על התוכן שפורסם בלבד/)).toBeInTheDocument();
  });

  it('renders nothing without ai.ask', async () => {
    server.use(withMe({ permissions: ['docs.read'] }));
    const { container } = renderWithProviders(<ArticleAskPane documentId="doc-1" />, {
      route: '/doc/doc-1',
    });
    await waitFor(() => expect(container.querySelector('.ask-pane')).toBeNull());
    expect(screen.queryByRole('button', { name: 'שאל את המערכת' })).toBeNull();
  });
});
