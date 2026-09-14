/**
 * Review item **I10**: pin state, `[[doc:…]]` reference resolution and the hover peek must not
 * depend on the first page of `GET /documents`.
 *
 * The API pages the library at 50. Every test here makes the *unpaged* list return a library that
 * does **not** contain the document under test — exactly what happens for card #51 in production —
 * and then asserts the feature still works.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { Document } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { server } from '../msw/server.js';
import { fx, D_BROWSING, D_INTL } from '../msw/fixtures.js';
import { state } from '../msw/handlers.js';

const B = '/api/v1';
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 50 });

/**
 * `GET /documents` behaves as if `docBrowsing` sits past the first page: it is absent from the
 * plain list, but `?pinned=true` — a filtered query, not a page — still returns it.
 */
function libraryWithoutBrowsing() {
  server.use(
    http.get(`${B}/documents`, ({ request }) => {
      const u = new URL(request.url);
      const pinnedOnly = u.searchParams.get('pinned') === 'true';
      const cards = fx.cards
        .map((c) => ({ ...c, pinned: state.pins.has(c.id) }))
        .filter((c) => (pinnedOnly ? c.pinned : c.id !== D_BROWSING));
      return HttpResponse.json(page(cards));
    }),
  );
}

describe('I10 — features that must not read page 1 of the library', () => {
  it('shows the real pin state for a document that is not on the loaded page', async () => {
    libraryWithoutBrowsing();
    expect(state.pins.has(D_BROWSING)).toBe(true);

    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await screen.findByRole('heading', { name: /איטיות גלישה/ });

    // Before the fix this rendered "☆ הצמד" — the card was simply not in the list it read.
    await screen.findByRole('button', { name: '★ מוצמד' });
  });

  it('P toggles the pin the right way for such a document', async () => {
    libraryWithoutBrowsing();
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await screen.findByRole('button', { name: '★ מוצמד' });

    await userEvent.keyboard('p');

    await screen.findByRole('button', { name: '☆ הצמד' });
    await waitFor(() => expect(state.pins.has(D_BROWSING)).toBe(false));
  });

  it('resolves a [[doc:…]] reference from the document’s own links, not from the list', async () => {
    libraryWithoutBrowsing();
    const withRef: Document = structuredClone(fx.docBrowsing);
    withRef.phases[0].steps[0].actions = [{ id: 'a-ref', text: `ראו גם [[doc:${D_INTL}]]` }];
    server.use(
      http.get(`${B}/documents/:id`, ({ params }) =>
        String(params.id) === D_BROWSING
          ? HttpResponse.json(withRef)
          : HttpResponse.json(state.documents.get(String(params.id))),
      ),
    );

    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    await screen.findByRole('heading', { name: /איטיות גלישה/ });

    // `GET /documents/:id/related` carries the title; the uuid never reaches the user.
    const link = await screen.findByText(fx.docIntl.title, { selector: 'a.doc-link' });
    expect(link).toHaveAttribute('data-doc', D_INTL);
  });

  it('peeks a document that is not in any loaded list', async () => {
    libraryWithoutBrowsing();
    const withRef: Document = structuredClone(fx.docIntl);
    withRef.phases[0].steps[0].actions = [{ id: 'a-ref', text: `ראו גם [[doc:${D_BROWSING}]]` }];
    server.use(
      http.get(`${B}/documents/:id`, ({ params }) =>
        String(params.id) === D_INTL
          ? HttpResponse.json(withRef)
          : HttpResponse.json(state.documents.get(String(params.id))),
      ),
      http.get(`${B}/documents/:id/related`, () =>
        HttpResponse.json({
          items: [
            {
              documentId: D_BROWSING,
              title: fx.docBrowsing.title,
              category: 'tech',
              why: 'מקושר מהמסמך',
            },
          ],
        }),
      ),
    );

    renderWithProviders(<App />, { route: `/doc/${D_INTL}` });
    const link = await screen.findByText(fx.docBrowsing.title, { selector: 'a.doc-link' });

    await userEvent.hover(link);

    // The peek used to render nothing at all for an unlisted document.
    const peek = await waitFor(() => {
      const el = document.querySelector('.peek');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    await waitFor(() => expect(peek.textContent).toContain('15 שלבים'));
    expect(peek.textContent).toContain('תמיכה טכנית');
  });
});
