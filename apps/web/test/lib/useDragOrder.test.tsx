import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useDragOrder } from '../../src/lib/useDragOrder.js';

function List({
  ids,
  commit,
  enabled = true,
}: {
  ids: string[];
  commit: (n: string[]) => void;
  enabled?: boolean;
}) {
  const drag = useDragOrder(ids, commit, enabled);
  return (
    <ul>
      {ids.map((id, i) => (
        <li key={id} data-testid={id} {...drag.rowProps(i)}>
          {id}
        </li>
      ))}
    </ul>
  );
}

/** A `DataTransfer` stand-in: jsdom fires drag events with `dataTransfer: null`. */
const dt = () => {
  const store = new Map<string, string>();
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: (k: string, v: string) => void store.set(k, v),
    getData: (k: string) => store.get(k) ?? '',
  };
};

describe('useDragOrder', () => {
  it('moves the dragged row to the drop index rather than swapping the two', () => {
    const commit = vi.fn();
    render(<List ids={['a', 'b', 'c', 'd']} commit={commit} />);
    const transfer = dt();
    fireEvent.dragStart(screen.getByTestId('a'), { dataTransfer: transfer });
    fireEvent.dragOver(screen.getByTestId('d'), { dataTransfer: transfer });
    fireEvent.drop(screen.getByTestId('d'), { dataTransfer: transfer });
    // A swap would have produced d,b,c,a — which for anyone dragging reads as "nothing happened
    // to the rows in between".
    expect(commit).toHaveBeenCalledWith(['b', 'c', 'd', 'a']);
  });

  it('does not commit when the row is dropped on itself', () => {
    const commit = vi.fn();
    render(<List ids={['a', 'b']} commit={commit} />);
    const transfer = dt();
    fireEvent.dragStart(screen.getByTestId('a'), { dataTransfer: transfer });
    fireEvent.drop(screen.getByTestId('a'), { dataTransfer: transfer });
    expect(commit).not.toHaveBeenCalled();
  });

  it('marks the dragged row and the row under the pointer, and clears both on drag end', () => {
    render(<List ids={['a', 'b']} commit={vi.fn()} />);
    const transfer = dt();
    fireEvent.dragStart(screen.getByTestId('a'), { dataTransfer: transfer });
    fireEvent.dragOver(screen.getByTestId('b'), { dataTransfer: transfer });
    expect(screen.getByTestId('a')).toHaveAttribute('data-dragging');
    expect(screen.getByTestId('b')).toHaveAttribute('data-drop-target');
    fireEvent.dragEnd(screen.getByTestId('a'));
    expect(screen.getByTestId('a')).not.toHaveAttribute('data-dragging');
    expect(screen.getByTestId('b')).not.toHaveAttribute('data-drop-target');
  });

  it('is not draggable at all when disabled — a reader must not reorder anything', () => {
    render(<List ids={['a', 'b']} commit={vi.fn()} enabled={false} />);
    expect(screen.getByTestId('a')).toHaveAttribute('draggable', 'false');
  });
});
