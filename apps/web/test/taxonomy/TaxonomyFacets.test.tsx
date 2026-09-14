import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { TaxonomyFacets } from '../../src/components/taxonomy/TaxonomyFacets.js';

describe('TaxonomyFacets', () => {
  it('toggles a doc type and adds/removes tags from the suggestion list', async () => {
    const onChange = vi.fn();
    renderWithProviders(<TaxonomyFacets value={{ docType: null, tags: [] }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /תפעול/ }));
    expect(onChange).toHaveBeenLastCalledWith({ docType: 'O', tags: [] });
    await userEvent.click(await screen.findByRole('button', { name: /^apn/ }));
    expect(onChange).toHaveBeenLastCalledWith({ docType: null, tags: ['apn'] });
  });

  it('renders the active state and clears it', async () => {
    const onChange = vi.fn();
    renderWithProviders(<TaxonomyFacets value={{ docType: 'O', tags: ['apn'] }} onChange={onChange} />);
    expect(screen.getByRole('button', { name: /תפעול/ })).toHaveClass('on');
    await userEvent.click(screen.getByRole('button', { name: /תפעול/ }));
    expect(onChange).toHaveBeenLastCalledWith({ docType: null, tags: ['apn'] });
  });
});
