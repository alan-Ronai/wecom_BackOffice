import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { renderWithProviders } from '../render.js';
import { PublishFeedbackPicker } from '../../src/components/feedback/PublishFeedbackPicker.js';
import { feedbackState, sampleFeedback } from '../msw/feedback-handlers.js';
import { fx } from '../msw/fixtures.js';

function Host() {
  const [ids, setIds] = useState<string[]>([]);
  return (
    <>
      <PublishFeedbackPicker documentId={fx.docBrowsing.id} value={ids} onChange={setIds} />
      <output data-testid="ids">{ids.join(',')}</output>
    </>
  );
}

describe('<PublishFeedbackPicker>', () => {
  beforeEach(() => {
    feedbackState.items = [
      sampleFeedback({ id: 'f0000000-0000-4000-8000-000000000001', kind: 'error' }),
      sampleFeedback({ id: 'f0000000-0000-4000-8000-000000000002', kind: 'other', status: 'done' }),
    ];
  });

  it('lists only open reports and toggles ids', async () => {
    renderWithProviders(<Host />);
    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes).toHaveLength(1);
    await userEvent.click(boxes[0]);
    expect(screen.getByTestId('ids')).toHaveTextContent('f0000000-0000-4000-8000-000000000001');
    await userEvent.click(boxes[0]);
    expect(screen.getByTestId('ids')).toHaveTextContent('');
  });

  it('renders nothing when there is no open feedback', async () => {
    feedbackState.items = [];
    const { container } = renderWithProviders(<Host />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('.publish-feedback')).toBeNull();
  });
});
