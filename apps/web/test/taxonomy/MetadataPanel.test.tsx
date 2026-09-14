import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { MetadataPanel, type MetadataValue } from '../../src/components/editor/MetadataPanel.js';
import { fx } from '../msw/fixtures.js';

const base: MetadataValue = { docType: 'R', category: 'tech', worlds: [], topics: [], tags: [] };

describe('MetadataPanel', () => {
  it('changes type, primary world, extra worlds, topics and tags', async () => {
    const onChange = vi.fn();
    renderWithProviders(<MetadataPanel value={base} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText('סוג פריט'), 'O');
    expect(onChange).toHaveBeenLastCalledWith({ ...base, docType: 'O' });
    await screen.findByRole('option', { name: 'SIM / eSIM' });
    await userEvent.selectOptions(screen.getByLabelText('עולם תוכן ראשי'), 'sim');
    expect(onChange).toHaveBeenLastCalledWith({ ...base, category: 'sim' });
    await userEvent.click(within(screen.getByTestId('extra-worlds')).getByLabelText('חיובים'));
    expect(onChange).toHaveBeenLastCalledWith({ ...base, worlds: ['billing'] });
    const topicBox = await within(screen.getByTestId('topics')).findByLabelText(fx.topics[1]!.name);
    await userEvent.click(topicBox);
    expect(onChange).toHaveBeenLastCalledWith({ ...base, topics: [fx.topics[1]!.id] });
    await userEvent.type(screen.getByLabelText('הוסף תגית'), 'apn{enter}');
    expect(onChange).toHaveBeenLastCalledWith({ ...base, tags: ['apn'] });
  });

  it('moving the primary world drops it from the extras and clears the topics', async () => {
    // The one non-trivial branch in the panel, and the one the tests started from empty
    // `worlds`/`topics` and therefore never exercised: the topics belong to the world being left.
    const onChange = vi.fn();
    const filled: MetadataValue = {
      ...base,
      worlds: ['sim', 'billing'],
      topics: [fx.topics[0]!.id],
    };
    renderWithProviders(<MetadataPanel value={filled} onChange={onChange} />);
    await screen.findByRole('option', { name: 'SIM / eSIM' });
    await userEvent.selectOptions(screen.getByLabelText('עולם תוכן ראשי'), 'sim');
    expect(onChange).toHaveBeenLastCalledWith({
      ...filled,
      category: 'sim',
      worlds: ['billing'],
      topics: [],
    });
  });

  it('does not list the primary world among the extra worlds and removes tags', async () => {
    const onChange = vi.fn();
    renderWithProviders(<MetadataPanel value={{ ...base, tags: ['apn', 'x'] }} onChange={onChange} />);
    await screen.findByTestId('extra-worlds');
    expect(within(screen.getByTestId('extra-worlds')).queryByLabelText('תמיכה טכנית')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'הסר תגית apn' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...base, tags: ['x'] });
  });
});
