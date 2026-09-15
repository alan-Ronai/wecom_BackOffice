/**
 * L2 and L3 — two controls that Tab can reach and the keyboard cannot use.
 *
 * L3: a modal's close `✕` was a `<span role="button">`. The app does carry a delegated bridge
 * (`bindRoleButtonKeys`) that activates such spans, but a dialog's close control is the one place
 * that must not depend on it: it is the escape hatch, it is inside a focus trap, and it is the
 * control a keyboard user reaches for first. It is a real `<button>` now.
 *
 * L2: the overflow menu closed on `Tab` without preventing the default, so the browser moved focus
 * to whatever came next in the document *and then* the menu unmounted from under it — focus fell
 * to `<body>` and the keyboard was nowhere. And the item list was keyed by label, so two items that
 * read the same (a world name appearing in two groups) collided in React's reconciler.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { renderWithProviders } from '../render.js';
import { useModal } from '../../src/components/ui/Modal.js';
import { OverflowMenu } from '../../src/components/ui/OverflowMenu.js';

function OpenAModal() {
  const modal = useModal();
  const open = modal.open;
  useEffect(() => {
    open({ title: 'חלון בדיקה', body: <p>גוף</p> });
  }, [open]);
  return null;
}

describe('L3 · the modal close control', () => {
  it('is a real button, and Enter closes the dialog', async () => {
    renderWithProviders(<OpenAModal />);
    const dialog = await screen.findByRole('dialog', { name: 'חלון בדיקה' });
    const close = screen.getByTitle('סגור (Esc)');
    expect(close.tagName).toBe('BUTTON');

    close.focus();
    expect(document.activeElement).toBe(close);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it('and so does Space', async () => {
    renderWithProviders(<OpenAModal />);
    const dialog = await screen.findByRole('dialog', { name: 'חלון בדיקה' });
    screen.getByTitle('סגור (Esc)').focus();
    await userEvent.keyboard(' ');
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });
});

describe('L2 · the overflow menu', () => {
  const items = [
    { label: 'פעולה', run: () => {} },
    // Two items that read the same: `key={it.label}` collapsed them into one React child.
    { label: 'תמיכה טכנית', run: () => {}, group: 'world', checked: true },
    { label: 'תמיכה טכנית', run: () => {}, group: 'topic' },
  ];

  it('gives two items that read the same two distinct keys', async () => {
    const warnings: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      warnings.push(a);
    });
    render(<OverflowMenu label="עוד" items={items} />);
    await userEvent.click(screen.getByRole('button', { name: 'עוד' }));
    expect(screen.getAllByText('תמיכה טכנית')).toHaveLength(2);
    // React's duplicate-key warning is the symptom: two children keyed the same are one child as
    // far as reconciliation is concerned, and the roving tabindex indexes by position.
    expect(warnings.some((a) => /same key/i.test(String(a[0])))).toBe(false);
    spy.mockRestore();
  });

  it('keeps focus somewhere usable when Tab closes it', async () => {
    render(
      <>
        <OverflowMenu label="עוד" items={items} />
        <button>אחרי</button>
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'עוד' });
    await userEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('menu', { name: 'עוד' })).toBeInTheDocument());

    // The browser's own focus move is what has to be suppressed: it happens *before* React unmounts
    // the menu, so without this the focus lands inside a layer that is about to disappear.
    let prevented: boolean | null = null;
    const watch = (e: KeyboardEvent) => {
      if (e.key === 'Tab') prevented = e.defaultPrevented;
    };
    document.addEventListener('keydown', watch);
    await userEvent.tab();
    document.removeEventListener('keydown', watch);

    expect(prevented).toBe(true);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    // Not `<body>`: the trigger is where a menu button's focus belongs once its menu is gone, and
    // the next Tab from there reaches what follows it in the document.
    expect(document.activeElement).toBe(trigger);
  });
});
