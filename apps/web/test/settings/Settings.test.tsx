import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { state } from '../msw/handlers.js';

const openSettings = async () => {
  await screen.findAllByText('ספריית ידע');
  await userEvent.click(await screen.findByTitle('הגדרות'));
  return screen.findByRole('dialog', { name: /תצוגה וטיפוגרפיה/ });
};

describe('settings', () => {
  it('switches the font system live and persists it', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await openSettings();
    await userEvent.click(await screen.findByText('מצב נוכחי (Rubik)'));
    await waitFor(() => expect(document.documentElement.dataset.font).toBe('rubik'));
    await waitFor(() => expect(state.preferences.font).toBe('rubik'));
  });

  it('switches the theme and hides the panel', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await openSettings();
    await userEvent.click(await screen.findByText('כהה'));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    await userEvent.click(screen.getByText('מוסתר'));
    await waitFor(() => expect(state.preferences.panel).toBe(false));
  });

  it('shows the live type sample', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const dialog = await openSettings();
    expect(dialog.querySelector('.type-sample')).not.toBeNull();
    expect(dialog.querySelectorAll('.type-sample bdi.lat').length).toBeGreaterThan(0);
  });
});
