import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { PromptsTab } from '../../src/components/admin/ai/PromptsTab.js';
import { aiAdminState } from '../msw/ai-admin.js';

describe('PromptsTab', () => {
  it('saves the brief and shows the version the server bumped it to', async () => {
    renderWithProviders(<PromptsTab />, { route: '/admin/ai' });
    const brief = await screen.findByLabelText('תיאור החברה');
    expect(brief).toHaveValue('wecom היא חברת תקשורת; הנציגים משרתים לקוחות פרטיים.');
    expect(await screen.findByText('גרסה 2')).toBeInTheDocument();

    fireEvent.change(brief, { target: { value: 'תיאור חדש' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'שמור' })[0]);

    await waitFor(() =>
      expect((aiAdminState.lastPut as { brief: { text: string } }).brief.text).toBe('תיאור חדש'),
    );
    expect(await screen.findByText('גרסה 3')).toBeInTheDocument();
  });

  it('shows the version history and the assembled system prompt on demand', async () => {
    renderWithProviders(<PromptsTab />, { route: '/admin/ai' });
    fireEvent.click(await screen.findByRole('button', { name: 'היסטוריית גרסאות' }));
    const history = await screen.findByRole('table', { name: 'היסטוריית גרסאות' });
    await waitFor(() => expect(history.querySelectorAll('tbody tr')).toHaveLength(3));
    expect(screen.getAllByText('תיאור החברה').length).toBeGreaterThan(1);
    expect(screen.getAllByText('נועה')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'תצוגת system prompt' }));
    expect(screen.getByText(/## על החברה/)).toBeInTheDocument();
  });
});
