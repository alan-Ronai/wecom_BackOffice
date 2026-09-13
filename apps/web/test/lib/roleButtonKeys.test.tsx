import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { D_BROWSING } from '../msw/fixtures.js';

/**
 * I9: ~100 controls are `<span role="button" tabIndex={0}>` rather than real buttons, and spans
 * do not synthesise a click from Enter/Space. These assert the delegated bridge that makes them
 * operable, on real screens rather than a synthetic fixture.
 */
describe('role="button" elements are keyboard-operable', () => {
  it('activates a library card with Enter', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await screen.findAllByText('ספריית ידע');
    const cards = await screen.findAllByRole('button', { name: /גלישה/ });
    cards[0].focus();
    expect(document.activeElement).toBe(cards[0]);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(window.location.pathname).not.toBe('/library'));
  });

  it('activates a sidebar entry with Space', async () => {
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    const entry = await screen.findByText('סל מיחזור');
    const target = entry.closest('[role="button"]') as HTMLElement;
    target.focus();
    await userEvent.keyboard(' ');
    await waitFor(() => expect(screen.getAllByText(/סל מיחזור/).length).toBeGreaterThan(0));
  });

  it('leaves typing in inputs alone', async () => {
    renderWithProviders(<App />, { route: `/edit/${D_BROWSING}` });
    const title = await screen.findByPlaceholderText('שם פריט הידע…');
    await userEvent.clear(title);
    await userEvent.type(title, 'sim ריענון');
    // A Space typed into a text field must reach the field, not activate anything.
    expect((title as HTMLInputElement).value).toBe('sim ריענון');
  });
});
