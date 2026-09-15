import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useConversationFor,
  useSendMessage,
  useDecideProposedEdits,
  useMessageFeedback,
} from '../../src/api/hooks/ai.js';
import {
  useStructuredEdit,
  useAcceptSuggestionParts,
  useSuggestion,
  useSuggestionAnalytics,
} from '../../src/api/hooks/suggestionsEdit.js';
import { aiState, resetAiState, CONV_1, PE_1, SUG_AFFECTS, DOC_1, MSG_2 } from '../msw/ai-handlers.js';
import { sampleAnalytics } from '../msw/ai-admin.js';

const wrap = () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return {
    qc,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  };
};

beforeEach(() => resetAiState());

describe('wave 6 X4a hooks', () => {
  it('finds the existing workspace conversation for the document', async () => {
    const { wrapper } = wrap();
    const h = renderHook(() => useConversationFor('workspace', DOC_1), { wrapper });
    await waitFor(() => expect(h.result.current.conversation?.id).toBe(CONV_1));
  });

  it('creates a conversation on first use for a kind that has none', async () => {
    const { wrapper } = wrap();
    const h = renderHook(() => useConversationFor('article', DOC_1), { wrapper });
    await waitFor(() => expect(h.result.current.isPending).toBe(false));
    expect(h.result.current.conversation).toBeNull();
    let created: { id: string } | undefined;
    await act(async () => {
      created = await h.result.current.create();
    });
    expect(created?.id).toBeTruthy();
    expect(aiState.conversations.some((c) => c.kind === 'article' && c.documentId === DOC_1)).toBe(true);
  });

  it('runs no query at all when the caller may not ask', async () => {
    const { wrapper } = wrap();
    const h = renderHook(() => useConversationFor('workspace', DOC_1, { enabled: false }), { wrapper });
    await waitFor(() => expect(h.result.current.isPending).toBe(false));
    expect(h.result.current.conversation).toBeNull();
  });

  it('send streams the scripted reply, records the body and invalidates the conversation', async () => {
    const { qc, wrapper } = wrap();
    const invalidated: unknown[] = [];
    const real = qc.invalidateQueries.bind(qc);
    qc.invalidateQueries = ((f?: { queryKey?: unknown }) => {
      invalidated.push(f?.queryKey);
      return real(f as never);
    }) as typeof qc.invalidateQueries;
    const h = renderHook(() => useSendMessage(CONV_1), { wrapper });
    act(() => h.result.current.send({ content: 'קצר את סעיף 3', context: { selection: 'סעיף 3' } }));
    await waitFor(() => expect(h.result.current.isStreaming).toBe(false));
    expect(aiState.sent[0]?.body).toMatchObject({
      content: 'קצר את סעיף 3',
      context: { selection: 'סעיף 3' },
    });
    const last = h.result.current.view.sealed.at(-1);
    expect(last?.content).toBe('קיצור סעיף 3 משפיע על שלושה מסמכים.');
    expect(last?.proposed?.proposedEditsId).toBe(PE_1);
    expect(last?.proposed?.baseSourceVersion).toBe(3);
    expect(invalidated).toContainEqual(['ai', 'conversation', CONV_1]);
  });

  it('surfaces a rate limit as the hook error and leaves nothing streaming', async () => {
    const { wrapper } = wrap();
    aiState.streamStatus = 429;
    const h = renderHook(() => useSendMessage(CONV_1), { wrapper });
    act(() => h.result.current.send({ content: 'x' }));
    await waitFor(() => expect(h.result.current.error).toContain('יותר מדי בקשות'));
    expect(h.result.current.isStreaming).toBe(false);
  });

  it('decide sends accepted op ids and invalidates the source document', async () => {
    const { qc, wrapper } = wrap();
    qc.setQueryData(['source', DOC_1], { html: '<p>x</p>' });
    const h = renderHook(() => useDecideProposedEdits(DOC_1), { wrapper });
    await act(async () => {
      await h.result.current.mutateAsync({ id: PE_1, accept: ['op-1'], reject: ['op-2'] });
    });
    expect(aiState.decided[0]?.body).toEqual({ accept: ['op-1'], reject: ['op-2'] });
    expect(qc.getQueryState(['source', DOC_1])?.isInvalidated).toBe(true);
  });

  it('feedback posts the rating', async () => {
    const { wrapper } = wrap();
    const h = renderHook(() => useMessageFeedback(), { wrapper });
    await act(async () => {
      await h.result.current.mutateAsync({ messageId: MSG_2, rating: 'up' });
    });
    expect(aiState.feedback).toEqual([{ messageId: MSG_2, rating: 'up' }]);
  });

  it('structured edit and partial accept carry rows and parts', async () => {
    const { wrapper } = wrap();
    const s = renderHook(() => useSuggestion(SUG_AFFECTS), { wrapper });
    await waitFor(() => expect(s.result.current.data?.affects).toHaveLength(3));

    const e = renderHook(() => useStructuredEdit(), { wrapper });
    await act(async () => {
      await e.result.current.mutateAsync({
        id: SUG_AFFECTS,
        edit: { type: 'update-step', rows: [{ rowId: 'add-0', op: 'edit', value: 'ודא ניתוק מ-Wi-Fi' }] },
      });
    });
    expect(aiState.edits[0]?.body.rows[0]).toMatchObject({ rowId: 'add-0', op: 'edit' });

    const a = renderHook(() => useAcceptSuggestionParts(), { wrapper });
    await act(async () => {
      await a.result.current.mutateAsync({ id: SUG_AFFECTS, parts: ['add-0'] });
    });
    expect(aiState.accepted[0]).toEqual({ id: SUG_AFFECTS, parts: ['add-0'] });
  });

  it('a full accept sends {} and records no parts', async () => {
    const { wrapper } = wrap();
    const a = renderHook(() => useAcceptSuggestionParts(), { wrapper });
    await act(async () => {
      await a.result.current.mutateAsync({ id: SUG_AFFECTS });
    });
    expect(aiState.accepted[0]).toEqual({ id: SUG_AFFECTS, parts: undefined });
  });

  it('the analytics query parses against the contract', async () => {
    const { wrapper } = wrap();
    const h = renderHook(() => useSuggestionAnalytics({}), { wrapper });
    // X6: one `/suggestions/analytics` stub for both lanes — X4b's `ai-admin.ts` fixture.
    await waitFor(() => expect(h.result.current.data?.total).toBe(sampleAnalytics().total));
  });
});
