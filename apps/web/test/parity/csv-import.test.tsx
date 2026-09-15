/**
 * L4 parity walk — "Import/export JSON & CSV" from the acceptance matrix.
 *
 * `legacy/README.md` documents the CSV contract as `title,desc,cat,wave,pri`, and
 * `KB.importFile` honours all five: `pri: KB.PRI[c[ix('pri')]] ? c[ix('pri')] : 'm'`.
 * Row in `docs/parity-l4.md`.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { server } from '../msw/server.js';
import * as fx from '../msw/fixtures.js';

const B = '/api/v1';

describe('parity · CSV import', () => {
  /**
   * The port read four of the five columns and hard-coded `priority: 'm'`, so an import of the
   * documented shape silently flattened every card to "בינוני" — and priority is what the library
   * sorts and facets by ("שכיח מאוד"), so the whole import landed in the wrong place with nothing
   * to say so.
   */
  it('honours the pri column, not just title/desc/cat/wave', async () => {
    const posted: Record<string, unknown>[] = [];
    let n = 0;
    server.use(
      http.post(`${B}/documents`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        posted.push(body);
        return HttpResponse.json(
          { ...fx.docBrowsing, ...body, id: `aaaaaaaa-0000-4000-8000-00000000000${++n}`, phases: [] },
          { status: 201 },
        );
      }),
    );

    renderWithProviders(<App />, { route: '/library' });
    await screen.findAllByText('ספריית ידע');

    // jsdom's `File` implements neither `text()` nor `Blob.text()`, so the handler's
    // `await file.text()` has to be given something to read.
    const body = 'title,desc,cat,wave,pri\nחסימת גלישה,בדיקת חסימה,tech,1,hh\nנדידה,חו"ל,intl,2,\n';
    const file = new File([body], 'cards.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(body) });

    // The input is `display: none` and driven by the toolbar button, so the change event is the
    // only way in — `userEvent.upload` refuses a hidden target.
    fireEvent.change(screen.getByLabelText('ייבוא קובץ'), { target: { files: [file] } });

    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted.map((d) => [d.title, d.priority, d.wave])).toEqual([
      ['חסימת גלישה', 'hh', 1],
      // An empty or unknown `pri` still falls back to 'm', exactly as legacy did.
      ['נדידה', 'm', 2],
    ]);
  });
});
