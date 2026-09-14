/**
 * L4 parity walk — the global keyboard map.
 *
 * Evidence for the legacy side: `docs/parity/legacy-keymap.png` (the `?` card) and the handlers in
 * `legacy/js/nav.js`. Rows in `docs/parity-l4.md`.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { D_BROWSING, D_INTL } from '../msw/fixtures.js';

describe('parity · Ctrl D', () => {
  /**
   * Legacy `KB.toggleTheme` ends with `KB.toast(theme === 'dark' ? '◐ מצב כהה' : '○ מצב בהיר')`.
   * Ctrl D is pressed without looking at the screen — often on a laptop in a dim room where the
   * two themes are hard to tell apart at a glance — so the confirmation is the feedback that the
   * chord landed at all.
   */
  it('says which mode it switched to', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await screen.findAllByText('ספריית ידע');

    await userEvent.keyboard('{Control>}d{/Control}');
    expect(await screen.findByText('◐ מצב כהה')).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));

    await userEvent.keyboard('{Control>}d{/Control}');
    expect(await screen.findByText('○ מצב בהיר')).toBeInTheDocument();
  });
});

describe('parity · Ctrl \\ (split screen)', () => {
  /** Legacy: `KB.toast('פיצול מסך זמין מתוך מסמך', 'warn')` — the port returned silently. */
  it('says split screen needs a document when pressed anywhere else', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await screen.findAllByText('ספריית ידע');

    await userEvent.keyboard('{Control>}\\{/Control}');
    expect(await screen.findByText('פיצול מסך זמין מתוך מסמך')).toBeInTheDocument();
  });

  /**
   * Legacy `toggleSplit`: with no other document to put on the other side it opened the palette in
   * `split` mode — "איזה מסמך להציג לצד הנוכחי?" — rather than doing nothing. A single open tab is
   * the normal state at the start of a shift, so the port's silent return meant the chord appeared
   * broken exactly when it was first tried.
   */
  it('asks which document to show beside this one when there is no second tab', async () => {
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await screen.findByRole('heading', { name: /איטיות גלישה/ });

    await userEvent.keyboard('{Control>}\\{/Control}');
    expect(
      await screen.findByPlaceholderText('איזה מסמך להציג לצד הנוכחי?'),
    ).toBeInTheDocument();
  });

  /** Legacy: closing the split confirms it — `KB.toast('פיצול מסך בוטל')`. */
  it('confirms when the split is closed again', async () => {
    // Two open tabs is the state in which Ctrl \ picks the other side by itself.
    sessionStorage.setItem(
      'kb.tabs',
      JSON.stringify([
        { docId: D_BROWSING, title: 'איטיות גלישה' },
        { docId: D_INTL, title: 'אין גלישה בחו"ל' },
      ]),
    );
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await screen.findByRole('heading', { name: /איטיות גלישה/ });

    await userEvent.keyboard('{Control>}\\{/Control}');
    await waitFor(() => expect(document.querySelector('.splitwrap')).not.toBeNull());

    await userEvent.keyboard('{Control>}\\{/Control}');
    expect(await screen.findByText('פיצול מסך בוטל')).toBeInTheDocument();
    expect(document.querySelector('.splitwrap')).toBeNull();
  });
});
