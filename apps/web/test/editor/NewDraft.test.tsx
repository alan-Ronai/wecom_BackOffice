/**
 * `/edit/new` used to live entirely in React state — the one route where "autosaved" was not
 * true. It now writes to `PUT /drafts/new/:draftId` and resumes from it.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { state } from '../msw/handlers.js';

const KEY = 'new:new';

describe('<EditorPage> — the server-side draft behind /edit/new', () => {
  it('autosaves a brand-new knowledge item to /drafts/new', async () => {
    renderWithProviders(<App />, { route: '/edit/new' });
    const title = await screen.findByLabelText('שם פריט הידע');
    await userEvent.type(title, 'תקלת SIM חדשה');

    await waitFor(
      () => expect((state.drafts.get(KEY) as { title?: string } | undefined)?.title).toBe('תקלת SIM חדשה'),
      { timeout: 3000 },
    );
  });

  it('resumes from that draft instead of starting empty', async () => {
    state.drafts.set(KEY, {
      id: 'new',
      slug: 'new-document',
      title: 'טיוטה שנשמרה בשרת',
      description: 'המשך מהמכונה השנייה',
      category: 'billing',
      wave: 3,
      priority: 'l',
      kind: 'steps',
      status: 'draft',
      currentVersion: 0,
      phases: [
        {
          id: 'p1',
          label: 'שלב 1',
          steps: [
            { key: 's1', num: '1', title: 'שלב שנשמר', blockRefs: [], deps: [], actions: [], outcomes: [] },
          ],
        },
      ],
      related: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    renderWithProviders(<App />, { route: '/edit/new' });

    await waitFor(() => expect(screen.getByLabelText('שם פריט הידע')).toHaveValue('טיוטה שנשמרה בשרת'));
    expect(screen.getByLabelText('תיאור קצר')).toHaveValue('המשך מהמכונה השנייה');
    expect(screen.getByLabelText('קטגוריה')).toHaveValue('billing');
  });

  it('discards the new-document draft once the document is created and published', async () => {
    state.drafts.set(KEY, {
      id: 'new',
      slug: 'new-document',
      title: 'פריט להעלאה',
      description: 'תיאור',
      category: 'tech',
      wave: 2,
      priority: 'm',
      kind: 'steps',
      status: 'draft',
      currentVersion: 0,
      phases: [
        {
          id: 'p1',
          label: 'שלב 1',
          steps: [
            {
              key: 's1',
              num: '1',
              title: 'שלב',
              blockRefs: [],
              deps: [],
              actions: [{ id: 'a1', text: 'פעולה' }],
              outcomes: [{ kind: 'ok', text: '✓ הסתדר' }],
            },
          ],
        },
      ],
      related: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    renderWithProviders(<App />, { route: '/edit/new' });
    await waitFor(() => expect(screen.getByLabelText('שם פריט הידע')).toHaveValue('פריט להעלאה'));

    await userEvent.click(screen.getByRole('button', { name: /פרסם v1/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'אישור' }));

    await waitFor(() => expect(state.published.length).toBe(1));
    // Otherwise the next "✚ פריט ידע חדש" would resume a document that is already published.
    await waitFor(() => expect(state.drafts.has(KEY)).toBe(false));
  });
});
