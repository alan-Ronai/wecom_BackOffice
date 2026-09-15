import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { learningState } from '../msw/learning-manage.js';
import { LI_QUIZ } from '../msw/fixtures.js';

/**
 * `RichText` is TipTap, which does not type in jsdom — but the thing under test is not TipTap, it
 * is what the editor does with a callback that fires on *every keystroke*. The stub keeps exactly
 * that contract (`onUpdate → onChange(html)`) and nothing else.
 */
vi.mock('../../src/components/source/RichText.js', () => ({
  RichText: ({
    value,
    onChange,
    label,
  }: {
    value: string;
    onChange: (html: string) => void;
    label?: string;
  }) => <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
}));

describe('the learning item intro (B-C2)', () => {
  const patches: unknown[] = [];
  beforeEach(() => {
    patches.length = 0;
    server.use(
      withMe({
        roles: ['editor'],
        permissions: ['docs.read', 'learning.read', 'learning.manage'],
      }),
      http.patch('/api/v1/learning/items/:id', async ({ params, request }) => {
        const body = (await request.json()) as object;
        patches.push(body);
        const item = learningState.items.find((i) => i.id === String(params.id))!;
        Object.assign(item, body);
        return HttpResponse.json(item);
      }),
    );
  });

  it('holds the intro locally while typing and PATCHes once on blur', async () => {
    renderWithProviders(<App />, { route: `/learning/manage/${LI_QUIZ}` });
    const intro = await screen.findByLabelText('הקדמה');
    await userEvent.type(intro, 'רקע');
    // Not one request per character — and so no invalidation storm resetting the caret either.
    expect(patches).toHaveLength(0);
    await userEvent.tab();
    await waitFor(() => expect(patches).toEqual([{ description: 'רקע' }]));
    // Blurring again with nothing changed is not a write.
    await userEvent.click(intro);
    await userEvent.tab();
    expect(patches).toHaveLength(1);
  });
});
