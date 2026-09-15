/**
 * L4 parity walk — the browser tab title.
 *
 * Legacy `render()` and the `hashchange` handler both ended with
 * `document.title = 'wecom | ' + nav.titleOf(r)`, so the tab, the OS window switcher, the browser
 * history and any bookmark all named the screen that was open. Row in `docs/parity-l4.md`.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { D_BROWSING } from '../msw/fixtures.js';

describe('parity · document.title', () => {
  it('names the open screen, and the open document by its title', async () => {
    renderWithProviders(<App />, { route: '/trash' });
    await waitFor(() => expect(document.title).toBe('wecom | סל מיחזור'));

    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await screen.findByRole('heading', { name: /איטיות גלישה/ });
    // The article reports its real title once the document has loaded.
    await waitFor(() => expect(document.title).toContain('איטיות גלישה'));
  });

  it('follows a navigation rather than sticking on the first screen', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await screen.findAllByText('ספריית ידע');
    await waitFor(() => expect(document.title).toBe('wecom | ספרייה'));

    await userEvent.click(await screen.findByRole('button', { name: /סל מיחזור/ }));
    await waitFor(() => expect(document.title).toBe('wecom | סל מיחזור'));
  });
});
