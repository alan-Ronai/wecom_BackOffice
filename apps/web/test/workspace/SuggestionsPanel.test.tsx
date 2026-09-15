import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SuggestionPayload } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { SuggestionsPanel } from '../../src/components/workspace/SuggestionsPanel.js';
import { aiState, resetAiState, suggestionWithAffects, SUG_AFFECTS, DOC_1 } from '../msw/ai-handlers.js';
import { state, withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { fx } from '../msw/fixtures.js';

/** The stage-1 `GET /suggestions` list is what the panel reads; seed it with the affects fixture. */
beforeEach(() => {
  resetAiState();
  state.suggestions = [suggestionWithAffects()];
});

const render = (props: Partial<Parameters<typeof SuggestionsPanel>[0]> = {}) =>
  renderWithProviders(<SuggestionsPanel documentId={DOC_1} sourceId={fx.sources[0]!.id} {...props} />);

describe('<SuggestionsPanel>', () => {
  it('shows what else the suggestion affects, and links a single document out', async () => {
    render();
    expect(await screen.findByText('משפיע על')).toBeInTheDocument();
    const docChip = screen.getByRole('link', { name: 'מסמך אחד' });
    expect(docChip).toHaveAttribute('href', `/doc/${fx.docIntl.id}`);
    expect(screen.getByText('בלוק משותף אחד')).toBeInTheDocument();
    expect(screen.getByText('שדה CRM אחד')).toBeInTheDocument();
  });

  it('"שאל על ההצעה" hands the suggestion id to the host', async () => {
    const user = userEvent.setup();
    const asked: string[] = [];
    render({ onAskAbout: (id) => asked.push(id) });
    await user.click(await screen.findByRole('button', { name: 'שאל על ההצעה' }));
    expect(asked).toEqual([SUG_AFFECTS]);
  });

  it('the drawer lists the pinned rows and PATCHes only the rows that changed', async () => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('button', { name: 'עריכה מפורטת' }));
    const dialog = await screen.findByRole('dialog', { name: 'עריכת ההצעה' });

    const rowIds = Array.from(dialog.querySelectorAll('fieldset')).map((f) => f.getAttribute('data-row'));
    expect(rowIds).toEqual(['add-0', 'add-1', 'rep-a1', 'branch', 'out-0', 'patch-hint']);

    await user.click(within(dialog).getAllByRole('radio', { name: 'ערוך' })[0]!);
    const field = within(dialog).getByRole('textbox', { name: 'ערך חדש · פעולה חדשה' });
    await user.clear(field);
    await user.type(field, 'ודא ניתוק מ-Wi-Fi');
    await user.click(within(dialog).getByRole('button', { name: 'שמור עריכה' }));

    await waitFor(() => expect(aiState.edits).toHaveLength(1));
    expect(aiState.edits[0]!.body).toEqual({
      type: 'update-step',
      rows: [{ rowId: 'add-0', op: 'edit', value: 'ודא ניתוק מ-Wi-Fi' }],
    });
  });

  it('an atomic group is removed whole, and a required row has no "הסר" at all', async () => {
    const user = userEvent.setup();
    state.suggestions = [
      {
        ...suggestionWithAffects(),
        type: 'new-step',
        payload: {
          type: 'new-step',
          afterStepKey: null,
          title: 'שלב חדש',
          actions: ['א'],
          outcomes: [],
        } as SuggestionPayload,
      },
    ];
    render();
    await user.click(await screen.findByRole('button', { name: 'עריכה מפורטת' }));
    const dialog = await screen.findByRole('dialog', { name: 'עריכת ההצעה' });
    const meta = dialog.querySelector('fieldset[data-row="meta"]')!;
    expect(within(meta as HTMLElement).queryByRole('radio', { name: 'הסר' })).toBeNull();
  });

  it('ticking rows and "החל חלקית" posts exactly those parts', async () => {
    const user = userEvent.setup();
    render();
    const boxes = await screen.findAllByRole('checkbox');
    await user.click(boxes[0]!);
    await user.click(boxes[2]!);
    await user.click(screen.getByRole('button', { name: 'החל חלקית' }));
    await waitFor(() => expect(aiState.accepted).toHaveLength(1));
    expect(aiState.accepted[0]).toEqual({ id: SUG_AFFECTS, parts: ['add-0', 'rep-a1'] });
  });

  it('a caller without suggestions.review sees neither the drawer nor the row picker', async () => {
    server.use(withMe({ permissions: ['docs.read', 'ai.ask'] }));
    render();
    expect(await screen.findByText('משפיע על')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'עריכה מפורטת' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'החל חלקית' })).toBeNull();
  });

  it('a refinement from the chat opens the drawer prefilled', async () => {
    const user = userEvent.setup();
    const base = suggestionWithAffects().payload as Extract<SuggestionPayload, { type: 'update-step' }>;
    render({
      refined: {
        suggestionId: SUG_AFFECTS,
        payload: { ...base, addActions: ['מעודן', base.addActions[1]!] },
      },
    });
    expect(await screen.findByText('התקבלה הצעה מעודנת מהצ׳אט')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'פתח בעורך' }));
    const dialog = await screen.findByRole('dialog', { name: 'עריכת ההצעה' });
    expect(within(dialog).getByRole('textbox', { name: 'ערך חדש · פעולה חדשה' })).toHaveValue('מעודן');
  });

  it('says so when the item has no linked source document', async () => {
    state.documents.set(DOC_1, { ...fx.docBrowsing, sourceId: null });
    renderWithProviders(<SuggestionsPanel documentId={DOC_1} />);
    expect(await screen.findByText('לפריט זה אין מסמך מקור מקושר')).toBeInTheDocument();
  });
});
