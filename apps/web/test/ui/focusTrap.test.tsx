/**
 * Dialog focus management, the part that is invisible until you put the mouse down.
 *
 * `role="dialog"` plus an `Escape` handler is a dialog for a mouse. What a keyboard needs is the
 * three things below, and the reason they are tested together is that any one of them alone is
 * useless: focus that enters and cannot leave is a trap; focus that leaves and never returns
 * drops the user at the top of the page; and a page behind that is still in the accessibility
 * tree means a screen reader narrates a library the user cannot see.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ModalProvider, useModal } from '../../src/components/ui/Modal.js';

function Harness() {
  const modal = useModal();
  const [answer, setAnswer] = useState<string>('—');
  return (
    <>
      <button onClick={() => void modal.confirm('למחוק?', 'הפעולה בלתי הפיכה').then((v) => setAnswer(String(v)))}>
        פתח דיאלוג
      </button>
      <button>כפתור ברקע</button>
      <span data-testid="answer">{answer}</span>
    </>
  );
}

const open = async () => {
  render(
    <ModalProvider>
      <Harness />
    </ModalProvider>,
  );
  const opener = screen.getByRole('button', { name: 'פתח דיאלוג' });
  await userEvent.click(opener);
  return { opener, dialog: await screen.findByRole('dialog') };
};

describe('<Modal> focus management', () => {
  it('announces itself as modal', async () => {
    const { dialog } = await open();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('למחוק?');
  });

  it('moves focus into the dialog when it opens', async () => {
    const { dialog } = await open();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('keeps Tab inside the dialog instead of walking into the page behind', async () => {
    const { dialog } = await open();
    const background = screen.getByRole('button', { name: 'כפתור ברקע' });

    // Enough tabs to have walked out several times over if nothing were holding them.
    for (let i = 0; i < 8; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).not.toBe(background);
    }
    // Shift+Tab wraps the other way and stays inside too.
    for (let i = 0; i < 4; i++) {
      await userEvent.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('restores focus to the control that opened it', async () => {
    const { opener } = await open();
    await userEvent.click(screen.getByRole('button', { name: 'ביטול' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
  });

  it('restores focus after Escape, too', async () => {
    const { opener } = await open();
    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
    // Escape resolves `confirm` as a decline, as its first button does.
    expect(screen.getByTestId('answer')).toHaveTextContent('false');
  });
});
