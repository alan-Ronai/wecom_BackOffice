import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../render.js';
import { WorkspacePage } from '../../src/components/workspace/WorkspacePage.js';
import {
  aiState,
  resetAiState,
  scriptStream,
  suggestionWithAffects,
  DOC_1,
  MSG_3,
  PE_1,
  SOURCE_HTML,
  SUG_AFFECTS,
  BASE_SOURCE_VERSION,
} from '../msw/ai-handlers.js';
import { state, withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { fx } from '../msw/fixtures.js';

const seed = () => {
  state.sourceDocs.set(DOC_1, {
    html: SOURCE_HTML,
    text: 'בדיקת מהירות גלישה',
    version: BASE_SOURCE_VERSION,
    etag: 'e-src-1',
    versions: [],
    latestRevisionId: null,
  });
  state.suggestions = [suggestionWithAffects()];
};

beforeEach(() => {
  resetAiState();
  seed();
});
afterEach(() => vi.restoreAllMocks());

const render = () =>
  renderWithProviders(
    <Routes>
      <Route path="/workspace/:id" element={<WorkspacePage />} />
    </Routes>,
    { route: `/workspace/${DOC_1}` },
  );

const composer = () => screen.findByRole('textbox', { name: 'הודעה למערכת' });

describe('<WorkspacePage>', () => {
  it('renders the three panes and the way back to the item', async () => {
    render();
    expect(await screen.findByRole('region', { name: 'מסמך המקור' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'הצעות' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'סביבת העבודה' })).toBeInTheDocument();
    expect(screen.getByText(fx.docBrowsing.title)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'חזרה לפריט' })).toHaveAttribute('href', `/doc/${DOC_1}`);
    await waitFor(() =>
      expect(screen.getAllByText(`גרסת מקור ${BASE_SOURCE_VERSION}`).length).toBeGreaterThan(0),
    );
  });

  it('is closed to a caller without ai.chat', async () => {
    server.use(withMe({ permissions: ['docs.read', 'ai.ask'] }));
    render();
    expect(await screen.findByText('אין הרשאה לסביבת העבודה')).toBeInTheDocument();
  });

  it('ArrowLeft on a resizer changes the grid and remembers it per viewer', async () => {
    const user = userEvent.setup();
    render();
    const panes = (await screen.findByRole('region', { name: 'מסמך המקור' })).parentElement!;
    const before = panes.style.gridTemplateColumns;
    const [first] = screen.getAllByRole('separator');
    first!.focus();
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(panes.style.gridTemplateColumns).not.toBe(before));
    await waitFor(() => expect(localStorage.getItem('kb.workspace.panes')).toBeTruthy());
  });

  it('a proposed_edits event from the chat raises the overlay above the source editor', async () => {
    const user = userEvent.setup();
    render();
    await user.type(await composer(), 'קצר');
    await user.keyboard('{Enter}');
    const overlay = await screen.findByRole('region', { name: 'עריכות מוצעות במסמך' });
    expect(
      within(await screen.findByRole('region', { name: 'מסמך המקור' })).getByRole('region', {
        name: 'עריכות מוצעות במסמך',
      }),
    ).toBe(overlay);
    expect(within(overlay).getByText(`על גרסה ${BASE_SOURCE_VERSION}`)).toBeInTheDocument();
  });

  it('accepting a hunk posts the decision and closes the overlay', async () => {
    const user = userEvent.setup();
    render();
    await user.type(await composer(), 'קצר');
    await user.keyboard('{Enter}');
    const overlay = await screen.findByRole('region', { name: 'עריכות מוצעות במסמך' });
    await user.click((await within(overlay).findAllByRole('button', { name: 'קבל' }))[0]!);
    await user.click(within(overlay).getByRole('button', { name: /אשר החלטות/ }));
    await waitFor(() => expect(aiState.decided[0]).toMatchObject({ id: PE_1 }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'עריכות מוצעות במסמך' })).not.toBeInTheDocument(),
    );
  });

  it('a refined_suggestion event raises the banner in the suggestions pane and prefills the drawer', async () => {
    const base = suggestionWithAffects().payload as Extract<
      ReturnType<typeof suggestionWithAffects>['payload'],
      { type: 'update-step' }
    >;
    scriptStream([
      {
        type: 'refined_suggestion',
        suggestionId: SUG_AFFECTS,
        editedPayload: { ...base, addActions: ['מעודן', base.addActions[1]!] },
      },
      { type: 'done', messageId: MSG_3, tokensIn: 1, tokensOut: 1, latencyMs: 1 },
    ]);
    const user = userEvent.setup();
    render();
    await user.type(await composer(), 'עדן');
    await user.keyboard('{Enter}');
    expect(await screen.findByText('התקבלה הצעה מעודנת מהצ׳אט')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'פתח בעורך' }));
    const dialog = await screen.findByRole('dialog', { name: 'עריכת ההצעה' });
    expect(within(dialog).getByRole('textbox', { name: 'ערך חדש · פעולה חדשה' })).toHaveValue('מעודן');
  });

  it('"שאל על ההצעה" pins the suggestion as the chat’s context', async () => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('button', { name: 'שאל על ההצעה' }));
    expect(await screen.findByText('הקשר: הצעה')).toBeInTheDocument();
    await user.type(await composer(), 'מה זה');
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(aiState.sent[0]?.body).toMatchObject({ context: { suggestionId: SUG_AFFECTS } }),
    );
  });

  it('text selected in the source pane becomes the chat context and rides along on the send', async () => {
    const user = userEvent.setup();
    render();
    const pane = await screen.findByRole('region', { name: 'מסמך המקור' });
    const probe = document.createElement('p');
    probe.textContent = 'סעיף 3 לבדיקה';
    pane.appendChild(probe);

    const range = document.createRange();
    range.selectNodeContents(probe);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    // The listener is debounced by 300 ms; `findBy*` polls well past that.
    expect(await screen.findByText('הקשר: "סעיף 3 לבדיקה"')).toBeInTheDocument();
    await user.type(await composer(), 'קצר');
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(aiState.sent[0]?.body).toMatchObject({ context: { selection: 'סעיף 3 לבדיקה' } }),
    );
  });

  it('stacks the panes on a narrow viewport', async () => {
    window.matchMedia = ((q: string) => ({
      matches: q === '(max-width: 900px)',
      media: q,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    render();
    const panes = (await screen.findByRole('region', { name: 'מסמך המקור' })).parentElement!;
    expect(panes.className).toContain('stacked');
  });
});
