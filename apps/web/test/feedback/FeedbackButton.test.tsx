import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { ModalProvider } from '../../src/components/ui/Modal.js';
import { ToastProvider } from '../../src/components/ui/Toast.js';
import { FeedbackButton } from '../../src/components/feedback/FeedbackButton.js';
import { feedbackState } from '../msw/feedback-handlers.js';
import { fx } from '../msw/fixtures.js';

// `docBrowsing` carries no `docType` (it predates the field), so the type is passed explicitly —
// otherwise the A-4 assertion below would pass against a dialog that simply renders no badge.
const mount = (stepKey?: string, docType: string | undefined = 'T') =>
  renderWithProviders(
    <ToastProvider>
      <ModalProvider>
        <FeedbackButton
          documentId={fx.docBrowsing.id}
          documentVersion={fx.docBrowsing.currentVersion}
          stepKey={stepKey}
          documentTitle={fx.docBrowsing.title}
          docType={docType}
          worldSlug={fx.docBrowsing.category}
        />
      </ModalProvider>
    </ToastProvider>,
  );

describe('<FeedbackButton>', () => {
  it('A-4: names the doc type as letter · label, never the bare storage letter', async () => {
    mount('s1', 'T');
    await userEvent.click(screen.getByRole('button', { name: 'דיווח על בעיה / משוב' }));
    const dialog = await screen.findByRole('dialog', { name: 'דיווח על בעיה / משוב' });
    expect(within(dialog).getByText(/סוג T · תסריט/)).toBeInTheDocument();
  });

  it('opens the seven kinds with the read-only context and submits without extra input', async () => {
    mount('s3');
    await userEvent.click(screen.getByRole('button', { name: 'דיווח על בעיה / משוב' }));
    const dialog = await screen.findByRole('dialog', { name: 'דיווח על בעיה / משוב' });
    expect(within(dialog).getAllByRole('radio')).toHaveLength(7);
    expect(within(dialog).getByText(/גרסה v\d+/)).toBeInTheDocument();
    expect(within(dialog).getByText('שלב s3')).toBeInTheDocument();
    // §5.4's five auto-context fields are all on screen; the item and its type are the header,
    // the rest are the "נשמר אוטומטית" line. A-4: both read as labels, not as the slug and the
    // bare storage letter — the type appears as the same `TypeBadge` the article header uses.
    expect(within(dialog).getByText(fx.docBrowsing.title)).toBeInTheDocument();
    expect(within(dialog).getByTitle('תסריט')).toBeInTheDocument();
    expect(within(dialog).getByText(/עולם תמיכה טכנית/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'שלח' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'התהליך לא עובד בפועל' }));
    await userEvent.type(within(dialog).getByRole('textbox'), 'השדה כבר לא קיים');
    await userEvent.click(within(dialog).getByRole('button', { name: 'שלח' }));
    await waitFor(() => expect(feedbackState.items).toHaveLength(1));
    expect(feedbackState.items[0]).toMatchObject({
      kind: 'process_fails',
      text: 'השדה כבר לא קיים',
      stepKey: 's3',
    });
    expect(await screen.findByText('תודה! המשוב נשלח לעורכי התוכן')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('caps the note at 1000 characters', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'דיווח על בעיה / משוב' }));
    const box = await screen.findByRole('textbox');
    expect(box).toHaveAttribute('maxLength', '1000');
  });
});
