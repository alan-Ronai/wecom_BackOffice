import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { EditorChatDock } from '../../src/components/ai/EditorChatDock.js';
import { server } from '../msw/server.js';
import { withMe } from '../msw/handlers.js';

/** The mock keeps the last `onToolResult` so a test can fire a `draft_step` frame at the dock. */
const { lastProps } = vi.hoisted(() => ({
  lastProps: { current: null as null | Record<string, unknown> },
}));
vi.mock('../../src/components/ai/ChatPane.js', () => ({
  ChatPane: (p: Record<string, unknown>) => {
    lastProps.current = p;
    return (
      <div data-testid="chat-pane">
        {String(p.kind)}:{String(p.documentId)}:{p.readOnly ? 'ro' : 'rw'}
      </div>
    );
  },
}));

describe('EditorChatDock', () => {
  it('opens the editor chat from the toggle and closes on Escape', async () => {
    renderWithProviders(<EditorChatDock documentId="doc-1" stepKey="s3" />, { route: '/editor/doc-1' });
    const toggle = await screen.findByRole('button', { name: "צ'אט" });
    expect(screen.queryByTestId('chat-pane')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByTestId('chat-pane')).toHaveTextContent('editor:doc-1:rw');
    expect(screen.getByRole('button', { name: "סגור צ'אט" })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('chat-pane')).toBeNull();
  });

  it('hands a draft_step tool result to onInsertStep and ignores every other tool', async () => {
    const onInsertStep = vi.fn();
    renderWithProviders(<EditorChatDock documentId="doc-1" defaultOpen onInsertStep={onInsertStep} />, {
      route: '/editor/doc-1',
    });
    await screen.findByTestId('chat-pane');
    const onToolResult = lastProps.current?.onToolResult as (n: string, p: unknown, id: string) => void;
    onToolResult('read_impact', { anything: true }, 'm1');
    onToolResult('draft_step', { title: 'בדוק SIM', actions: ['הוצא והכנס'] }, 'm2');
    expect(onInsertStep).toHaveBeenCalledTimes(1);
    expect(onInsertStep).toHaveBeenCalledWith({
      title: 'בדוק SIM',
      actions: ['הוצא והכנס'],
      outcomes: undefined,
    });
  });

  it('renders nothing without ai.chat', async () => {
    server.use(withMe({ permissions: ['docs.read', 'ai.ask'] }));
    const { container } = renderWithProviders(<EditorChatDock documentId="doc-1" defaultOpen />, {
      route: '/editor/doc-1',
    });
    await waitFor(() => expect(container.querySelector('.ai-dock')).toBeNull());
  });
});
