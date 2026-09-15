/**
 * The concrete dialog/label defects the acceptance review names in §3 and §4.
 *
 * There is no "accessibility" heading in the review to work from; what it names are A-4 (the
 * doc-type letter leaking raw in the feedback modal, "same component family, two spellings"), E-6
 * (the save dialog whose scrim covers an editor still reading `שינויים לא שמורים`, so the two
 * together "read as 'the save failed' for a second"), and — by praise rather than complaint — §3's
 * standard for a dialog: "a proper `role="dialog"` with `aria-modal` and a Hebrew label".
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { D_BROWSING, fx } from '../msw/fixtures.js';
import { docTypeLabel } from '../../src/components/taxonomy/TypeBadge.js';
import { StepCollab } from '../../src/components/article/StepCollab.js';

describe('A-4 · the doc type reads the same everywhere', () => {
  it('spells the letter out instead of printing the storage code', () => {
    expect(docTypeLabel('T')).toBe('T · תסריט');
    expect(docTypeLabel('M')).toBe('M · אבחון');
  });

  it('degrades to the code itself for a type it does not know', () => {
    // The feedback payload carries whatever the API stored; `T · undefined` would be worse than
    // the bare letter this was meant to replace.
    expect(docTypeLabel('Z')).toBe('Z');
  });

  /**
   * M3 — this used to assert `not.toMatch(/סוג [A-Z](?! ·)/)` against the `נשמר אוטומטית` line,
   * which stopped carrying the type the day it moved into the dialog's header: the regex was
   * being run over a string that could not contain what it was looking for, so it passed whatever
   * the dialog rendered. What A-4 is actually about — the type as a badge rather than as `סוג T` —
   * has real coverage in `test/feedback/FeedbackButton.test.tsx`, which mounts the button with an
   * explicit `docType` (`docBrowsing` predates the field and carries none, which is the other
   * reason this spec could never have seen a badge).
   *
   * What this spec is placed to see is the *App*: that opening the dialog from a real article
   * names the item being reported on, and that no surface anywhere in it prints the storage code
   * on its own.
   */
  it('names the item in the dialog header, and prints no bare storage code anywhere', async () => {
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    const open = await screen.findAllByRole('button', { name: 'דיווח על בעיה / משוב' });
    await userEvent.click(open[0]);
    const dialog = await screen.findByRole('dialog', { name: 'דיווח על בעיה / משוב' });

    // The header (`subtitle`) is what tells an agent — on a phone, where the modal covers the
    // article — which item they are about to report on.
    expect(within(dialog).getByText(fx.docBrowsing.title)).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/סוג [A-Z]\b/);
    // Whatever type chip a document does carry spells its label out; `docTypeLabel` is the one
    // formatter for that, and `T` alone is never what it produces for a known code.
    expect(docTypeLabel('T')).toContain(' · ');

    // The world reads as its Hebrew label too, for the same reason the type does — and it is on
    // the autosave line, which is the one thing the old assertion did look at.
    const context = within(dialog).getByText(/^נשמר אוטומטית/).parentElement as HTMLElement;
    expect(context.textContent).toContain('תמיכה טכנית');
  });
});

describe('§3 · a dialog is role + aria-modal + a Hebrew label + a focus trap', () => {
  const scripts = [{ id: 's1', title: 'נוסח', text: 'הסבר ללקוח שהחבילה הסתיימה', usedIn: 2 }];

  const openPicker = async () => {
    renderWithProviders(
      <StepCollab
        documentId={fx.docBrowsing.id}
        stepKey="s1"
        comments={[]}
        scripts={scripts}
        onInsertScript={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'הסבר ללקוח' }));
    return screen.findByRole('dialog', { name: 'תסריטים לשלב זה' });
  };

  it('the script picker declares aria-modal, which it claimed the role without', async () => {
    const dialog = await openPicker();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('it takes focus when it opens, so the keyboard is inside it', async () => {
    const dialog = await openPicker();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('Escape closes it', async () => {
    const dialog = await openPicker();
    expect(dialog).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'תסריטים לשלב זה' })).not.toBeInTheDocument(),
    );
  });
});
