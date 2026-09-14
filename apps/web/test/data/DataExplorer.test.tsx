import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { SRC_AGENTS_CSV, SRC_TOPICS, stage4State } from '../msw/stage4.js';

describe('<DataPage>', () => {
  it('lists the json/csv files with their sync state and previews the first one', async () => {
    renderWithProviders(<App />, { route: '/data' });

    // Scoped: the main sidebar lists `topics.json` too, as one of the legacy source rows.
    const files = await screen.findByTestId('data-files');
    expect(await within(files).findByText('topics.json')).toBeInTheDocument();
    expect(within(files).getByText('agents-scripts.csv')).toBeInTheDocument();
    expect(screen.getByText('קבצי נתונים · 5')).toBeInTheDocument();
    // The unmapped CSV is flagged, the imported JSON is not.
    expect(within(files).getByText(/120 שורות · לא ממופה/)).toBeInTheDocument();
    expect(within(files).getByText(/38 שורות · ייבוא/)).toBeInTheDocument();

    // The first file is selected, so its preview rows are on screen.
    const preview = await screen.findByTestId('data-preview');
    expect(within(preview).getByText('בדיקת מהירות ואז ריענון')).toBeInTheDocument();
    expect(screen.getByText(/3 מתוך 38 שורות/)).toBeInTheDocument();
  });

  it('opens a file by id and shows its own columns', async () => {
    renderWithProviders(<App />, { route: `/data/${SRC_AGENTS_CSV}` });
    const mapping = await screen.findByTestId('mapping-table');
    expect(within(mapping).getByText('agent')).toBeInTheDocument();
    expect(within(mapping).getAllByText('לא ממופה')).toHaveLength(3);
  });

  it('maps a column to a card field and saves the mapping', async () => {
    renderWithProviders(<App />, { route: `/data/${SRC_AGENTS_CSV}` });
    await screen.findByTestId('mapping-table');

    const save = screen.getByRole('button', { name: 'שמור מיפוי' });
    expect(save).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('שדה בכרטיס עבור line'), 'stepAction');
    expect(await screen.findByText('✓ ממופה')).toBeInTheDocument();
    expect(save).toBeEnabled();

    await userEvent.click(save);
    await waitFor(() => {
      const file = stage4State.files.find((f) => f.sourceId === SRC_AGENTS_CSV);
      expect(file?.mapping.find((m) => m.column === 'line')?.field).toBe('stepAction');
    });
    expect(await screen.findByText('המיפוי נשמר')).toBeInTheDocument();
  });

  it('refuses to save a mapping that points two columns at the same card field', async () => {
    renderWithProviders(<App />, { route: `/data/${SRC_AGENTS_CSV}` });
    await screen.findByTestId('mapping-table');

    await userEvent.selectOptions(screen.getByLabelText('שדה בכרטיס עבור agent'), 'title');
    await userEvent.selectOptions(screen.getByLabelText('שדה בכרטיס עבור topic'), 'title');

    expect(await screen.findAllByText('כפול')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'שמור מיפוי' })).toBeDisabled();
  });

  it('re-imports and links to the suggestions the run produced', async () => {
    renderWithProviders(<App />, { route: `/data/${SRC_TOPICS}` });
    await screen.findByTestId('mapping-table');

    await userEvent.click(screen.getByRole('button', { name: /ייבא מחדש/ }));
    await waitFor(() => expect(stage4State.reimported).toEqual([SRC_TOPICS]));

    expect(await screen.findByText('הייבוא נשלח לעיבוד')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'עבור להצעות' }));
    // `/sources/:id` is where suggestions are reviewed — the source page took over the screen.
    expect(await screen.findByText('הצעות לכרטיסים')).toBeInTheDocument();
  });

  it('uploads a file and opens it', async () => {
    renderWithProviders(<App />, { route: '/data' });
    await screen.findByTestId('data-files');

    const file = new File(['agent,topic,line\n'], 'agents-scripts.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText('העלה קובץ נתונים'), file);

    await waitFor(() => expect(stage4State.uploads).toEqual(['agents-scripts.csv']));
    expect(await screen.findByText(/הקובץ הועלה/)).toBeInTheDocument();
    expect(stage4State.files.find((f) => f.sourceId === SRC_AGENTS_CSV)?.syncState).toBe('processing');
    // The upload navigates to the new file, so its mapping is the first thing on screen.
    expect(await screen.findByTestId('mapping-table')).toBeInTheDocument();
  });

  it('hides every write action without sources.manage', async () => {
    server.use(withMe({ permissions: ['docs.read'] }));
    renderWithProviders(<App />, { route: `/data/${SRC_TOPICS}` });
    await screen.findByTestId('mapping-table');

    expect(screen.queryByRole('button', { name: 'שמור מיפוי' })).toBeNull();
    expect(screen.queryByRole('button', { name: /ייבא מחדש/ })).toBeNull();
    expect(screen.queryByText('✚ העלה JSON / CSV')).toBeNull();
    // The mapping is still readable — it is how you learn what the import will do.
    expect(screen.getByLabelText('שדה בכרטיס עבור title')).toBeDisabled();
  });
});
