/**
 * L4 parity walk — the settings dialog (the design's "Plex Hebrew bidi type system" card).
 *
 * Evidence for the legacy side: `docs/parity/legacy-settings.png`. Row in `docs/parity-l4.md`.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';

const openSettings = async () => {
  await screen.findAllByText('ספריית ידע');
  await userEvent.click(await screen.findByTitle('הגדרות'));
  return screen.findByRole('dialog', { name: /תצוגה וטיפוגרפיה/ });
};

describe('parity · settings', () => {
  /**
   * Legacy `KB.showSettings` renders a two-column `.type-rules` card under the live sample: the
   * typography rules (families, weights, tabular numerals) and the bidi rules (every Latin
   * identifier, number and path inside `<bdi dir="ltr">`, CRM fields as fixed-direction chips).
   *
   * That card *is* the specification the whole app's `<Fmt>` output follows, and it is the only
   * place it is written down for a reader. The port carried the stylesheet (`.type-rules` is
   * still in `app.css`) but nothing rendered into it.
   */
  it('carries the typography and bidi rules card', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const dialog = await openSettings();

    const rules = dialog.querySelector('.type-rules');
    expect(rules).not.toBeNull();
    expect(rules!.textContent).toContain('כללי טיפוגרפיה');
    expect(rules!.textContent).toContain('כללי bidi');
    // The rules describe `<bdi dir="ltr">`, so they are themselves written with it.
    expect(rules!.querySelectorAll('bdi.lat').length).toBeGreaterThan(0);
  });
});
