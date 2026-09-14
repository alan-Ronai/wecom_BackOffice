/**
 * Article QOL, card 6b: presence, inline step comments with `@` autocomplete, the
 * "הסבר ללקוח" script picker, the breadcrumb quick-switch and telemetry batching.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { server } from '../msw/server.js';
import { state, withMe } from '../msw/handlers.js';
import { D_BROWSING, D_INTL, fx } from '../msw/fixtures.js';
import { stage45State } from '../msw/stage45.js';

const route = (step = 's8') => `/doc/${D_BROWSING}/${step}`;
const openArticle = async (step?: string) => {
  const r = renderWithProviders(<App />, { route: route(step) });
  await screen.findByRole('heading', { name: /איטיות גלישה/ });
  return r;
};

describe('presence', () => {
  it('shows who else has the document open and heartbeats', async () => {
    await openArticle();
    await screen.findByLabelText(/דנה ר\. פתוחים כרגע/);
    await waitFor(() => expect(stage45State.heartbeats).toContain(D_BROWSING));
  });
});

describe('inline step comments', () => {
  it('renders the existing thread for the step and its open-comment badge', async () => {
    await openArticle();
    await screen.findByText(/Speedtest חוסם/);
    expect(screen.getAllByText(/💬 1/).length).toBeGreaterThan(0);
  });

  it('posts a comment with an @mention resolved from /users/mentionable', async () => {
    await openArticle();
    const box = await screen.findByLabelText('הערה לשלב s8');

    await userEvent.type(box, 'צריך לבדוק גם VPN @דנ');
    const option = await screen.findByRole('option', { name: /דנה ר\./ });
    await userEvent.click(option);
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toContain('@דנה ר. '));
    await userEvent.type(box, '{Enter}');

    await waitFor(() => {
      const posted = stage45State.comments.find((c) => c.text.startsWith('צריך לבדוק גם VPN'));
      expect(posted?.stepKey).toBe('s8');
      expect(posted?.mentions.map((m) => m.displayName)).toContain('דנה ר.');
    });
  });

  it('resolves a comment', async () => {
    await openArticle();
    await userEvent.click(await screen.findByLabelText('סמן כפתור · דנה ר.'));
    await waitFor(() => expect(stage45State.comments[0].resolvedAt).not.toBeNull());
  });

  it('hides the composer without notes.write', async () => {
    server.use(withMe({ permissions: ['docs.read'] }));
    await openArticle();
    await screen.findByText(/Speedtest חוסם/);
    expect(screen.queryByLabelText('הערה לשלב s8')).not.toBeInTheDocument();
  });
});

describe('"הסבר ללקוח" script picker', () => {
  it('offers scripts for the step and adds one to the call summary', async () => {
    await openArticle();
    await userEvent.click(await screen.findByLabelText('הסבר ללקוח'));

    const picker = await screen.findByRole('dialog', { name: 'תסריטים לשלב זה' });
    await userEvent.click(within(picker).getAllByRole('button', { name: 'הוסף לסיכום' })[0]);

    await waitFor(() =>
      expect(screen.getByTestId('summary').textContent).toContain(`תסריט: ${fx.scripts[0].title}`),
    );
  });
});

describe('breadcrumb quick-switch', () => {
  // The `intl` fixtures are the pair with a sibling, which is what the switcher is for.
  const LABEL = 'מסמכים אחרים בחו"ל ונדידה';

  it('lists the sibling documents in the category and jumps to one', async () => {
    // The sibling exists as a library card; give it a document so the jump really lands.
    const sibling = fx.cards.find((c) => c.category === 'intl' && c.id !== D_INTL)!;
    state.documents.set(sibling.id, {
      ...fx.docIntl,
      id: sibling.id,
      slug: sibling.slug,
      title: sibling.title,
      etag: 'sib-1',
    });

    renderWithProviders(<App />, { route: `/doc/${D_INTL}` });
    await screen.findByRole('heading', { name: fx.docIntl.title });

    await userEvent.click(screen.getByLabelText(LABEL));
    const menu = await screen.findByRole('listbox', { name: LABEL });

    // The document you are already on is not offered.
    expect(within(menu).queryByText(fx.docIntl.title)).not.toBeInTheDocument();
    const other = (await within(menu).findAllByRole('option'))[0];
    const title = other.textContent ?? '';
    expect(title).toContain(sibling.title);

    await userEvent.click(other);
    await screen.findByRole('heading', { name: sibling.title });
  });
});

describe('telemetry', () => {
  it('batches outcome picks rather than sending one request per keypress', async () => {
    const { unmount } = await openArticle('s1');
    // A previous test's unmount flush is asynchronous and can land after `resetStage45`, so the
    // baseline is taken here rather than assumed to be empty.
    stage45State.telemetry.length = 0;
    await userEvent.keyboard('1');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('1');

    // Nothing has been flushed yet — the batch window is 10 s. One request per keypress during a
    // live call is exactly the traffic this must not generate.
    expect(stage45State.telemetry).toHaveLength(0);

    // Leaving the page flushes what is buffered, in one request.
    unmount();
    await waitFor(() => expect(stage45State.telemetry.length).toBeGreaterThan(0), { timeout: 3000 });
    expect(stage45State.telemetry.some((e) => e.kind === 'outcome')).toBe(true);
  });
});
