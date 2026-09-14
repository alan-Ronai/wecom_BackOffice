import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { ModalProvider } from '../../src/components/ui/Modal.js';
import { ToastProvider } from '../../src/components/ui/Toast.js';
import { FeedbackButton } from '../../src/components/feedback/FeedbackButton.js';
import { feedbackState } from '../msw/feedback-handlers.js';
import { fx } from '../msw/fixtures.js';

const mount = (stepKey?: string) =>
  renderWithProviders(
    <ToastProvider>
      <ModalProvider>
        <FeedbackButton
          documentId={fx.docBrowsing.id}
          documentVersion={fx.docBrowsing.currentVersion}
          stepKey={stepKey}
        />
      </ModalProvider>
    </ToastProvider>,
  );

describe('<FeedbackButton>', () => {
  it('opens the seven kinds with the read-only context and submits without extra input', async () => {
    mount('s3');
    await userEvent.click(screen.getByRole('button', { name: 'דיווח על בעיה / משוב' }));
    const dialog = await screen.findByRole('dialog', { name: 'דיווח על בעיה / משוב' });
    expect(within(dialog).getAllByRole('radio')).toHaveLength(7);
    expect(within(dialog).getByText(/גרסה v\d+/)).toBeInTheDocument();
    expect(within(dialog).getByText('שלב s3')).toBeInTheDocument();
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
