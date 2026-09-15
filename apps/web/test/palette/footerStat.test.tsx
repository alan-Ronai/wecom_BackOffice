/**
 * M4 — the palette footer may not invent a measurement.
 *
 * Below `MIN_SEARCH_CHARS` the palette deliberately does not call `GET /search`; it answers out of
 * the query cache instead. The footer went on printing a search stat anyway, assembled from
 * whatever was to hand: `selectable.length` — which counts the local *actions* as if they were
 * results — then `ב-0 קבצים`, then a `1ms` no query ever took. An operator reading
 * "7 תוצאות ב-0 קבצים · 1ms" has been told the corpus was searched and is holding nothing.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';

/** Waits for the library list to answer, so its cards really are in the cache the palette reads. */
const openPalette = async () => {
  await screen.findAllByText(/איטיות גלישה/);
  await userEvent.keyboard('{Control>}k{/Control}');
  return screen.findByPlaceholderText(/חפש מסמך/);
};

const stat = () => document.querySelector('.foot .stat')?.textContent ?? '';
/** Result rows carry an `aria-label`; the local action rows do not. */
const hitRows = () => document.querySelectorAll('.res .ri[aria-label]').length;
const actionRows = () => document.querySelectorAll('.res .ri:not([aria-label])').length;

describe('the palette footer stat', () => {
  it('says nothing about an empty query, where the rows are actions and not results', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await openPalette();
    await waitFor(() => expect(actionRows()).toBeGreaterThan(0));
    expect(hitRows()).toBe(0);
    // Six shortcuts are not "six results", and there is no search to report on.
    expect(document.querySelector('.foot .stat')).toBeNull();
  });

  it('counts the local rows, with no files and no timing, for a query that was never sent', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const input = await openPalette();
    await userEvent.type(input, 'גל');
    // The hint below the input is the palette's own signal that it is in the short-query state.
    await waitFor(() => expect(document.querySelector('.palette .hint')).not.toBeNull());
    await waitFor(() => expect(hitRows()).toBeGreaterThan(0));

    expect(stat()).not.toMatch(/קבצים/);
    expect(stat()).not.toMatch(/ms/);
    const shown = Number(/\d+/.exec(stat())?.[0] ?? NaN);
    // One and two are spelled out in Hebrew rather than written as digits; assert the number only
    // when there is a number to read, and that it is the *hits* — never the actions beside them.
    if (!Number.isNaN(shown)) expect(shown).toBe(hitRows());
  });

  it('still shows the server’s own numbers once the query is long enough to send', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const input = await openPalette();
    await userEvent.type(input, 'sim');
    await waitFor(() => expect(stat()).toMatch(/קבצים/));
    expect(stat()).toMatch(/\d+ms$/);
  });
});
