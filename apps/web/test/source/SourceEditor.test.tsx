import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { SourceEditor } from '../../src/components/source/SourceEditor.js';
import { fx } from '../msw/fixtures.js';
import { state } from '../msw/handlers.js';

/** `Modal.prompt`'s confirm button label is fixed by `components/ui/Modal.tsx`. */
const CONFIRM = 'אישור';

describe('SourceEditor', () => {
  it('loads the current html, saves a version with a label and reports the new version', async () => {
    state.sourceDocs.set(fx.docBrowsing.id, {
      html: '<p>התחלה</p>',
      text: 'התחלה',
      version: 1,
      etag: 'e1',
      versions: [],
    });
    const onSaved = vi.fn();
    renderWithProviders(<SourceEditor documentId={fx.docBrowsing.id} onSaved={onSaved} />);
    const editor = await screen.findByRole('textbox');
    await waitFor(() => expect(editor.textContent).toContain('התחלה'));

    fireEvent.click(screen.getByRole('button', { name: 'שמור גרסה' }));
    const label = await screen.findByLabelText('תיאור הגרסה');
    fireEvent.change(label, { target: { value: 'עדכון נוהל' } });
    fireEvent.click(screen.getByRole('button', { name: CONFIRM }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(2));
    expect(state.sourceDocs.get(fx.docBrowsing.id)?.versions.at(-1)?.label).toBe('עדכון נוהל');
  });

  it('shows the conflict dialog on 412 and reloads on confirm', async () => {
    state.sourceDocs.set(fx.docBrowsing.id, {
      html: '<p>א</p>',
      text: 'א',
      version: 1,
      etag: 'e1',
      versions: [],
    });
    renderWithProviders(<SourceEditor documentId={fx.docBrowsing.id} />);
    const editor = await screen.findByRole('textbox');
    await waitFor(() => expect(editor.textContent).toContain('א'));

    // someone else saved meanwhile
    state.sourceDocs.set(fx.docBrowsing.id, {
      html: '<p>ב</p>',
      text: 'ב',
      version: 2,
      etag: 'e2',
      versions: [],
    });
    fireEvent.click(screen.getByRole('button', { name: 'שמור גרסה' }));
    fireEvent.click(await screen.findByRole('button', { name: CONFIRM }));

    expect(await screen.findByText('מסמך המקור השתנה בינתיים')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'טען מחדש' }));
    });
    await waitFor(() => expect(screen.getByRole('textbox').textContent).toContain('ב'));
  });

  it('autosaves a draft after typing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      state.sourceDocs.set(fx.docBrowsing.id, {
        html: '<p>x</p>',
        text: 'x',
        version: 1,
        etag: 'e1',
        versions: [],
      });
      renderWithProviders(<SourceEditor documentId={fx.docBrowsing.id} />);
      const editor = await screen.findByRole('textbox');
      await waitFor(() => expect(editor.textContent).toContain('x'));

      const block = editor.querySelector('p') ?? editor;
      await act(async () => {
        block.textContent = 'xy';
        fireEvent.input(editor);
      });
      await act(async () => {
        vi.advanceTimersByTime(3500);
      });
      await waitFor(() => expect(state.sourceDrafts.get(fx.docBrowsing.id)?.html).toContain('xy'));
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * E-6 (acceptance review §4): "`שמור גרסה` opens a 'version description' dialog whose scrim
   * covers the editor; the page behind still reads `שינויים לא שמורים` while it is open. Correct,
   * but the two together read as 'the save failed' for a second."
   */
  it('stops saying the document is unsaved while the version dialog is open', async () => {
    state.sourceDocs.set(fx.docBrowsing.id, {
      html: '<p>התחלה</p>',
      text: 'התחלה',
      version: 1,
      etag: 'e1',
      versions: [],
    });
    renderWithProviders(<SourceEditor documentId={fx.docBrowsing.id} />);
    const editor = await screen.findByRole('textbox');
    await waitFor(() => expect(editor.textContent).toContain('התחלה'));

    const block = editor.querySelector('p') ?? editor;
    await act(async () => {
      block.textContent = 'התחלה ועוד';
      fireEvent.input(editor);
    });
    expect(await screen.findByText('שינויים לא שמורים')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'שמור גרסה' }));
    await screen.findByLabelText('תיאור הגרסה');
    // The save *has* started — the user is inside it — so the strip behind the scrim says so.
    expect(await screen.findByText('שומר גרסה…')).toBeInTheDocument();
    expect(screen.queryByText('שינויים לא שמורים')).not.toBeInTheDocument();

    // Dismissing the dialog puts the honest "unsaved" state back.
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    await waitFor(() => expect(screen.getByText('שינויים לא שמורים')).toBeInTheDocument());
  });
});
