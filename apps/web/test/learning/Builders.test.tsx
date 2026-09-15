import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { learningState } from '../msw/learning-manage.js';
import { LI_BRIEF, LI_QUIZ, D_BROWSING, D_INTL } from '../msw/fixtures.js';

const asEditor = () =>
  server.use(withMe({ roles: ['editor'], permissions: ['docs.read', 'learning.read', 'learning.manage'] }));
const asLead = () =>
  server.use(
    withMe({
      roles: ['lead'],
      permissions: ['docs.read', 'learning.read', 'learning.manage', 'learning.publish'],
    }),
  );

/** The search fixture answers with the flagship document whatever the term; this is its title. */
const DOC_TITLE = /איטיות גלישה/;

describe('briefing builder', () => {
  it('adds a published document from the picker, writes a note, reorders and saves', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_BRIEF}` });
    expect(await screen.findByRole('heading', { level: 1, name: /נדידה/ })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('הוסף פריט ידע'), 'גלישה');
    await userEvent.click(await screen.findByRole('option', { name: DOC_TITLE }));
    const list = screen.getByTestId('entries-list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    await userEvent.type(within(list).getAllByLabelText('הערה לנציג')[1]!, 'לקרוא בעיון');
    await userEvent.click(within(list).getAllByRole('button', { name: 'למעלה' })[1]!);
    await userEvent.click(screen.getByRole('button', { name: 'שמור פריטים' }));
    await waitFor(() =>
      expect(learningState.items.find((i) => i.id === LI_BRIEF)!.entries[0]!.documentId).toBe(D_BROWSING),
    );
    expect(learningState.items.find((i) => i.id === LI_BRIEF)!.entries[0]!.note).toBe('לקרוא בעיון');
  });

  it('publish is hidden without learning.publish and prompts for a label with it', async () => {
    asEditor();
    const editor = renderWithProviders(<App />, { route: `/learning/manage/${LI_BRIEF}` });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'פרסם' })).toBeNull();
    editor.unmount();

    asLead();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_BRIEF}` });
    await userEvent.click(await screen.findByRole('button', { name: 'פרסם' }));
    await userEvent.type(await screen.findByLabelText('תיאור הגרסה'), 'עדכון ספטמבר');
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }));
    await waitFor(() =>
      expect(learningState.published.at(-1)).toEqual({ itemId: LI_BRIEF, label: 'עדכון ספטמבר' }),
    );
  });

  it('names the documents in the briefing preview instead of their ids', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_BRIEF}` });
    await userEvent.click(await screen.findByRole('button', { name: 'תצוגה מקדימה' }));
    const dlg = await screen.findByRole('dialog', { name: 'תצוגה מקדימה' });
    expect(await within(dlg).findByText('אין גלישה בחו"ל')).toBeInTheDocument();
    expect(within(dlg).queryByText(D_INTL)).toBeNull();
  });

  it('moves between the editor tabs with the arrow keys', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_BRIEF}` });
    const build = await screen.findByRole('tab', { name: 'עריכה' });
    const completion = screen.getByRole('tab', { name: 'השלמה' });
    // One tab stop for the pair; the arrows do the moving, right-to-left as the page reads.
    expect(build).toHaveAttribute('tabindex', '0');
    expect(completion).toHaveAttribute('tabindex', '-1');
    build.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(completion).toHaveAttribute('aria-selected', 'true');
    expect(completion).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', completion.id);
    await userEvent.keyboard('{ArrowRight}');
    expect(build).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the preview modal read-only', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_QUIZ}` });
    await userEvent.click(await screen.findByRole('button', { name: 'תצוגה מקדימה' }));
    const dlg = await screen.findByRole('dialog', { name: 'תצוגה מקדימה' });
    expect(within(dlg).getByText(/מה עושים אם אין גלישה/)).toBeInTheDocument();
    // The correct flags are the answer key; the agent's preview must not leak them.
    expect(within(dlg).queryByRole('radio', { name: 'תשובה נכונה' })).toBeNull();
    expect(within(dlg).queryByRole('checkbox')).toBeNull();
  });
});

