/**
 * L8 — the local sections are a live read of the cache, not a snapshot taken when the palette opened.
 *
 * Below `MIN_SEARCH_CHARS` the palette answers out of whatever `['documents', …]` queries have
 * already settled. That read lived in a `useMemo` keyed on the query client — an object that never
 * changes — so the palette photographed the cache once and kept the photograph. The case that
 * breaks: open `/doc/:id` cold, press `Ctrl K` before the sidebar's document list has answered, and
 * type two letters. The list arrives a moment later and the palette goes on showing nothing, until
 * some unrelated keystroke happens to move a dependency.
 *
 * So this test opens the palette *before* the documents request resolves, and asserts the rows
 * appear on their own.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { server } from '../msw/server.js';
import { state } from '../msw/handlers.js';
import { D_BROWSING, cards } from '../msw/fixtures.js';
import { LOCAL_GROUP_LABELS } from '../../src/components/palette/localHits.js';

/** Held open until the test lets go, so "the list has not answered yet" is a real state. */
let release: () => void;
let listed: Promise<void>;

beforeEach(() => {
  listed = new Promise<void>((r) => {
    release = r;
  });
  server.use(
    http.get('/api/v1/documents', async () => {
      await listed;
      return HttpResponse.json({
        items: cards.map((c) => ({ ...c, pinned: state.pins.has(c.id) })),
        total: cards.length,
        page: 1,
        pageSize: 50,
      });
    }),
  );
});
afterEach(() => server.resetHandlers());

describe('the palette opened before the document list has answered', () => {
  it('fills its local sections when the list arrives, with no further keystroke', async () => {
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await userEvent.keyboard('{Control>}k{/Control}');
    const input = await screen.findByPlaceholderText(/חפש מסמך/);
    await userEvent.type(input, 'גל');
    // Nothing is cached yet, so there is nothing local to show — this is the "cold" state.
    await waitFor(() => expect(document.querySelector('.palette .hint')).not.toBeNull());
    // Past the 120 ms debounce, so `debounced` has already settled and cannot be what recomputes
    // the row list later — otherwise this test would pass on the stale snapshot too.
    await new Promise((r) => setTimeout(r, 300));
    expect(document.querySelectorAll('.res .ri[aria-label]')).toHaveLength(0);

    release();

    // The palette is untouched from here on: no typing, no clicking. If the rows appear, the read
    // is live.
    await waitFor(() => expect(document.querySelectorAll('.res .ri[aria-label]').length).toBeGreaterThan(0));
    const labels = Object.values(LOCAL_GROUP_LABELS);
    expect(labels.some((l) => screen.queryAllByText(l).length > 0)).toBe(true);
  });
});
