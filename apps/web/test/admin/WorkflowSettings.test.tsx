import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { WorkflowSettingsSection } from '../../src/components/admin/WorkflowSettingsSection.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { learningState } from '../msw/learning-manage.js';

describe('WorkflowSettingsSection', () => {
  it('toggles requireApprover and saves learning/gaps thresholds', async () => {
    server.use(withMe({ roles: ['admin'], permissions: ['system.admin', 'docs.read'] }));
    renderWithProviders(<WorkflowSettingsSection />);
    const toggle = await screen.findByRole('checkbox', { name: 'דרוש מאשר לפרסום' });
    await userEvent.click(toggle);
    await waitFor(() => expect(learningState.workflow.requireApprover).toBe(true));
    const stale = screen.getByLabelText('פריט נחשב מיושן אחרי (ימים)');
    await userEvent.clear(stale);
    await userEvent.type(stale, '120');
    await userEvent.click(screen.getByRole('button', { name: 'שמור הגדרות' }));
    await waitFor(() => expect(learningState.workflow.gaps.staleDays).toBe(120));
    // The deep patch leaves the untouched halves alone.
    expect(learningState.workflow.learning.defaultPassMark).toBe(80);
  });

  it('renders read-only without system.admin', async () => {
    server.use(withMe({ roles: ['lead'], permissions: ['docs.read'] }));
    renderWithProviders(<WorkflowSettingsSection />);
    expect(await screen.findByRole('checkbox', { name: 'דרוש מאשר לפרסום' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'שמור הגדרות' })).toBeNull();
  });
});
