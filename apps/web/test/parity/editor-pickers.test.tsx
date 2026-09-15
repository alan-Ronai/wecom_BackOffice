/**
 * L4 parity walk — the two editor quick-commands the port has not ported yet.
 *
 * Skipped rather than deleted — vitest's spelling of `test.fixme`. The gap is real and these
 * assertions are its acceptance criteria; the fix is larger than a parity-walk patch (see
 * `docs/parity-l4.md`, "gaps left open") because it needs two picker dialogs plus their
 * slash-command and inline-adder wiring. Whoever closes it flips `it.skip` back to `it`.
 *
 * Legacy (`legacy/js/views-editor.js`):
 *
 *   addBasic('crm')  → pickCrm()  → modal "שדה CRM", a <select> over `crm-fields.json`,
 *                                   appends the action `פתח CRM ↗ שדה <name>`
 *   addBasic('link') → pickDoc()  → modal "קישור למסמך", a <select> over every other document,
 *                                   appends the action `המשך לפי [[doc:<id>]]`
 *
 * Both are reachable two ways: the step's inline adder row (`+ שדה CRM`, `+ קישור`, beside the
 * `+ הסתעפות` / `+ תסריט` / `+ תיאור` the port does have) and the drop zone's `/` menu
 * (`CRM שדה`, `↗ קישור למסמך`).
 *
 * Nothing about the *capability* is missing — `<Fmt>` still detects a CRM field in free text and
 * still resolves `[[doc:id]]`, and the action input's placeholder says so. What is missing is
 * being able to pick one instead of typing the exact field name or a raw uuid from memory, which
 * is the entire reason the pickers existed.
 *
 * Evidence: `docs/parity/legacy-editor.png`.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { D_BROWSING } from '../msw/fixtures.js';

const openEditor = async () => {
  renderWithProviders(<App />, { route: `/edit/${D_BROWSING}` });
  return screen.findByDisplayValue(/איטיות גלישה/);
};

describe('parity · editor quick commands (gap)', () => {
  it('picks a CRM field into an action instead of asking for its exact name', async () => {
    await openEditor();
    await userEvent.click(await screen.findByText('+ שדה CRM'));

    const dialog = await screen.findByRole('dialog', { name: 'שדה CRM' });
    await userEvent.selectOptions(await screen.findByLabelText('בחר שדה מ-crm-fields.json'), 'sim block lbl');
    await userEvent.click(await screen.findByRole('button', { name: 'הוסף' }));
    expect(dialog).not.toBeInTheDocument();

    expect(await screen.findByDisplayValue('פתח CRM ↗ שדה sim block lbl')).toBeInTheDocument();
  });

  it('picks the target document of a link instead of asking for its id', async () => {
    await openEditor();
    await userEvent.click(await screen.findByText('+ קישור'));

    await screen.findByRole('dialog', { name: 'קישור למסמך' });
    await userEvent.selectOptions(await screen.findByLabelText('מסמך יעד'), 'אין גלישה בחו"ל');
    await userEvent.click(await screen.findByRole('button', { name: 'קשר' }));

    expect(await screen.findByDisplayValue(/המשך לפי \[\[doc:/)).toBeInTheDocument();
  });

  it('offers both from the drop zone’s / menu, as legacy did', async () => {
    await openEditor();
    await userEvent.type(await screen.findByPlaceholderText(/לפקודה מהירה|\//), '/');

    const menu = document.querySelector('.slash');
    expect(menu?.textContent).toContain('CRM שדה');
    expect(menu?.textContent).toContain('↗ קישור למסמך');
  });
});
