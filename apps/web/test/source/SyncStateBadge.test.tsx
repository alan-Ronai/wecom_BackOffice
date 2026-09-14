import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { resetState } from '../msw/handlers.js';
import { stage5State } from '../msw/stage5.js';
import { D_BROWSING, D_INTL, D_CHURN } from '../msw/fixtures.js';
import { SyncStateBadge } from '../../src/components/source/SyncStateBadge.js';

/**
 * The parked ruling was that a pending push is an operator action on `/sync` and the article's
 * source-review flag answers a different question. Both true — and the cost named in the same
 * sentence was that an editor can clear the review flag believing the loop is closed while
 * WordPress still shows the old text. This is the badge that closes it.
 */
describe('SyncStateBadge', () => {
  beforeEach(() => resetState());

  it('names a conflict', async () => {
    renderWithProviders(<SyncStateBadge documentId={D_BROWSING} />);
    expect(await screen.findByText('⇄ קונפליקט')).toBeInTheDocument();
  });

  it('names a pending push, and says which connector in the tooltip', async () => {
    // D_BROWSING carries both a conflict and a pending push; with the conflict gone the push is
    // the most urgent thing left, which is exactly the server's ordering.
    stage5State.links = stage5State.links.filter((l) => l.state !== 'conflict');
    renderWithProviders(<SyncStateBadge documentId={D_BROWSING} />);
    const badge = await screen.findByText('⇡ ממתין לדחיפה');
    expect(badge).toHaveAttribute('title', expect.stringContaining('WordPress'));
  });

  it('shows nothing for pending_import — the queue is pulling towards us, nobody has to act', async () => {
    renderWithProviders(<SyncStateBadge documentId={D_INTL} />);
    await waitFor(() => expect(screen.queryByText(/ממתין לדחיפה|קונפליקט/)).not.toBeInTheDocument());
  });

  it('shows nothing for a document with no sync link at all', async () => {
    renderWithProviders(<SyncStateBadge documentId={D_CHURN} />);
    await waitFor(() => expect(screen.queryByText(/ממתין לדחיפה|קונפליקט/)).not.toBeInTheDocument());
  });
});
