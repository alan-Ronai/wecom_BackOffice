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

  it('the feedback modal shows "סוג T · תסריט", not "סוג T"', async () => {
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    const open = await screen.findAllByRole('button', { name: 'דיווח על בעיה / משוב' });
    await userEvent.click(open[0]);
    const dialog = await screen.findByRole('dialog', { name: 'דיווח על בעיה / משוב' });
    const context = within(dialog).getByText(/^נשמר אוטומטית/).parentElement as HTMLElement;
    expect(context.textContent).not.toMatch(/סוג [A-Z](?! ·)/);
    // The world reads as its Hebrew label too, for the same reason the type does.
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
