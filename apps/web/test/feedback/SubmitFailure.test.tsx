/**
 * L7 — a failed feedback submit is handled, not thrown into the void.
 *
 * `onClick={() => void submit()}` discarded the promise, so a 500 from
 * `POST /documents/:id/feedback` became an unhandled rejection: a red page-level error in the
 * browser console, and — in a runtime configured to treat them as fatal — worse. The mutation
 * already reports the failure through `create.isError`, which is what the banner under the buttons
 * renders, so the rejection was noise on top of an error the component had already handled.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../render.js';
import { ModalProvider } from '../../src/components/ui/Modal.js';
import { ToastProvider } from '../../src/components/ui/Toast.js';
import { FeedbackButton } from '../../src/components/feedback/FeedbackButton.js';
import { server } from '../msw/server.js';
import { fx } from '../msw/fixtures.js';

const rejections: unknown[] = [];
const onRejection = (r: unknown) => rejections.push(r);

afterEach(() => {
  process.off('unhandledRejection', onRejection);
  rejections.length = 0;
});

const mount = () =>
  renderWithProviders(
    <ToastProvider>
      <ModalProvider>
        <FeedbackButton
          documentId={fx.docBrowsing.id}
          documentVersion={fx.docBrowsing.currentVersion}
          documentTitle={fx.docBrowsing.title}
          docType="T"
          worldSlug={fx.docBrowsing.category}
        />
      </ModalProvider>
    </ToastProvider>,
  );

describe('a feedback submit that the API rejects', () => {
  it('shows the failure banner and raises no unhandled rejection', async () => {
    server.use(
      http.post(`/api/v1/documents/:id/feedback`, () =>
        HttpResponse.json({ code: 'INTERNAL', message: 'נפילה' }, { status: 500 }),
      ),
    );
    process.on('unhandledRejection', onRejection);

    mount();
    await userEvent.click(screen.getByRole('button', { name: 'דיווח על בעיה / משוב' }));
    const dialog = await screen.findByRole('dialog', { name: 'דיווח על בעיה / משוב' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'התהליך לא עובד בפועל' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'שלח' }));

    // The failure is reported where the agent is looking, and the dialog stays open with what they
    // typed still in it — losing a report because the network blinked is the worst outcome here.
    expect(await within(dialog).findByText('שליחת המשוב נכשלה · נסו שוב')).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();

    // A tick past the microtask queue, which is when node decides a rejection went unhandled.
    await new Promise((r) => setTimeout(r, 50));
    expect(rejections).toEqual([]);
  });

  it('does not claim success — no toast, and the dialog is not dismissed', async () => {
    server.use(
      http.post(`/api/v1/documents/:id/feedback`, () =>
        HttpResponse.json({ code: 'INTERNAL', message: 'נפילה' }, { status: 500 }),
      ),
    );
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'דיווח על בעיה / משוב' }));
    const dialog = await screen.findByRole('dialog', { name: 'דיווח על בעיה / משוב' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'התהליך לא עובד בפועל' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'שלח' }));

    await within(dialog).findByText('שליחת המשוב נכשלה · נסו שוב');
    await waitFor(() => expect(screen.queryByText('תודה! המשוב נשלח לעורכי התוכן')).not.toBeInTheDocument());
  });
});
