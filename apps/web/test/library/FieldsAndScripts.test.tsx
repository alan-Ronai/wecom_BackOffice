/**
 * The two "missing features" rows from `review-frontend.md`: `DELETE /fields/{name}` and
 * `POST`/`PUT`/`DELETE /scripts` existed on the API with no UI at all.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { server } from '../msw/server.js';
import { withMe } from '../msw/handlers.js';
import { fx } from '../msw/fixtures.js';
import { state } from '../msw/handlers.js';

describe('CRM fields — deletion', () => {
  it('deletes a field after confirming, and names the documents that reference it', async () => {
    const name = fx.fields[0].name;
    renderWithProviders(<App />, { route: '/fields' });
    await screen.findByRole('heading', { name: /שדות CRM/ });

    await userEvent.click(await screen.findByLabelText(`מחק את השדה ${name}`));

    // The confirmation has to say what breaks — the chips in referencing documents go "unknown".
    expect(await screen.findByText(/יסומנו כשדה לא מוכר|אף מסמך לא מפנה אליו/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'מחק שדה' }));

    await waitFor(() => expect(state.fields.some((f) => f.name === name)).toBe(false));
    await screen.findByText(`השדה ${name} נמחק`);
  });

  it('hides the delete control without fields.edit', async () => {
    server.use(withMe({ permissions: ['docs.read'] }));
    renderWithProviders(<App />, { route: '/fields' });
    await screen.findByRole('heading', { name: /שדות CRM/ });
    expect(screen.queryByLabelText(/^מחק את השדה/)).not.toBeInTheDocument();
  });
});

describe('<ScriptsPage>', () => {
  it('creates, edits and deletes a script', async () => {
    renderWithProviders(<App />, { route: '/scripts' });
    await screen.findByRole('heading', { name: /תסריטים/ });
    expect(await screen.findByText(fx.scripts[0].title)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '✚ תסריט חדש' }));
    await userEvent.type(screen.getByLabelText('שם התסריט'), 'פתיחת שיחה');
    await userEvent.type(screen.getByLabelText('נוסח התסריט'), '"שלום, הגעת לתמיכה הטכנית"');
    await userEvent.type(screen.getByLabelText('תגיות'), 'tech, opening');
    await userEvent.click(screen.getByRole('button', { name: 'צור תסריט' }));

    await screen.findByText('פתיחת שיחה');
    await waitFor(() => expect(state.scripts.some((s) => s.title === 'פתיחת שיחה')).toBe(true));
    expect(state.scripts.at(-1)?.tags).toEqual(['tech', 'opening']);

    await userEvent.click(await screen.findByLabelText('ערוך את פתיחת שיחה'));
    const title = screen.getByLabelText('שם התסריט');
    await userEvent.clear(title);
    await userEvent.type(title, 'פתיחת שיחה · גרסה 2');
    await userEvent.click(screen.getByRole('button', { name: 'שמור שינויים' }));
    await waitFor(() => expect(state.scripts.at(-1)?.title).toBe('פתיחת שיחה · גרסה 2'));

    await userEvent.click(await screen.findByLabelText('מחק את פתיחת שיחה · גרסה 2'));
    await userEvent.click(await screen.findByRole('button', { name: 'מחק' }));
    await waitFor(() => expect(state.scripts.some((s) => s.title.startsWith('פתיחת שיחה'))).toBe(false));
  });

  it('offers only copy without scripts.edit', async () => {
    server.use(withMe({ permissions: ['docs.read'] }));
    renderWithProviders(<App />, { route: '/scripts' });
    await screen.findByRole('heading', { name: /תסריטים/ });
    await screen.findByText(fx.scripts[0].title);
    expect(screen.queryByRole('button', { name: '✚ תסריט חדש' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^ערוך את /)).not.toBeInTheDocument();
    expect(screen.getByLabelText(`העתק את ${fx.scripts[0].title}`)).toBeInTheDocument();
  });

  it('is reachable from the sidebar scripts.json row', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const sidebar = await screen.findByLabelText('ניווט ראשי');
    await userEvent.click(within(sidebar).getByText('scripts.json'));
    await screen.findByRole('heading', { name: /תסריטים/ });
  });
});
