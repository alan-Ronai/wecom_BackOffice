/**
 * L4 parity walk — the Ctrl K palette.
 *
 * Evidence for the legacy side: `docs/parity/legacy-palette.png` and `KB.palette` in
 * `legacy/js/nav.js`. Rows in `docs/parity-l4.md`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { server } from '../msw/server.js';
import { D_BROWSING } from '../msw/fixtures.js';

const B = '/api/v1';

afterEach(() => vi.restoreAllMocks());

const openPalette = async () => {
  await screen.findAllByText('ספריית ידע');
  await userEvent.keyboard('{Control>}k{/Control}');
  return screen.findByRole('dialog', { name: 'חיפוש' });
};

describe('parity · palette', () => {
  /**
   * Legacy `draw()` ends with `res.querySelector('.ri.on').scrollIntoView({ block: 'nearest' })`.
   * The palette shows up to 40 results in a scrolling box; without this, arrowing past the sixth
   * row moves an invisible selection and Enter opens something the operator never saw.
   */
  it('keeps the keyboard selection in view while arrowing down the list', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    renderWithProviders(<App />, { route: '/library' });
    await openPalette();
    await screen.findByText('צור פריט ידע חדש');
    scroll.mockClear();

    await userEvent.keyboard('{ArrowDown}{ArrowDown}');

    await waitFor(() => {
      const on = document.querySelector('.palette .ri.on');
      expect(on).not.toBeNull();
      expect(scroll.mock.instances).toContain(on);
    });
  });

  /**
   * Legacy restricted the palette's pool to documents whenever it was opened to answer "which
   * document?" — `pool = index.filter((it) => it.type === 'doc' && !it.placeholder)` for the
   * `newtab` and `split` modes. The port sent the query to the server unfiltered, so a CRM field
   * or a block could be offered as the answer to "איזה מסמך לפתוח בלשונית חדשה?" — and choosing
   * one navigated to `/doc/<field name>`, which is not a document.
   */
  it('offers only things that are a document when asked which document to open', async () => {
    server.use(
      http.get(`${B}/search`, () =>
        HttpResponse.json({
          groups: [
            {
              type: 'fields',
              hits: [
                {
                  type: 'field',
                  id: 'sim block lbl',
                  title: 'sim block lbl',
                  snippet: 'CRM ↗ מצב עריכה',
                  meta: 'crm-fields.json',
                  score: 80,
                },
              ],
            },
            {
              type: 'documents',
              hits: [
                {
                  type: 'document',
                  id: D_BROWSING,
                  documentId: D_BROWSING,
                  title: 'איטיות גלישה',
                  snippet: '',
                  meta: 'topics.json',
                  score: 60,
                },
              ],
            },
          ],
          total: 2,
          tookMs: 2,
          files: 2,
        }),
      ),
    );

    renderWithProviders(<App />, { route: '/library' });
    await screen.findAllByText('ספריית ידע');
    await userEvent.keyboard('{Alt>}t{/Alt}');
    const input = await screen.findByPlaceholderText('איזה מסמך לפתוח בלשונית חדשה?');
    await userEvent.type(input, 'sim');

    // `hi()` splits a matched row's title across a <mark>, so read the whole result list.
    const res = await waitFor(() => {
      const el = document.querySelector('.palette .res');
      expect(el?.textContent).toContain('איטיות גלישה');
      return el!;
    });
    expect(res.textContent).not.toContain('sim block lbl');
    expect(res.textContent).not.toContain('שדות CRM');
  });
});
