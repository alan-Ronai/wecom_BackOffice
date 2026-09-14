/**
 * Editor QOL, card 6c: undo/redo with a labelled history strip, multi-step selection, the
 * template gallery, the source ↔ step mapping panel and the 412 conflict banner.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { server } from '../msw/server.js';
import { state } from '../msw/handlers.js';
import { D_BROWSING, fx } from '../msw/fixtures.js';
import { stage45State, TPL_STEPS } from '../msw/stage45.js';

const B = '/api/v1';
const boxes = () => Array.from(document.querySelectorAll('.estep .ebox')) as HTMLElement[];

const openEditor = async () => {
  const r = renderWithProviders(<App />, { route: `/edit/${D_BROWSING}` });
  await waitFor(() => expect(screen.getByLabelText('שם פריט הידע')).toHaveValue(fx.docBrowsing.title));
  return r;
};

describe('undo / redo', () => {
  it('undoes a step deletion with Ctrl Z and redoes it with Ctrl Shift Z', async () => {
    await openEditor();
    const before = boxes().length;
    expect(before).toBeGreaterThan(3);

    await userEvent.click(screen.getAllByTitle('מחק שלב')[0]);
    await waitFor(() => expect(boxes().length).toBe(before - 1));

    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(boxes().length).toBe(before));

    await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    await waitFor(() => expect(boxes().length).toBe(before - 1));
  });

  it('labels the history points so the strip is navigable', async () => {
    await openEditor();
    await userEvent.click(screen.getAllByTitle('מחק שלב')[0]);

    const strip = screen.getByRole('group', { name: 'נקודות שמירה' });
    await within(strip).findByLabelText(/מחיקת שלב/);

    // Jumping back to the load point restores the document as it was read.
    const load = within(strip).getByLabelText(/נטען/);
    const before = boxes().length;
    await userEvent.click(load);
    await waitFor(() => expect(boxes().length).toBe(before + 1));
  });
});

describe('multi-step selection', () => {
  /**
   * `userEvent.setup()` (rather than the bare default export) is required here: only a session
   * keeps `{Shift>}` held across the following click, which is the whole gesture under test.
   */
  const selectTwo = async () => {
    const user = userEvent.setup();
    const all = boxes();
    await user.click(all[0]);
    await user.keyboard('{Shift>}');
    await user.click(all[1]);
    await user.keyboard('{/Shift}');
    return all;
  };

  it('shift-click selects a run and the bar acts on all of it', async () => {
    await openEditor();
    const before = boxes().length;
    await selectTwo();

    const bar = await screen.findByRole('region', { name: 'פעולות על השלבים שנבחרו' });
    expect(within(bar).getByText('2 שלבים')).toBeInTheDocument();

    await userEvent.click(within(bar).getByRole('button', { name: 'מחק' }));
    // Deleting two steps at once renumbers once, not twice — both are gone.
    await waitFor(() => expect(boxes().length).toBe(before - 2));
  });

  it('duplicates a selection', async () => {
    await openEditor();
    const before = boxes().length;
    await selectTwo();
    const bar = await screen.findByRole('region', { name: 'פעולות על השלבים שנבחרו' });
    await userEvent.click(within(bar).getByRole('button', { name: 'שכפל ⧉' }));
    await waitFor(() => expect(boxes().length).toBe(before + 2));
  });

  it('clears the selection with Escape instead of leaving the editor', async () => {
    await openEditor();
    await selectTwo();
    await screen.findByRole('region', { name: 'פעולות על השלבים שנבחרו' });

    await userEvent.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'פעולות על השלבים שנבחרו' })).not.toBeInTheDocument(),
    );
    // Still in the editor — Escape consumed the selection, not the route.
    expect(screen.getByLabelText('שם פריט הידע')).toBeInTheDocument();
  });
});

describe('template gallery', () => {
  /**
   * The gallery is only offered for a genuinely fresh document, so the route must have no
   * server-side draft. Pinned with a handler rather than by clearing state, because a previous
   * test's autosave flush is asynchronous and can land in the middle of this one.
   */
  const freshNew = () => {
    state.drafts.clear();
    server.use(http.get(`${B}/drafts/new/:draftId`, () => new HttpResponse(null, { status: 204 })));
  };

  it('offers templates for an empty new document and applies one', async () => {
    freshNew();
    renderWithProviders(<App />, { route: '/edit/new' });
    const gallery = await screen.findByRole('region', { name: 'התחל מתבנית' });
    const tpl = stage45State.templates.find((t) => t.id === TPL_STEPS)!;

    await userEvent.click(await within(gallery).findByLabelText(`התחל מתבנית ${tpl.name}`));

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'התחל מתבנית' })).not.toBeInTheDocument(),
    );
    await screen.findByDisplayValue(tpl.phases[0].steps[0].title);
  });

  it('starts blank on request', async () => {
    freshNew();
    renderWithProviders(<App />, { route: '/edit/new' });
    const gallery = await screen.findByRole('region', { name: 'התחל מתבנית' });
    await userEvent.click(within(gallery).getByRole('button', { name: 'התחל ריק' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'התחל מתבנית' })).not.toBeInTheDocument(),
    );
  });
});

describe('source ↔ step mapping', () => {
  it('shows which paragraphs are mapped and assigns a ref to the selected step', async () => {
    await openEditor();
    await userEvent.click(screen.getByRole('button', { name: 'מיפוי מקור ↔ שלבים' }));

    const panel = await screen.findByTestId('source-map');
    expect(within(panel).getByText(/פסקה לא ממופה לא תיצור הצעה אוטומטית/)).toBeInTheDocument();

    // Pick a step, then a paragraph; the step's ref follows.
    const step = within(panel).getAllByRole('button', { name: /^שלב / })[0];
    await userEvent.click(step);
    const para = within(panel).getAllByRole('button', { name: /^פסקה / })[0];
    // The ref is the `bdi`, not the whole row — the heading text follows it with no separator.
    const ref = para.querySelector('bdi')?.textContent ?? '';
    expect(ref).toBeTruthy();
    await userEvent.click(para);

    await waitFor(() =>
      expect(within(panel).getAllByLabelText(new RegExp(`ממופה ל-${ref}$`))).toHaveLength(1),
    );
  });
});

describe('conflict banner', () => {
  it('surfaces a 412 with reload and diff choices instead of a status code', async () => {
    server.use(
      http.put(`${B}/documents/:id/structure`, () =>
        HttpResponse.json({ code: 'CONFLICT', message: 'הגרסה השתנתה' }, { status: 412 }),
      ),
    );
    await openEditor();

    await userEvent.click(screen.getByRole('button', { name: /פרסם v/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'אישור' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('הטיוטה שלך נשמרה');
    expect(within(alert).getByRole('button', { name: 'הצג הבדלים' })).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'טען מחדש' })).toBeInTheDocument();
  });
});
