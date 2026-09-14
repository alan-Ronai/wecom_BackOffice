/**
 * m3, end to end through the real screens: two article panes, one keyboard.
 *
 * The registry-level properties are in `test/lib/keys.test.tsx`. What this file adds is that the
 * *screens* actually claim and release the scope — the part a synthetic Binder cannot show, and the
 * part the deferred fix was really about: a click in a pane has to be enough, without focus landing
 * inside it, because during a call nothing in either pane is focused.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { D_BROWSING, D_INTL, fx } from '../msw/fixtures.js';

const INTL_TITLE = fx.docIntl.title;
const LEFT_TITLE = fx.docBrowsing.title;
const panes = () => Array.from(document.querySelectorAll<HTMLElement>('.splitwrap > .pane'));
const curStepIn = (pane: HTMLElement) => pane.querySelector('.step.cur')?.getAttribute('data-step');
const paneTitle = (pane: HTMLElement) => within(pane).getByText(INTL_TITLE, { selector: '.pane-head b' });

/**
 * Two open tabs, then `Ctrl \` — which is what `toggleSplit` needs: it pairs the document in the
 * URL with the other open tab. The tabs are seeded through `sessionStorage`, where `navStore`
 * already restores them from, so the setup is one state write rather than a palette search whose
 * result ranking these tests are not about.
 */
async function openSplit() {
  sessionStorage.setItem(
    'kb.tabs',
    JSON.stringify([
      { docId: D_BROWSING, title: LEFT_TITLE },
      { docId: D_INTL, title: INTL_TITLE },
    ]),
  );
  sessionStorage.setItem('kb.activeTab', '0');
  renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
  await screen.findByRole('heading', { name: /איטיות גלישה/ });

  await userEvent.keyboard('{Control>}\\{/Control}');
  await waitFor(() => expect(panes()).toHaveLength(2));
  return panes();
}

describe('split view — which pane the keyboard drives', () => {
  it('starts on the left pane and follows a click to the right one', async () => {
    const [left, right] = await openSplit();
    await waitFor(() => expect(curStepIn(left)).toBe('s1'));

    // Opening the split claims the pane the operator was already reading.
    expect(left).toHaveAttribute('aria-current', 'true');
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(curStepIn(left)).toBe('s2'));
    const rightBefore = curStepIn(right);

    // One click in the other pane, and nothing inside it focused — which is the whole point.
    await userEvent.click(paneTitle(right));
    expect(right).toHaveAttribute('aria-current', 'true');
    expect(left).toHaveAttribute('aria-current', 'false');

    await userEvent.keyboard('{ArrowDown}');
    // The right pane moved and the left one stayed exactly where it was — before this, the left
    // pane took every arrow regardless of where the last click landed.
    await waitFor(() => expect(curStepIn(right)).not.toBe(rightBefore));
    expect(curStepIn(left)).toBe('s2');
  });

  it('hands the keys back to the single article when the split closes', async () => {
    const [, right] = await openSplit();
    await userEvent.click(paneTitle(right));

    await userEvent.click(screen.getByRole('button', { name: '✕ סגור פיצול' }));
    await waitFor(() => expect(panes()).toHaveLength(0));

    // A split closed while the right pane held the keyboard used to leave call mode addressed to a
    // pane that no longer exists: the screen looks normal and the arrows do nothing.
    await waitFor(() => expect(document.querySelector('.step.cur')).not.toBeNull());
    const before = document.querySelector('.step.cur')?.getAttribute('data-step');
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(document.querySelector('.step.cur')?.getAttribute('data-step')).not.toBe(before),
    );
  });

  it('keeps the right pane out of the URL — only one document can be named there', async () => {
    const [left, right] = await openSplit();
    await userEvent.click(paneTitle(right));
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    // A second `useCall` writing its own step into the URL would have navigated the split away the
    // moment somebody pressed an arrow in it: the split closes and the right document takes over
    // the whole screen. Both panes are still here, and the left one is still the left one.
    await waitFor(() => expect(panes()).toHaveLength(2));
    expect(within(left).getByText(LEFT_TITLE, { selector: '.pane-head b' })).toBeInTheDocument();
  });
});
