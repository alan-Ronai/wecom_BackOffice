/**
 * L4 parity walk — call mode.
 *
 * Each case pins one behaviour of `legacy/js/views-article.js` that the React port has to
 * reproduce. Evidence for the legacy side: `docs/parity/legacy-article-call.png` and the row in
 * `docs/parity-l4.md`.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { D_BROWSING } from '../msw/fixtures.js';

const curStep = () => document.querySelector('.step.cur')?.getAttribute('data-step');

describe('parity · call mode', () => {
  /**
   * Legacy `pickOutcome`: when the chosen outcome has no `goto` and the step is the last one,
   * there is no next step to advance to, so the call ends with
   * `KB.toast('✓ סיום המסמך · הסיכום מוכן להעתקה', 'ok')`.
   *
   * The port advanced silently and left the agent on the last step with no signal that the
   * document was finished and the CRM summary was ready — the one moment in a call where the
   * next action (C, copy to the CRM) is not on screen anywhere else.
   */
  it('says the document is finished when the last outcome is picked', async () => {
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}/s13` });
    await screen.findByRole('heading', { name: /איטיות גלישה/ });
    await waitFor(() => expect(curStep()).toBe('s13'));

    await userEvent.keyboard('1'); // "✓ הסתדר – סיום", no goto, last step in the document

    expect(await screen.findByText('✓ סיום המסמך · הסיכום מוכן להעתקה')).toBeInTheDocument();
    // …and the call stays where it is rather than jumping back to the top.
    expect(curStep()).toBe('s13');
  });

  /** The same outcome mid-document still just advances, with no end-of-call claim. */
  it('does not claim the document is finished mid-way through it', async () => {
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}/s3` });
    await screen.findByRole('heading', { name: /איטיות גלישה/ });
    await waitFor(() => expect(curStep()).toBe('s3'));

    await userEvent.keyboard('1');
    await waitFor(() => expect(curStep()).toBe('s4'));
    expect(screen.queryByText('✓ סיום המסמך · הסיכום מוכן להעתקה')).toBeNull();
  });
});
