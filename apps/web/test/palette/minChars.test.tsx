/**
 * The three-character floor on `GET /search`.
 *
 * `docs/perf.md` § "What stays broken": `ilike '%חב%'` cannot use migration 0044's trigram indexes
 * — a two-character pattern has no trigram — so every short keystroke costs a full scan of the
 * search expressions, per client, on every call. The client's half of the fix is to stop asking.
 *
 * These specs assert the request count directly, off msw's own request stream, because the thing
 * under test is the absence of a round trip: an assertion on what is rendered would pass just as
 * happily if the request went out and its answer were thrown away.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { server } from '../msw/server.js';
import { LOCAL_GROUP_LABELS } from '../../src/components/palette/localHits.js';

/** Every `GET /search` msw saw, in order, by its `q`. */
let sent: string[] = [];
const record = ({ request }: { request: Request }): void => {
  const u = new URL(request.url);
  if (u.pathname === '/api/v1/search') sent.push(u.searchParams.get('q') ?? '');
};

beforeEach(() => {
  sent = [];
  server.events.on('request:start', record);
});
afterEach(() => server.events.removeListener('request:start', record));

/** Waits for the library list to have answered, so its cards really are in the query cache. */
const openPalette = async () => {
  await screen.findAllByText(/איטיות גלישה/);
  await userEvent.keyboard('{Control>}k{/Control}');
  return screen.findByPlaceholderText(/חפש מסמך/);
};

/**
 * The palette debounces at 120 ms. Waiting past it is what makes "no request" mean the gate and
 * not the debounce: without the gate, the query would have settled and gone out inside this wait.
 */
const pastTheDebounce = () => new Promise((r) => setTimeout(r, 400));

describe('palette · the three-character floor', () => {
  it('sends nothing to the server for a two-character Hebrew query', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const input = await openPalette();

    await userEvent.type(input, 'חב');
    expect(await screen.findByText(/הקלידו לפחות 3 תווים/)).toBeInTheDocument();
    await pastTheDebounce();

    expect(sent).toEqual([]);
  });

  it('sends the query once the third character arrives', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const input = await openPalette();

    await userEvent.type(input, 'si');
    await pastTheDebounce();
    expect(sent).toEqual([]);

    await userEvent.type(input, 'm');
    await waitFor(() => expect(sent).toEqual(['sim']));
    expect(screen.queryByText(/הקלידו לפחות 3 תווים/)).not.toBeInTheDocument();
  });

  it('answers a short query out of the documents already in the cache', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const input = await openPalette();

    // Two characters of a card the library page has already loaded — `איטיות גלישה / חוסר גלישה`,
    // which the fixtures mark pinned.
    await userEvent.type(input, 'אי');

    // `hi()` splits the matched prefix into its own <mark>, so read whole rows, not text nodes.
    const row = await waitFor(() => {
      const res = document.querySelector('.palette .res') as HTMLElement;
      expect(res.textContent).toContain(LOCAL_GROUP_LABELS.pinned);
      const found = [...res.querySelectorAll('.ri')].find((el) => el.textContent?.includes('חוסר גלישה'));
      expect(found).toBeTruthy();
      return found!;
    });
    // A local row is a document hit, labelled and openable exactly like a server one.
    expect(row.getAttribute('aria-label')).toMatch(/^מסמך · איטיות גלישה/);

    await pastTheDebounce();
    expect(sent).toEqual([]);
  });
});
