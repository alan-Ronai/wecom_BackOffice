import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import {
  TaxonomyFacets,
  type TaxonomyFacetValue,
} from '../../src/components/taxonomy/TaxonomyFacets.js';

const empty: TaxonomyFacetValue = { world: null, topic: null, docType: null, tags: [] };

describe('TaxonomyFacets', () => {
  it('toggles a doc type and adds/removes tags from the suggestion list', async () => {
    const onChange = vi.fn();
    renderWithProviders(<TaxonomyFacets value={{ ...empty }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /תפעול/ }));
    expect(onChange).toHaveBeenLastCalledWith({ ...empty, docType: 'O' });
    await userEvent.click(await screen.findByRole('button', { name: /^apn/ }));
    expect(onChange).toHaveBeenLastCalledWith({ ...empty, tags: ['apn'] });
  });

  it('renders the active state and clears it', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TaxonomyFacets value={{ ...empty, docType: 'O', tags: ['apn'] }} onChange={onChange} />,
    );
    expect(screen.getByRole('button', { name: /תפעול/ })).toHaveClass('on');
    await userEvent.click(screen.getByRole('button', { name: /תפעול/ }));
    expect(onChange).toHaveBeenLastCalledWith({ ...empty, docType: null, tags: ['apn'] });
  });

  /**
   * The parked ruling was that world and topic are chosen from the sidebar and the topic page,
   * with `?world=`/`?topic=` honoured in the URL — so a *link* could reproduce any combination
   * but an agent could not narrow to a second world from the toolbar without losing the type and
   * tag filters they had built up.
   */
  it('offers the worlds from GET /worlds and reports the slug', async () => {
    const onChange = vi.fn();
    renderWithProviders(<TaxonomyFacets value={{ ...empty }} onChange={onChange} />);
    const world = screen.getByLabelText('עולם תוכן');
    expect(await screen.findByRole('option', { name: 'תמיכה טכנית' })).toBeInTheDocument();
    await userEvent.selectOptions(world, 'tech');
    expect(onChange).toHaveBeenLastCalledWith({ ...empty, world: 'tech' });
  });

  it('disables the topic select until a world is chosen', () => {
    renderWithProviders(<TaxonomyFacets value={{ ...empty }} onChange={vi.fn()} />);
    expect(screen.getByLabelText('נושא')).toBeDisabled();
  });

  it('scopes the topic select to the chosen world', async () => {
    const onChange = vi.fn();
    renderWithProviders(<TaxonomyFacets value={{ ...empty, world: 'tech' }} onChange={onChange} />);
    const topic = screen.getByLabelText('נושא');
    expect(topic).toBeEnabled();
    const option = await screen.findByRole('option', { name: 'תקלות גלישה' });
    await userEvent.selectOptions(topic, option.getAttribute('value')!);
    expect(onChange).toHaveBeenLastCalledWith({
      ...empty,
      world: 'tech',
      topic: option.getAttribute('value'),
    });
  });

  it('clears the topic when the world changes, because a topic belongs to one world', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TaxonomyFacets value={{ ...empty, world: 'tech', topic: 't1' }} onChange={onChange} />,
    );
    await screen.findByRole('option', { name: 'חיובים' });
    await userEvent.selectOptions(screen.getByLabelText('עולם תוכן'), 'billing');
    expect(onChange).toHaveBeenLastCalledWith({ ...empty, world: 'billing', topic: null });
  });
});
