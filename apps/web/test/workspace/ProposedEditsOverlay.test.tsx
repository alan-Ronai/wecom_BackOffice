import { describe, it, expect, beforeEach } from 'vitest';
import { useState } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { ProposedEditsOverlay } from '../../src/components/workspace/ProposedEditsOverlay.js';
import { aiState, resetAiState, sampleProposedEdits, DOC_1, SOURCE_HTML } from '../msw/ai-handlers.js';
import { state, withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';

const seedSource = () =>
  state.sourceDocs.set(DOC_1, {
    html: SOURCE_HTML,
    text: 'בדיקת מהירות גלישה',
    version: 3,
    etag: 'e-src-1',
    versions: [],
    latestRevisionId: null,
  });

beforeEach(() => {
  resetAiState();
  seedSource();
});

const render = (props: Partial<Parameters<typeof ProposedEditsOverlay>[0]> = {}) =>
  renderWithProviders(
    <ProposedEditsOverlay
      documentId={DOC_1}
      proposed={sampleProposedEdits()}
      onDecided={() => {}}
      onDismiss={() => {}}
      {...props}
    />,
  );

const region = () => screen.findByRole('region', { name: 'עריכות מוצעות במסמך' });
/** The per-hunk buttons only exist once `/auth/me` has answered, so they are awaited. */
const accepts = async () => within(await region()).findAllByRole('button', { name: 'קבל' });

describe('<ProposedEditsOverlay>', () => {
  it('lists every hunk with its own accept and reject', async () => {
    render();
    expect(await accepts()).toHaveLength(2);
    expect(within(await region()).getAllByRole('button', { name: 'דחה' })).toHaveLength(2);
    expect(within(await region()).getByText('על גרסה 3')).toBeInTheDocument();
  });

  it('rejects the untouched hunks explicitly, and says so on the button', async () => {
    const user = userEvent.setup();
    render();
    await user.click((await accepts())[0]!);
    const confirm = within(await region()).getByRole('button', { name: /אשר החלטות/ });
    expect(confirm).toHaveTextContent('אשר החלטות (אחת מתקבלת, אחת נדחית)');
    await user.click(confirm);
    await waitFor(() => expect(aiState.decided[0]?.body).toEqual({ accept: ['op-1'], reject: ['op-2'] }));
  });

  it('קבל הכל posts accept: all', async () => {
    const user = userEvent.setup();
    render();
    await accepts();
    await user.click(within(await region()).getByRole('button', { name: 'קבל הכל' }));
    await waitFor(() => expect(aiState.decided[0]?.body).toEqual({ accept: 'all', reject: [] }));
  });

  it('previews the accepted hunks against the real source', async () => {
    const user = userEvent.setup();
    render();
    await user.click((await accepts())[0]!);
    await user.click(within(await region()).getByRole('button', { name: 'תצוגה מקדימה' }));
    const preview = await screen.findByLabelText('תצוגה מקדימה של המקור');
    await waitFor(() => expect(preview).toHaveTextContent('ודא חיבור לרשת לפני הבדיקה.'));
    // Only the accepted hunk is previewed — op-2 was left untouched.
    expect(preview).toHaveTextContent('פסקה כפולה.');
  });

  it('turns a 409 into the "source moved" toast and dismisses', async () => {
    const user = userEvent.setup();
    aiState.decideStatus = 409;
    let dismissed = false;
    render({ onDismiss: () => (dismissed = true) });
    await accepts();
    await user.click(within(await region()).getByRole('button', { name: 'קבל הכל' }));
    expect(await screen.findByText('מסמך המקור השתנה בינתיים — טען מחדש והצע שוב')).toBeInTheDocument();
    await waitFor(() => expect(dismissed).toBe(true));
  });

  /**
   * B-M17: only a 409 is terminal. A transient failure leaves the proposal valid,
   * so the overlay — and the tri-state decisions in it — must survive the retry.
   */
  it('keeps the overlay and the decisions after a non-409 failure', async () => {
    const user = userEvent.setup();
    aiState.decideStatus = 500;
    let dismissed = false;
    render({ onDismiss: () => (dismissed = true) });
    const [first] = await accepts();
    await user.click(first!);
    await user.click(within(await region()).getByRole('button', { name: /אשר החלטות/ }));
    await waitFor(() => expect(aiState.decided.length).toBeGreaterThan(0));
    expect(dismissed).toBe(false);
    expect(await region()).toBeInTheDocument();
    expect(within(await region()).getByRole('button', { name: /אשר החלטות/ })).toHaveTextContent(
      'אחת מתקבלת',
    );
  });

  /**
   * B-I1. Server op ids restart at `op-1` for every proposal. A tick that outlived its proposal
   * would be applied to a hunk the editor never read, which is the one thing §1.3 exists to stop.
   */
  it('starts a second proposal with nothing ticked', async () => {
    // Swapped in place, deliberately without the host's `key={proposed.id}`: this is the
    // component's own defence, and it is what makes the host's key belt-and-braces.
    function Harness() {
      const [second, setSecond] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setSecond(true)}>
            הצעה חדשה
          </button>
          <ProposedEditsOverlay
            documentId={DOC_1}
            proposed={second ? { ...sampleProposedEdits(), id: 'pe-second' } : sampleProposedEdits()}
            onDecided={() => {}}
            onDismiss={() => {}}
          />
        </>
      );
    }
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click((await accepts())[0]!);
    expect(within(await region()).getByRole('button', { name: /אשר החלטות/ })).toHaveTextContent(
      'אחת מתקבלת',
    );
    await user.click(screen.getByRole('button', { name: 'הצעה חדשה' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'עריכות מוצעות במסמך' })).getByRole('button', {
          name: /אשר החלטות/,
        }),
      ).toHaveTextContent('אשר החלטות (0 מתקבלות, שתיים נדחות)'),
    );
  });

  it('is read-only without docs.edit', async () => {
    server.use(withMe({ permissions: ['docs.read', 'ai.ask', 'ai.chat'] }));
    render();
    expect(await screen.findByText('אין הרשאה להחיל עריכות במסמך המקור')).toBeInTheDocument();
    const r = await region();
    expect(within(r).queryByRole('button', { name: 'קבל' })).toBeNull();
    expect(within(r).queryByRole('button', { name: /אשר החלטות/ })).toBeNull();
    expect(within(r).getByRole('button', { name: 'בטל' })).toBeInTheDocument();
  });
});
