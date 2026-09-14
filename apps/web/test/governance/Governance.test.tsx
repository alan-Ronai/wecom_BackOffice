/**
 * Wave 4 · W2 — the governance components on their own.
 *
 * They are shipped standalone (W6 mounts them into the card, the article header and the editor's
 * metadata panel), so each is exercised here against the real msw contract rather than through a
 * page. What the assertions care about is the request that leaves the app — `state.statusChanges`
 * and `state.sourceReviewCleared` — because that is what the API half of this lane must receive.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { useReadOnlyReader } from '../../src/api/hooks/governance.js';
import { ModalProvider } from '../../src/components/ui/Modal.js';
import { StatusChip } from '../../src/components/governance/StatusChip.js';
import { StatusActions } from '../../src/components/governance/StatusMenu.js';
import { SourceReviewBadge } from '../../src/components/governance/SourceReviewBadge.js';
import { OwnerFields } from '../../src/components/governance/OwnerFields.js';
import { UnavailablePage } from '../../src/components/governance/UnavailablePage.js';
import { state } from '../msw/handlers.js';
import { fx } from '../msw/fixtures.js';

describe('governance components', () => {
  it('StatusChip labels every status in Hebrew', () => {
    renderWithProviders(
      <>
        <StatusChip status="invalid" />
        <StatusChip status="archived" />
        <StatusChip status="published" />
      </>,
    );
    expect(screen.getByText('לא בתוקף')).toBeInTheDocument();
    expect(screen.getByText('בארכיון')).toBeInTheDocument();
    expect(screen.queryByText('פורסם')).not.toBeInTheDocument(); // published renders no chip
  });

  it('StatusActions asks for a reason and posts the status change', async () => {
    renderWithProviders(
      <ModalProvider>
        <StatusActions
          doc={{ id: fx.docBrowsing.id, status: 'published', category: fx.docBrowsing.category }}
        />
      </ModalProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'סמן כלא בתוקף' }));
    const box = await screen.findByLabelText('סיבה');
    await userEvent.type(box, 'הוחלף בנוהל חדש');
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }));
    await waitFor(() =>
      expect(state.statusChanges).toEqual([
        { id: fx.docBrowsing.id, status: 'invalid', reason: 'הוחלף בנוהל חדש' },
      ]),
    );
  });

  it('StatusActions offers nothing to a user who cannot publish', async () => {
    const { server } = await import('../msw/server.js');
    const { withMe } = await import('../msw/handlers.js');
    server.use(withMe({ permissions: ['docs.read'] }));
    renderWithProviders(
      <ModalProvider>
        <StatusActions
          doc={{ id: fx.docBrowsing.id, status: 'published', category: fx.docBrowsing.category }}
        />
      </ModalProvider>,
    );
    await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument());
  });

  it('SourceReviewBadge shows the reason and clears with a note', async () => {
    renderWithProviders(
      <ModalProvider>
        <SourceReviewBadge
          doc={{
            id: fx.docBrowsing.id,
            sourceReviewNeeded: true,
            sourceReviewReason: 'גרסת מקור חדשה · נהלים',
          }}
        />
      </ModalProvider>,
    );
    expect(screen.getByText(/נדרשת בדיקה/)).toBeInTheDocument();
    expect(screen.getByTitle('גרסת מקור חדשה · נהלים')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'סמן כנבדק' }));
    await userEvent.type(await screen.findByLabelText('הערה'), 'לא משפיע');
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }));
    await waitFor(() =>
      expect(state.sourceReviewCleared).toEqual([{ id: fx.docBrowsing.id, note: 'לא משפיע' }]),
    );
  });

  it('SourceReviewBadge renders nothing when the flag is down', () => {
    renderWithProviders(<SourceReviewBadge doc={{ id: fx.docBrowsing.id, sourceReviewNeeded: false }} />);
    expect(screen.queryByText(/נדרשת בדיקה/)).not.toBeInTheDocument();
  });

  it('OwnerFields emits a patch with the chosen ids', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <OwnerFields
        doc={{
          ownerId: null,
          editorId: null,
          approverName: 'ענבר ל.',
          publishedAt: '2026-09-01T00:00:00.000Z',
        }}
        onChange={onChange}
      />,
    );
    const owner = await screen.findByLabelText('גורם מקצועי אחראי');
    await waitFor(() => expect(within(owner).queryAllByRole('option').length).toBeGreaterThan(1));
    await userEvent.selectOptions(owner, fx.me.user.id);
    expect(onChange).toHaveBeenCalledWith({ ownerId: fx.me.user.id });
    expect(screen.getByText(/מאשר: ענבר ל\./)).toBeInTheDocument();
  });

  it('useReadOnlyReader is true only for a user without docs.read_unpublished', async () => {
    const Probe = () => <span data-testid="ro">{String(useReadOnlyReader())}</span>;
    const { server } = await import('../msw/server.js');
    const { withMe } = await import('../msw/handlers.js');

    const admin = renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByTestId('ro')).toHaveTextContent('false'));
    admin.unmount();

    server.use(withMe({ permissions: ['docs.read'] }));
    renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByTestId('ro')).toHaveTextContent('true'));
  });

  it('UnavailablePage explains and links back', () => {
    renderWithProviders(<UnavailablePage />);
    expect(screen.getByRole('heading', { name: 'פריט זה אינו זמין כרגע' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'חזרה לספרייה' })).toHaveAttribute('href', '/library');
  });
});
