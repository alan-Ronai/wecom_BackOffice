import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocCard } from '../../src/components/library/DocCard.js';
import { fx } from '../msw/fixtures.js';

/**
 * Wave Y review: the card opens on Enter only when the card itself has focus. Enter on the star or
 * the kebab inside it bubbles up to the card, and used to open the document on top of pinning.
 */
describe('<DocCard> keyboard', () => {
  const card = fx.cards[0]!;
  const mount = () => {
    const onOpen = vi.fn();
    const onPin = vi.fn();
    const onMenu = vi.fn();
    const { container } = render(<DocCard card={card} onOpen={onOpen} onPin={onPin} onMenu={onMenu} />);
    const root = container.querySelector(`[data-doc="${card.id}"]`) as HTMLElement;
    return { onOpen, onPin, onMenu, root };
  };

  it('opens on Enter when the card itself is focused', async () => {
    const { onOpen, root } = mount();
    root.focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('Enter on the star pins without opening', async () => {
    const { onOpen, onPin } = mount();
    screen.getByRole('button', { name: new RegExp(`הצמד.*${card.title}|בטל הצמדה.*${card.title}`) }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onPin).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('Enter on the kebab opens the menu without opening the card', async () => {
    const { onOpen, onMenu } = mount();
    screen.getByRole('button', { name: `פעולות · ${card.title}` }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('ignores an Enter bubbling from any descendant, and one already handled', () => {
    const { onOpen, root } = mount();
    fireEvent.keyDown(root.lastElementChild!, { key: 'Enter' });
    const handled = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    handled.preventDefault();
    root.dispatchEvent(handled);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
