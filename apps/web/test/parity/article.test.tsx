/**
 * L4 parity walk — the article page's "connected card" affordances.
 *
 * Evidence for the legacy side: `docs/parity/legacy-article-call.png`, `KB.renderStep` and
 * `KB.peek` in `legacy/js/views-article.js` / `legacy/js/nav.js`. Rows in `docs/parity-l4.md`.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { D_BROWSING } from '../msw/fixtures.js';

describe('parity · step CRM notes', () => {
  /**
   * Legacy `crmNote`: `'שדה CRM · ' + status + ' · ב-' + KB.fieldUsage(f).length + ' מסמכים'`.
   *
   * The count is the load-bearing half. "תקין" alone says the field exists; "ב-9 מסמכים" is what
   * tells an editor reading a step whether renaming it is a one-line edit or a morning's work,
   * and it is the number the CRM-fields screen is built around. `GET /fields` already returns
   * `usedIn` per field — the article simply was not rendering it.
   */
  it('says in how many documents an action’s CRM field is used', async () => {
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}/s11` });
    await screen.findByRole('heading', { name: /איטיות גלישה/ });

    const note = await waitFor(() => {
      const el = document.querySelector('.step.cur .act .fnote');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(note.textContent).toBe('שדה CRM · תקין · ב-1 מסמכים');
  });
});

describe('parity · hover peek', () => {
  /**
   * Legacy `peek.show` computes `KB.sharedWith(current, hovered)` and, when the two documents
   * embed the same block, replaces the description with
   * `'משתף איתך: ⧉ <block> (שלב <num>)'`.
   *
   * That line is the whole point of the peek during a call: the description says what the other
   * document is about, the shared-block line says what it has in common with the one on screen —
   * which is the reason to open it side by side rather than instead.
   */
  it('says which block the hovered document shares with this one', async () => {
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await screen.findByRole('heading', { name: /איטיות גלישה/ });

    const link = await waitFor(() => {
      const el = document.querySelector('a.rel[data-doc]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    await userEvent.hover(link);

    const peek = await waitFor(() => {
      const el = document.querySelector('.peek .s');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    await waitFor(() => expect(peek.textContent).toContain('משתף איתך'));
    expect(peek.textContent).toContain('⧉ ריענון SIM');
  });
});
