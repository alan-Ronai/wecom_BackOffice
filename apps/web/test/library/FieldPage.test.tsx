import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { FIELD_ROAMING, stage4State } from '../msw/stage4.js';

const route = `/fields/${encodeURIComponent(FIELD_ROAMING)}`;

describe('<FieldPage>', () => {
  it('shows the definition, the rename alert and the usage grouped by document', async () => {
    renderWithProviders(<App />, { route });

    expect(await screen.findByText('CRM ↗ שירותים')).toBeInTheDocument();
    expect(screen.getByText(/שונה שם ל-שירותי נדידה/)).toBeInTheDocument();
    expect(screen.getByText(/ב-3 מסמכים · 3 שלבים/)).toBeInTheDocument();

    const usage = screen.getByTestId('field-usage');
    expect(within(usage).getByText(/5 · בדיקת שירות נדידה/)).toBeInTheDocument();
    expect(within(usage).getByText(/3 · הפעלת נדידה/)).toBeInTheDocument();
    expect(within(usage).getByText(/2 · מקור החיוב/)).toBeInTheDocument();
  });

  it('opens the referencing document at the exact step', async () => {
    renderWithProviders(<App />, { route });
    const usage = await screen.findByTestId('field-usage');
    await userEvent.click(within(usage).getByText(/5 · בדיקת שירות נדידה/));
    // The intl document opens on step 5, not on its first step.
    await waitFor(() => expect(document.querySelector('.step.cur')).toHaveAttribute('data-step', 's5'));
  });

  it('renames the field and reports how many documents were rewritten', async () => {
    renderWithProviders(<App />, { route });
    await screen.findByTestId('field-usage');

    await userEvent.click(screen.getByRole('button', { name: '✎ שנה שם ועדכן הפניות' }));
    const dialog = await screen.findByRole('dialog', { name: 'שינוי שם השדה' });
    expect(within(dialog).getByLabelText('עדכן את כל ההפניות')).toBeChecked();

    await userEvent.clear(within(dialog).getByLabelText('שם חדש'));
    await userEvent.type(within(dialog).getByLabelText('שם חדש'), 'שירותי נדידה');
    await userEvent.click(within(dialog).getByRole('button', { name: 'עדכן הכל' }));

    await waitFor(() => expect(stage4State.renames).toHaveLength(1));
    expect(stage4State.renames[0]).toMatchObject({ newName: 'שירותי נדידה', updateReferences: true });
    // The label defaults to something descriptive rather than empty, since it becomes the
    // version label on every rewritten document.
    expect(stage4State.renames[0].label).toContain('שינוי שם שדה');
    expect(await screen.findByText(/3 מסמכים עודכנו ו-3 גרסאות נוצרו/)).toBeInTheDocument();
  });

  it('refuses a rename that does not actually change the name', async () => {
    renderWithProviders(<App />, { route });
    await screen.findByTestId('field-usage');
    await userEvent.click(screen.getByRole('button', { name: '✎ שנה שם ועדכן הפניות' }));
    const dialog = await screen.findByRole('dialog', { name: 'שינוי שם השדה' });

    await userEvent.clear(within(dialog).getByLabelText('שם חדש'));
    await userEvent.type(within(dialog).getByLabelText('שם חדש'), FIELD_ROAMING);
    await userEvent.click(within(dialog).getByRole('button', { name: 'עדכן הכל' }));

    expect(await screen.findByText('בחרו שם חדש ושונה מהנוכחי')).toBeInTheDocument();
    expect(stage4State.renames).toHaveLength(0);
    // The dialog stays open so the name can be corrected.
    expect(screen.getByRole('dialog', { name: 'שינוי שם השדה' })).toBeInTheDocument();
  });

  it('warns with the real impact count before deleting', async () => {
    renderWithProviders(<App />, { route });
    await screen.findByTestId('field-usage');

    await userEvent.click(screen.getByRole('button', { name: '🗑 מחק שדה' }));
    const dialog = await screen.findByRole('dialog', { name: 'מחיקת שדה CRM' });
    expect(within(dialog).getByText(/3 מסמכים מפנים ל-שירות נדידה/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'מחק שדה' }));
    expect(await screen.findByText('השדה נמחק')).toBeInTheDocument();
  });

  it('hides rename and delete without fields.edit', async () => {
    server.use(withMe({ permissions: ['docs.read'] }));
    renderWithProviders(<App />, { route });
    await screen.findByTestId('field-usage');
    expect(screen.queryByRole('button', { name: '✎ שנה שם ועדכן הפניות' })).toBeNull();
    expect(screen.queryByRole('button', { name: '🗑 מחק שדה' })).toBeNull();
  });

  it('is reachable from the fields list', async () => {
    renderWithProviders(<App />, { route: '/fields' });
    // The renamed field is first under "שינויים לבדיקה"; two fields share its CRM path.
    await screen.findAllByTestId('rule');
    await userEvent.click(screen.getAllByText('CRM ↗ שירותים')[0]);
    expect(await screen.findByTestId('field-usage')).toBeInTheDocument();
    expect(screen.getByText(/שונה שם ל-שירותי נדידה/)).toBeInTheDocument();
  });
});
