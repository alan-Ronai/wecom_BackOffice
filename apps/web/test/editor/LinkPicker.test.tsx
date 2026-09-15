/**
 * H2 — the link picker at pilot scale.
 *
 * Two halves of one defect, both invisible while the mock returned the whole corpus to every
 * request: the picker searched only what page 1 happened to contain, and the editor named a
 * `[[doc:<uuid>]]` target from that same page — so an action pointing anywhere else read back as
 * a raw uuid, which is the G10 defect the pickers exist to prevent, reinstated on the writing side.
 *
 * So these tests put the mock on a page budget. `GET /documents` without `q` answers one card, the
 * way the real route answers 50 out of a corpus that is much larger; with `q` it searches the whole
 * set, the way the real route does. Under that — and only under that — "can the picker see the rest
 * of the library" is a question with a real answer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { server } from '../msw/server.js';
import { state } from '../msw/handlers.js';
import { D_BROWSING, D_INTL, cards, docBrowsing } from '../msw/fixtures.js';

const B = '/api/v1';
/** The card every unfiltered listing returns; everything else is "past page 1". */
const ON_PAGE = cards.filter((c) => c.id === D_BROWSING);
const FAR_TITLE = 'אין גלישה בחו"ל';

/** Every `GET /documents` query string the app sent, so "did it search the server" is checkable. */
let queries: string[] = [];

beforeEach(() => {
  queries = [];
  server.use(
    http.get(`${B}/documents`, ({ request }) => {
      const u = new URL(request.url);
      queries.push(u.search);
      const q = u.searchParams.get('q')?.trim().toLowerCase();
      const items = (
        q
          ? cards.filter((c) => [c.title, c.description].some((v) => (v ?? '').toLowerCase().includes(q)))
          : ON_PAGE
      ).map((c) => ({ ...c, pinned: state.pins.has(c.id) }));
      return HttpResponse.json({ items, total: cards.length, page: 1, pageSize: 1 });
    }),
  );
});
afterEach(() => server.resetHandlers());

const openEditor = async () => {
  renderWithProviders(<App />, { route: `/edit/${D_BROWSING}` });
  return screen.findByDisplayValue(/איטיות גלישה/);
};

const openLinkPicker = async () => {
  await openEditor();
  await userEvent.click(await screen.findByText('+ קישור'));
  return screen.findByRole('dialog', { name: 'קישור למסמך' });
};

describe('link picker · searching the corpus', () => {
  it('sends the typed query to GET /documents instead of filtering page 1', async () => {
    await openLinkPicker();
    const list = await screen.findByLabelText('מסמך יעד');
    // Before anything is typed the picker sees only what the page returned.
    expect(within(list).queryByRole('option', { name: FAR_TITLE })).not.toBeInTheDocument();

    await userEvent.type(await screen.findByLabelText('חפש מסמך לפי כותרת'), 'חו"ל');

    // The document exists in the corpus but not on page 1, so it can only appear if the query
    // reached the server.
    expect(await within(list).findByRole('option', { name: FAR_TITLE })).toBeInTheDocument();
    expect(queries.some((s) => s.includes(`q=${encodeURIComponent('חו"ל')}`))).toBe(true);
  });

  it('names the document it just linked, rather than leaving the uuid on screen', async () => {
    await openLinkPicker();
    await userEvent.type(await screen.findByLabelText('חפש מסמך לפי כותרת'), 'חו"ל');
    const list = await screen.findByLabelText('מסמך יעד');
    await within(list).findByRole('option', { name: FAR_TITLE });
    await userEvent.selectOptions(list, FAR_TITLE);
    await userEvent.click(screen.getByRole('button', { name: 'קשר' }));

    // The token is id-only by design, so the title beside it is the only readable thing about it.
    expect(await screen.findByDisplayValue(`המשך לפי [[doc:${D_INTL}]]`)).toBeInTheDocument();
    expect(await screen.findByText(`↗ ${FAR_TITLE}`)).toBeInTheDocument();
  });
});

describe('link picker · links that are already in the document', () => {
  it('resolves an off-page target by id, the way the reader does', async () => {
    // A link that was saved by somebody else, long before this editing session: nothing in the
    // page-1 card list can name it, and nobody is going to re-pick it to find out what it is.
    const withLink = structuredClone(docBrowsing);
    withLink.phases[0]!.steps[0]!.actions.push({ id: 'a-link', text: `המשך לפי [[doc:${D_INTL}]]` });
    state.documents.set(D_BROWSING, withLink);

    await openEditor();
    expect(await screen.findByText(`↗ ${FAR_TITLE}`)).toBeInTheDocument();
  });
});
