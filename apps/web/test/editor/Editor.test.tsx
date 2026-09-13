import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { state, withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { D_BROWSING } from '../msw/fixtures.js';

const D = D_BROWSING;

describe('<EditorPage>', () => {
  it('autosaves a draft after typing and publishes with a label', async () => {
    renderWithProviders(<App />, { route: `/edit/${D}` });
    const title = await screen.findByPlaceholderText('שם פריט הידע…');
    await userEvent.type(title, ' – מעודכן');
    await waitFor(() => expect(state.drafts.has(D)).toBe(true), { timeout: 3000 });
    expect(await screen.findByText(/נשמר/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /פרסם v8/ }));
    await userEvent.type(await screen.findByLabelText('מה השתנה? (מופיע בהיסטוריית הגרסאות)'), 'עדכון כותרת');
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }));
    await waitFor(() => expect(state.published).toEqual([{ id: D, label: 'עדכון כותרת' }]));
  });

  it('inserts a shared block from the library and shows the shared box', async () => {
    renderWithProviders(<App />, { route: `/edit/${D}` });
    await screen.findByPlaceholderText('שם פריט הידע…');
    const before = document.querySelectorAll('.ebox.shared').length;
    await userEvent.click(screen.getAllByText('ריענון SIM')[0]);
    await waitFor(() => expect(document.querySelectorAll('.ebox.shared').length).toBeGreaterThan(before));
  });

  it('switches the side pane to JSON and Diff', async () => {
    renderWithProviders(<App />, { route: `/edit/${D}` });
    await screen.findByPlaceholderText('שם פריט הידע…');
    await userEvent.click(screen.getByText('JSON'));
    expect(document.querySelector('.ed-side pre')?.textContent).toContain('"slug": "browsing"');
    await userEvent.click(screen.getByText('Diff'));
    expect(document.querySelector('.diff-cols')).not.toBeNull();
  });

  it('runs the pre-publish checks', async () => {
    renderWithProviders(<App />, { route: `/edit/${D}` });
    await screen.findByPlaceholderText('שם פריט הידע…');
    expect(await screen.findByText('בדיקות לפני פרסום')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('✓ כל שדות CRM קיימים ב-crm-fields.json')).toBeInTheDocument(),
    );
  });

  it('hides publish without docs.publish', async () => {
    server.use(withMe({ permissions: ['docs.read', 'docs.edit'] }));
    renderWithProviders(<App />, { route: `/edit/${D}` });
    await screen.findByPlaceholderText('שם פריט הידע…');
    await waitFor(() => expect(screen.queryByRole('button', { name: /פרסם/ })).toBeNull());
    // "בקש סקירה" is gone: it PATCHed an empty body and toasted success without persisting.
    expect(screen.queryByRole('button', { name: 'בקש סקירה' })).toBeNull();
    expect(screen.getByRole('button', { name: 'ייצוא JSON' })).toBeInTheDocument();
  });
});
