import { describe, it, expect } from 'vitest';
import { act, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QueryClient } from '@tanstack/react-query';
import type { LearningItem } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { keys } from '../../src/api/keys.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { learningState } from '../msw/learning-manage.js';
import { LI_BRIEF, LI_QUIZ } from '../msw/fixtures.js';

/**
 * B-M11 (wave 5): a refetch whose arrays have a new identity must not discard an unsaved draft in
 * the briefing or quiz builder, and a legitimately newer server copy is still adopted when the
 * draft is clean. The "refetch" is a write to the item's query — exactly what a background refetch
 * with a changed payload does to the builder's `item` prop.
 */
const asEditor = () =>
  server.use(withMe({ roles: ['editor'], permissions: ['docs.read', 'learning.read', 'learning.manage'] }));

const refetch = (qc: QueryClient, id: string, change: (i: LearningItem) => LearningItem) =>
  act(async () => {
    const old = qc.getQueryData<LearningItem>(keys.learning.item(id));
    expect(old, 'the item is cached').toBeTruthy();
    const next = change(old!);
    qc.setQueryData(keys.learning.item(id), next);
    // TanStack notifies observers on a later tick; let the new `item` prop actually render.
    await new Promise((r) => setTimeout(r, 20));
  });

const withNote = (note: string) => (i: LearningItem) => ({
  ...i,
  entries: i.entries.map((e, n) => (n === 0 ? { ...e, note } : { ...e })),
});

const withStem = (stem: string) => (i: LearningItem) => ({
  ...i,
  questions: i.questions.map((q, n) => (n === 0 ? { ...q, stem } : { ...q })),
});

describe('briefing builder — draft vs refetch', () => {
  const open = async () => {
    asEditor();
    const r = renderWithProviders(<App />, { route: `/learning/manage/${LI_BRIEF}` });
    await screen.findByRole('heading', { level: 1, name: /נדידה/ });
    const list = screen.getByTestId('entries-list');
    return { qc: r.qc, note: () => within(list).getAllByLabelText('הערה לנציג')[0] as HTMLTextAreaElement };
  };

  it('keeps an unsaved draft when a changed server copy arrives', async () => {
    const { qc, note } = await open();
    await userEvent.clear(note());
    await userEvent.type(note(), 'טיוטה שלי');
    await refetch(qc, LI_BRIEF, withNote('נכתב במקום אחר'));
    expect(note()).toHaveValue('טיוטה שלי');
    expect(screen.getByRole('button', { name: 'שמור פריטים' })).toBeEnabled();
  });

  it('adopts a newer server copy while the draft is clean', async () => {
    const { qc, note } = await open();
    expect(screen.getByRole('button', { name: 'שמור פריטים' })).toBeDisabled();
    await refetch(qc, LI_BRIEF, withNote('גרסה חדשה מהשרת'));
    await waitFor(() => expect(note()).toHaveValue('גרסה חדשה מהשרת'));
    expect(screen.getByRole('button', { name: 'שמור פריטים' })).toBeDisabled();
  });

  it('a draft edited back to the server copy is clean again, and adopts the next one', async () => {
    const { qc, note } = await open();
    const original = note().value;
    await userEvent.type(note(), 'x');
    await userEvent.type(note(), '{Backspace}');
    expect(note()).toHaveValue(original);
    await refetch(qc, LI_BRIEF, withNote('עוד גרסה'));
    await waitFor(() => expect(note()).toHaveValue('עוד גרסה'));
  });

  it('after a save the saved copy is the clean base, so the next refetch is adopted', async () => {
    const { qc, note } = await open();
    await userEvent.clear(note());
    await userEvent.type(note(), 'נשמר');
    await userEvent.click(screen.getByRole('button', { name: 'שמור פריטים' }));
    await waitFor(() =>
      expect(learningState.items.find((i) => i.id === LI_BRIEF)!.entries[0]!.note).toBe('נשמר'),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'שמור פריטים' })).toBeDisabled());
    await refetch(qc, LI_BRIEF, withNote('אחרי השמירה'));
    await waitFor(() => expect(note()).toHaveValue('אחרי השמירה'));
  });
});

describe('quiz builder — draft vs refetch', () => {
  const open = async () => {
    asEditor();
    const r = renderWithProviders(<App />, { route: `/learning/manage/${LI_QUIZ}` });
    await screen.findByRole('heading', { level: 1, name: /תקלות גלישה/ });
    const list = screen.getByTestId('questions-list');
    return { qc: r.qc, stem: () => within(list).getAllByLabelText('שאלה')[0] as HTMLTextAreaElement };
  };

  it('keeps an unsaved draft when a changed server copy arrives', async () => {
    const { qc, stem } = await open();
    await userEvent.clear(stem());
    await userEvent.type(stem(), 'ניסוח שלי');
    await refetch(qc, LI_QUIZ, withStem('ניסוח של מישהו אחר'));
    expect(stem()).toHaveValue('ניסוח שלי');
    expect(screen.getByRole('button', { name: 'שמור שאלות' })).toBeEnabled();
  });

  it('adopts a newer server copy while the draft is clean', async () => {
    const { qc, stem } = await open();
    expect(screen.getByRole('button', { name: 'שמור שאלות' })).toBeDisabled();
    await refetch(qc, LI_QUIZ, withStem('ניסוח חדש מהשרת'));
    await waitFor(() => expect(stem()).toHaveValue('ניסוח חדש מהשרת'));
    expect(screen.getByRole('button', { name: 'שמור שאלות' })).toBeDisabled();
  });
});