describe('quiz builder', () => {
  it('generates questions for the picked documents, marks them as generated, edits an option and saves', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_QUIZ}` });
    await screen.findByRole('heading', { level: 1, name: /תקלות גלישה/ });
    await userEvent.type(screen.getByLabelText('הוסף פריט ידע'), 'גלישה');
    await userEvent.click(await screen.findByRole('option', { name: DOC_TITLE }));
    await userEvent.click(screen.getByRole('button', { name: 'צור שאלות' }));
    const list = screen.getByTestId('questions-list');
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3));
    expect(learningState.generateCalls.at(-1)).toEqual({
      itemId: LI_QUIZ,
      documentIds: [D_BROWSING],
      perDocument: 3,
    });
    // The fixture already carries one generated question; the new one makes two.
    expect(within(list).getAllByText('נוצר אוטומטית')).toHaveLength(2);

    const third = within(list).getAllByRole('listitem')[2]!;
    const opt = within(third).getAllByLabelText('טקסט האפשרות')[1]!;
    await userEvent.clear(opt);
    await userEvent.type(opt, 'מתקשרים לתמיכה');
    await userEvent.click(within(third).getAllByRole('radio', { name: 'תשובה נכונה' })[1]!);
    await userEvent.click(screen.getByRole('button', { name: 'שמור שאלות' }));
    await waitFor(() => expect(learningState.items.find((i) => i.id === LI_QUIZ)!.questions).toHaveLength(3));
    const saved = learningState.items.find((i) => i.id === LI_QUIZ)!.questions[2]!;
    expect(saved.options.find((o) => o.text === 'מתקשרים לתמיכה')!.correct).toBe(true);
    expect(saved.options.filter((o) => o.correct)).toHaveLength(1);
    // Curating a generated question makes it the editor's.
    expect(saved.generated).toBe(false);
  });

  it('keeps two freshly added questions in separate radio groups', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_QUIZ}` });
    const list = await screen.findByTestId('questions-list');
    await userEvent.click(screen.getByRole('button', { name: '✚ שאלה ידנית' }));
    await userEvent.click(screen.getByRole('button', { name: '✚ שאלה ידנית' }));
    const drafts = within(list).getAllByRole('listitem').slice(-2);
    // Both drafts have an empty stem and no id; naming the group after either used to make them
    // one DOM group, so ticking in the second silently cleared the first.
    const [a, b] = drafts.map((li) => within(li).getAllByRole('radio', { name: 'תשובה נכונה' }));
    expect(a![0]).toBeChecked();
    await userEvent.click(b![1]!);
    expect(b![1]).toBeChecked();
    expect(a![0]).toBeChecked();
    // And the two questions do not share option ids either.
    const ids = drafts.flatMap((li) =>
      within(li)
        .getAllByRole('radio', { name: 'תשובה נכונה' })
        .map((r) => (r as HTMLInputElement).name),
    );
    expect(new Set(ids).size).toBe(2);
  });

  it('refuses to save a question without a correct option', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_QUIZ}` });
    const list = await screen.findByTestId('questions-list');
    const first = within(list).getAllByRole('listitem')[0]!;
    await userEvent.selectOptions(within(first).getByLabelText('סוג שאלה'), 'multi');
    await userEvent.click(within(first).getAllByRole('checkbox', { name: 'תשובה נכונה' })[1]!);
    await userEvent.click(within(first).getAllByRole('checkbox', { name: 'תשובה נכונה' })[0]!);
    await userEvent.click(within(first).getAllByRole('checkbox', { name: 'תשובה נכונה' })[1]!);
    await userEvent.click(screen.getByRole('button', { name: 'שמור שאלות' }));
    expect(await screen.findByText('לכל שאלה נדרשת לפחות תשובה נכונה אחת')).toBeInTheDocument();
    // Nothing was sent: the fixture still has its two questions.
    expect(learningState.items.find((i) => i.id === LI_QUIZ)!.questions).toHaveLength(2);
  });
});
