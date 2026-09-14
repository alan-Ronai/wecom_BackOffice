import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaneModeToggle } from '../../src/components/source/PaneModeToggle.js';

describe('PaneModeToggle', () => {
  it('offers the three modes and disables source/split without a source', () => {
    const onChange = vi.fn();
    render(<PaneModeToggle value="work" onChange={onChange} hasSource={false} />);
    expect(screen.getByRole('button', { name: 'תצוגת עבודה' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'מקור' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'מפוצל' })).toBeDisabled();
  });

  it('emits the picked mode', () => {
    const onChange = vi.fn();
    render(<PaneModeToggle value="work" onChange={onChange} hasSource />);
    fireEvent.click(screen.getByRole('button', { name: 'מפוצל' }));
    expect(onChange).toHaveBeenCalledWith('split');
  });
});
