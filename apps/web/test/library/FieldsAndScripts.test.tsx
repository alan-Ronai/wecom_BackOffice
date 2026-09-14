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

/**
 * Scripts stopped being their own resource at the 0030 fold — a script is a `docType: 'T'`,
 * `kind: 'text'` document — and the `/scripts*` adapter routes that kept the old shape alive for
 * one release are gone. The library filtered to that type is the scripts page now: it lists them,
 * `/edit/:id` edits the body, `POST /documents` creates them.
 */
describe('scripts are type-T documents', () => {
  it('redirects /scripts to the library filtered to type T', async () => {
    renderWithProviders(<App />, { route: '/scripts' });
    expect(await screen.findByText(fx.scriptCards[0].title)).toBeInTheDocument();
    // The old page and its own create form are gone, not hidden.
    expect(screen.queryByRole('button', { name: '✚ תסריט חדש' })).not.toBeInTheDocument();
  });

  it('is reachable from the sidebar scripts.json row, which counts the type-T documents', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const sidebar = await screen.findByLabelText('ניווט ראשי');
    const row = within(sidebar).getByText('scripts.json').closest('.src-row')!;
    await waitFor(() => expect(row.textContent).toContain(String(fx.scriptCards.length)));
    await userEvent.click(within(sidebar).getByText('scripts.json'));
    expect(await screen.findByText(fx.scriptCards[0].title)).toBeInTheDocument();
  });

  it('offers the phrasing in the step-level picker, read from the type-T card body', async () => {
    renderWithProviders(<App />, { route: `/doc/${fx.docBrowsing.id}` });
    await userEvent.click(await screen.findByLabelText('הסבר ללקוח'));
    const picker = await screen.findByRole('dialog', { name: 'תסריטים לשלב זה' });
    // `bodyHtml` decoded back to the text an agent reads out — not the markup, not the title.
    expect(within(picker).getByText(/אתה לא גולש בכלל/)).toBeInTheDocument();
    expect(within(picker).getAllByText(/משמש ב-מסמך אחד/).length).toBeGreaterThan(0);
  });
});
