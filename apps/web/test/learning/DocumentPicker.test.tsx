import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../render.js';
import { server } from '../msw/server.js';
import { DocumentPicker } from '../../src/components/learning/manage/DocumentPicker.js';

const HITS = ['אלפא', 'בטא', 'גמא'].map((title, i) => ({
  type: 'document' as const,
  id: `00000000-0000-4000-8000-00000000000${i + 1}`,
  title,
  snippet: '',
  meta: 'מאמר',
  score: 1 - i / 10,
}));

beforeEach(() => {
  server.use(
    http.get('*/api/v1/search', () =>
      HttpResponse.json({
        groups: [{ type: 'documents', hits: HITS }],
        total: HITS.length,
        tookMs: 1,
        files: 0,
      }),
    ),
  );
});

const setup = (props: { exclude?: string[] } = {}) => {
  const onPick = vi.fn();
  renderWithProviders(<DocumentPicker onPick={onPick} {...props} />);
  const input = screen.getByRole('combobox', { name: 'הוסף פריט ידע' });
  return { onPick, input };
};

const openList = async (input: HTMLElement) => {
  await userEvent.type(input, 'חיפוש');
  await screen.findByRole('option', { name: /אלפא/ });
};

describe('DocumentPicker — ARIA combobox', () => {
  it('wires the input as a collapsed combobox that controls the listbox', async () => {
    const { input } = setup();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    const listId = input.getAttribute('aria-controls');
    expect(listId).toBeTruthy();
    expect(input).not.toHaveAttribute('aria-activedescendant');

    await openList(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('listbox', { name: 'תוצאות' });
    expect(list.id).toBe(listId);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    // Options, not buttons: a screen reader hears "option", and they are not in the tab order.
    for (const o of options) {
      expect(o.tagName).not.toBe('BUTTON');
      expect(o).toHaveAttribute('aria-selected', 'false');
    }
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('ArrowDown/ArrowUp move the active descendant, wrapping; focus stays in the input', async () => {
    const { input } = setup();
    await openList(input);
    const options = screen.getAllByRole('option');

    await userEvent.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', options[2]!.id);
    await userEvent.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id);
    await userEvent.keyboard('{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', options[2]!.id);
    expect(options[2]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    await userEvent.keyboard('{Home}');
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id);
    await userEvent.keyboard('{End}');
    expect(input).toHaveAttribute('aria-activedescendant', options[2]!.id);
    expect(input).toHaveFocus();
  });

  it('Enter picks the active option and clears the query', async () => {
    const { input, onPick } = setup();
    await openList(input);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith({ id: HITS[1]!.id, title: 'בטא' });
    expect(input).toHaveValue('');
    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'false'));
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });

  it('Enter with no active option picks nothing and does not submit an enclosing form', async () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    const onPick = vi.fn();
    renderWithProviders(
      <form onSubmit={onSubmit}>
        <DocumentPicker onPick={onPick} />
      </form>,
    );
    const input = screen.getByRole('combobox', { name: 'הוסף פריט ידע' });
    await openList(input);
    await userEvent.keyboard('{Enter}');
    expect(onPick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Escape closes the list without clearing the query or bubbling; ArrowDown reopens it', async () => {
    const outer = vi.fn();
    const onPick = vi.fn();
    renderWithProviders(
      <div onKeyDown={(e) => e.key === 'Escape' && outer()}>
        <DocumentPicker onPick={onPick} />
      </div>,
    );
    const input = screen.getByRole('combobox', { name: 'הוסף פריט ידע' });
    await openList(input);
    await userEvent.keyboard('{ArrowDown}{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).not.toHaveAttribute('aria-activedescendant');
    expect(screen.queryByRole('option')).toBeNull();
    expect(input).toHaveValue('חיפוש');
    expect(outer).not.toHaveBeenCalled();

    await userEvent.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0]!.id);
  });

  it('the mouse still picks, and keeps focus in the input while pressing', async () => {
    const { input, onPick } = setup();
    await openList(input);
    await userEvent.click(screen.getByRole('option', { name: /גמא/ }));
    expect(onPick).toHaveBeenCalledWith({ id: HITS[2]!.id, title: 'גמא' });
    expect(input).toHaveFocus();
    expect(input).toHaveValue('');
  });

  it('hovering an option makes it the active one', async () => {
    const { input } = setup();
    await openList(input);
    const beta = screen.getByRole('option', { name: /בטא/ });
    await userEvent.hover(beta);
    expect(input).toHaveAttribute('aria-activedescendant', beta.id);
  });

  it('leaves out excluded documents', async () => {
    const { input } = setup({ exclude: [HITS[0]!.id] });
    await userEvent.type(input, 'חיפוש');
    await screen.findByRole('option', { name: /בטא/ });
    expect(screen.queryByRole('option', { name: /אלפא/ })).toBeNull();
  });
});
