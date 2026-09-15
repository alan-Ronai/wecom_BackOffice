/**
 * A-6's overflow menu, as a component: the keyboard contract and the ARIA the article topbar
 * depends on when it collapses on a phone.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OverflowMenu, type OverflowItem } from '../../src/components/ui/OverflowMenu.js';

const items = (over: Partial<Record<string, unknown>> = {}): OverflowItem[] => [
  { label: 'ראשון', run: vi.fn() },
  { label: 'אמצעי', run: vi.fn(), ...over },
  { label: 'אחרון', run: vi.fn() },
];

const mount = (list: OverflowItem[] = items()) => render(<OverflowMenu label="פעולות נוספות" items={list} />);

const trigger = () => screen.getByRole('button', { name: 'פעולות נוספות' });

describe('<OverflowMenu>', () => {
  it('reports its state through aria-expanded and owns the menu it opens', async () => {
    mount();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await userEvent.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'פעולות נוספות' });
    // The trigger points at the menu it actually opened, not at a guessed id.
    expect(trigger()).toHaveAttribute('aria-controls', menu.getAttribute('id'));
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(3);
  });

  it('opens at the first item on ArrowDown and the last on ArrowUp', async () => {
    mount();
    trigger().focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'ראשון' })).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    expect(trigger()).toHaveFocus();

    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'אחרון' })).toHaveFocus();
  });

  it('cycles with the arrows and jumps with Home/End', async () => {
    mount();
    await userEvent.click(trigger());
    expect(screen.getByRole('menuitem', { name: 'ראשון' })).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'אמצעי' })).toHaveFocus();

    // Wraps past the end rather than stopping.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'ראשון' })).toHaveFocus();

    await userEvent.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'אחרון' })).toHaveFocus();

    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: 'ראשון' })).toHaveFocus();
  });

  it('runs an item and closes, by click and by Enter', async () => {
    const list = items();
    mount(list);

    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('menuitem', { name: 'אמצעי' }));
    expect(list[1]!.run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(trigger());
    await userEvent.keyboard('{Enter}');
    expect(list[0]!.run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renders a checked group as radios and skips a disabled item', async () => {
    const list: OverflowItem[] = [
      { label: 'עבודה', group: 'pane', checked: true, run: vi.fn() },
      { label: 'מקור', group: 'pane', checked: false, disabled: true, run: vi.fn() },
      { label: 'מפוצל', group: 'pane', checked: false, run: vi.fn() },
    ];
    mount(list);
    await userEvent.click(trigger());

    const radios = screen.getAllByRole('menuitemradio');
    expect(radios).toHaveLength(3);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    expect(radios[1]).toHaveAttribute('aria-disabled', 'true');

    // The disabled mode is skipped by the roving focus rather than trapping it.
    expect(radios[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(radios[2]).toHaveFocus();

    await userEvent.click(radios[1]!);
    expect(list[1]!.run).not.toHaveBeenCalled();
  });

  it('closes on an outside click without stealing focus back', async () => {
    render(
      <>
        <OverflowMenu label="פעולות נוספות" items={items()} />
        <button type="button">בחוץ</button>
      </>,
    );
    await userEvent.click(trigger());
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'בחוץ' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).not.toHaveFocus();
  });
});
