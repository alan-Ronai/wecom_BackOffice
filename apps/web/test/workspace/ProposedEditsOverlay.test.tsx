import { describe, it, expect, beforeEach } from 'vitest';
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
