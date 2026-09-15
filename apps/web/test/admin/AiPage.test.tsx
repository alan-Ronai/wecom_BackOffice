import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { AiPage, TAB_LABELS } from '../../src/components/admin/AiPage.js';
import { server } from '../msw/server.js';
import { withMe } from '../msw/handlers.js';

describe('AiPage', () => {
  it('refuses without ai.manage', async () => {
    server.use(withMe({ permissions: ['docs.read', 'ai.chat'] }));
    renderWithProviders(<AiPage />, { route: '/admin/ai' });
    expect(await screen.findByText('אין הרשאה לניהול הבינה המלאכותית')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('renders five tabs and moves between them with arrow keys (RTL)', async () => {
    renderWithProviders(<AiPage />, { route: '/admin/ai' });
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(TAB_LABELS.map((t) => t.label));
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' }); // RTL: left is forward
    expect(screen.getByRole('tab', { name: 'מודלים' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'מודלים' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'הנחיות' })).toHaveAttribute('aria-selected', 'true');
    // The last three tabs are lazy, so the switch commits when their chunk resolves.
    fireEvent.keyDown(screen.getByRole('tab', { name: 'הנחיות' }), { key: 'End' });
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'שיחות' })).toHaveAttribute('aria-selected', 'true'),
    );
  });

  it('opens the tab named in the URL', async () => {
    renderWithProviders(<AiPage />, { route: '/admin/ai?tab=models' });
    expect(await screen.findByRole('tab', { name: 'מודלים' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByLabelText('דרגה')).toBeInTheDocument();
  });
});
