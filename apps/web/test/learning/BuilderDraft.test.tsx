import { describe, it, expect } from 'vitest';
import { act, screen, within, waitFor } from '@testing-library/react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import type { QueryClient } from '@tanstack/react-query';
import type { LearningItem } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { LearningItemEditor } from '../../src/components/learning/manage/LearningItemEditor.js';
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

/**
 * Wave Y review: the builders are keyed by item, so a dirty draft on item B never survives a
 * route change back to item A (the editor stays mounted across `:id` changes).
 */
describe('item editor — a draft stays with its item', () => {
  const LI_BRIEF_B = 'b0000000-0000-4000-8000-0000000000bb';
  const Nav = () => {
    const go = useNavigate();
    return (
      <>
        <button type="button" onClick={() => go(`/learning/manage/${LI_BRIEF}`)}>
          to A
        </button>
        <button type="button" onClick={() => go(`/learning/manage/${LI_BRIEF_B}`)}>
          to B
        </button>
      </>
    );
  };

  it('A→B, edit B, back to A shows A’s entries; saving writes to A', async () => {
    asEditor();
    const a = learningState.items.find((i) => i.id === LI_BRIEF)!;
    learningState.items.push({
      ...structuredClone(a),
      id: LI_BRIEF_B,
      title: 'תדריך ב',
      entries: a.entries.map((e) => ({ ...e, id: crypto.randomUUID(), note: 'הערה של ב' })),
    });
    const puts: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'PUT' && request.url.endsWith('/entries')) puts.push(request.url);
    });
    const r = renderWithProviders(
      <>
        <Nav />
        <Routes>
          <Route path="/learning/manage/:id" element={<LearningItemEditor />} />
        </Routes>
      </>,
      { route: `/learning/manage/${LI_BRIEF}` },
    );
    // The app keeps a visited item cached (default gcTime), so going back to A renders it at once
    // with the builder still mounted — the case the key exists for. The test client's gcTime 0
    // would unmount it on the way and hide the bug.
    r.qc.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } });
    const note = () => within(screen.getByTestId('entries-list')).getAllByLabelText('הערה לנציג')[0]!;
    await screen.findByRole('heading', { level: 1, name: /נדידה/ });
    const aNote = (note() as HTMLTextAreaElement).value;

    await userEvent.click(screen.getByRole('button', { name: 'to B' }));
    await screen.findByRole('heading', { level: 1, name: /תדריך ב/ });
    await waitFor(() => expect(note()).toHaveValue('הערה של ב'));
    await userEvent.clear(note());
    await userEvent.type(note(), 'טיוטה של ב');

    await userEvent.click(screen.getByRole('button', { name: 'to A' }));
    await screen.findByRole('heading', { level: 1, name: /נדידה/ });
    await waitFor(() => expect(note()).toHaveValue(aNote));
    expect(screen.queryByDisplayValue('טיוטה של ב')).toBeNull();
    expect(screen.getByRole('button', { name: 'שמור פריטים' })).toBeDisabled();

    await userEvent.clear(note());
    await userEvent.type(note(), 'עריכה של א');
    await userEvent.click(screen.getByRole('button', { name: 'שמור פריטים' }));
    await waitFor(() =>
      expect(learningState.items.find((i) => i.id === LI_BRIEF)!.entries[0]!.note).toBe('עריכה של א'),
    );
    expect(puts.length).toBeGreaterThan(0);
    expect(puts.every((u) => u.includes(LI_BRIEF) && !u.includes(LI_BRIEF_B))).toBe(true);
    expect(learningState.items.find((i) => i.id === LI_BRIEF_B)!.entries[0]!.note).toBe('הערה של ב');
    server.events.removeAllListeners();
  });
});
