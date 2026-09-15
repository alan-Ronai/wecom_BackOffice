import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { ChatPane } from '../../src/components/ai/ChatPane.js';
import { aiState, resetAiState, scriptStream, DOC_1, PE_1, MSG_2, MSG_3 } from '../msw/ai-handlers.js';
import { server } from '../msw/server.js';
import { withMe } from '../msw/handlers.js';
import { fx } from '../msw/fixtures.js';

const box = () => screen.findByRole('textbox', { name: 'הודעה למערכת' });

beforeEach(() => resetAiState());

describe('<ChatPane>', () => {
  it('renders history, streams a reply and shows tool chips', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChatPane kind="workspace" documentId={DOC_1} />);
    expect(await screen.findByText('מה משתנה אם אקצר את סעיף 3?')).toBeInTheDocument();
    await user.type(await box(), 'קצר את סעיף 3');
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/בדיקת השפעה/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByText('קיצור סעיף 3 משפיע על שלושה מסמכים.').length).toBeGreaterThan(0),
    );
    expect(aiState.sent[0]?.body).toMatchObject({ content: 'קצר את סעיף 3' });
  });

  it('Shift+Enter inserts a newline and does not send', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChatPane kind="workspace" documentId={DOC_1} />);
    const t = await box();
    await user.type(t, 'שורה{Shift>}{Enter}{/Shift}שנייה');
    expect((t as HTMLTextAreaElement).value).toContain('\n');
    expect(aiState.sent).toHaveLength(0);
  });

  it('surfaces proposed edits as a card and hands the host the event’s own base version', async () => {
    const user = userEvent.setup();
    const got: { id: string; baseSourceVersion: number; documentId: string }[] = [];
    renderWithProviders(
      <ChatPane
        kind="workspace"
        documentId={DOC_1}
        onProposedEdits={(pe) =>
          got.push({ id: pe.id, baseSourceVersion: pe.baseSourceVersion, documentId: pe.documentId })
        }
      />,
    );
    await user.type(await box(), 'קצר');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('region', { name: 'עריכות מוצעות' })).toBeInTheDocument();
    await waitFor(() => expect(got).toEqual([{ id: PE_1, baseSourceVersion: 3, documentId: DOC_1 }]));
  });

  it('accepting one hunk posts only that op id', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChatPane kind="workspace" documentId={DOC_1} />);
    await user.type(await box(), 'קצר');
    await user.keyboard('{Enter}');
    const card = await screen.findByRole('region', { name: 'עריכות מוצעות' });
    await user.click(within(card).getAllByRole('button', { name: 'קבל' })[0]!);
    await waitFor(() => expect(aiState.decided[0]?.body).toEqual({ accept: ['op-1'], reject: [] }));
  });

  it('shows a rate-limit error and leaves the composer usable', async () => {
    scriptStream([], 429);
    const user = userEvent.setup();
    renderWithProviders(<ChatPane kind="workspace" documentId={DOC_1} />);
    await user.type(await box(), 'x');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('יותר מדי בקשות');
    expect(await box()).toBeEnabled();
  });

  it('Escape stops a streaming reply', async () => {
    scriptStream(Array.from({ length: 400 }, (_, i) => ({ type: 'token' as const, text: `t${i} ` })));
    const user = userEvent.setup();
    renderWithProviders(<ChatPane kind="workspace" documentId={DOC_1} />);
    const t = await box();
    await user.type(t, 'x');
    await user.keyboard('{Enter}');
    fireEvent.keyDown(t, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'עצור' })).not.toBeInTheDocument());
  });

  it('lets an ai.ask caller ask on the article page, and renders nothing without ai.ask', async () => {
    server.use(withMe({ permissions: ['docs.read', 'ai.ask'] }));
    renderWithProviders(<ChatPane kind="article" documentId={DOC_1} />);
    expect(await box()).toBeEnabled();

    server.use(withMe({ permissions: ['docs.read'] }));
    const { container } = renderWithProviders(<ChatPane kind="article" documentId={DOC_1} />);
    await waitFor(() => expect(container.querySelector('.chat-pane')).toBeNull());
  });

  it('is read-only when the host says so, whatever the permissions', async () => {
    renderWithProviders(<ChatPane kind="editor" documentId={DOC_1} readOnly />);
    expect(await box()).toBeDisabled();
  });

  it('hands tool payloads to onToolResult when the reply seals', async () => {
    scriptStream([
      { type: 'tool_call', id: 't9', name: 'draft_step', args: {} },
      {
        type: 'tool_result',
        id: 't9',
        name: 'draft_step',
        ok: true,
        summary: 'טיוטה',
        payload: { title: 'שלב חדש' },
      },
      { type: 'done', messageId: MSG_3, tokensIn: 1, tokensOut: 1, latencyMs: 1 },
    ]);
    const user = userEvent.setup();
    const got: unknown[] = [];
    renderWithProviders(
      <ChatPane
        kind="editor"
        documentId={DOC_1}
        onToolResult={(name, payload, messageId) => got.push([name, payload, messageId])}
      />,
    );
    await user.type(await box(), 'טיוטה');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(got).toEqual([['draft_step', { title: 'שלב חדש' }, MSG_3]]));
  });

  it('posts feedback from the thumbs', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChatPane kind="workspace" documentId={DOC_1} />);
    await user.click(await screen.findByRole('button', { name: 'תשובה טובה' }));
    await waitFor(() => expect(aiState.feedback[0]).toMatchObject({ messageId: MSG_2, rating: 'up' }));
  });

  it('opens a conversation on first send when the document has none of that kind', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChatPane kind="editor" documentId={fx.docIntl.id} />);
    await user.type(await box(), 'שלום');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(aiState.sent).toHaveLength(1));
    expect(aiState.conversations.some((c) => c.kind === 'editor' && c.documentId === fx.docIntl.id)).toBe(
      true,
    );
  });
});
