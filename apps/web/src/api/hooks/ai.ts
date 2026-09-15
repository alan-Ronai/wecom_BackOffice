/**
 * The AI copilot's non-streaming routes (X2), plus the one streaming hook the chat pane drives.
 *
 * Everything but the stream goes through the generated `openapi-fetch` client and is parsed at
 * runtime with `checked` against the `@wecom/shared` schema the route is built to — the two
 * layers catch different things (see `api/stage45.ts`). The stream stays on `aiStream.ts`: the
 * generated client cannot consume a streaming body.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ConversationDetailSchema,
  ConversationSchema,
  ConversationsResponseSchema,
  DecideProposedEditsResultSchema,
  ProposedEditsSchema,
  type Conversation,
  type ConversationKind,
  type SendMessageBody,
} from '@wecom/shared';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { checked } from '../stage45.js';
import { unwrap } from '../unwrap.js';
import { streamChat } from '../aiStream.js';
import { chatReducer, initialChatView, type ChatViewState } from '../../lib/chatReducer.js';
import { ApiError } from '../unwrap.js';

export const useConversations = (
  q: { documentId?: string; kind?: ConversationKind; mine?: boolean },
  enabled = true,
) =>
  useQuery({
    queryKey: keys.ai.conversations(q),
    enabled,
    queryFn: async () =>
      checked(
        ConversationsResponseSchema,
        await api.GET('/ai/conversations', { params: { query: { ...q, pageSize: 50 } } }),
      ),
  });

export const useConversation = (id: string | null) =>
  useQuery({
    queryKey: keys.ai.conversation(id ?? ''),
    enabled: !!id,
    queryFn: async () =>
      checked(
        ConversationDetailSchema,
        await api.GET('/ai/conversations/{id}', { params: { path: { id: id! } } }),
      ),
  });

export const useCreateConversation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      kind: ConversationKind;
      documentId?: string;
      sourceRevisionId?: string;
      title?: string;
    }): Promise<Conversation> => checked(ConversationSchema, await api.POST('/ai/conversations', { body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ai', 'conversations'] }),
  });
};

/** The caller's latest conversation of `kind` for this document, or a `create()` to start one. */
export function useConversationFor(
  kind: ConversationKind,
  documentId: string,
  opts: { enabled?: boolean; sourceRevisionId?: string } = {},
) {
  const enabled = opts.enabled ?? true;
  const list = useConversations({ documentId, kind, mine: true }, enabled);
  const create = useCreateConversation();
  const conversation = useMemo(() => {
    const items = list.data?.items ?? [];
    return items.length ? [...items].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0]! : null;
  }, [list.data]);
  return {
    conversation,
    isPending: enabled ? list.isPending : false,
    create: (): Promise<Conversation> =>
      create.mutateAsync({
        kind,
        documentId,
        ...(opts.sourceRevisionId ? { sourceRevisionId: opts.sourceRevisionId } : {}),
      }),
  };
}

/**
 * One streaming send. The reducer owns the reply; this owns the abort controller and the
 * invalidation that follows, so the transcript the server persisted replaces the rendered one.
 */
export function useSendMessage(conversationId: string | null) {
  const qc = useQueryClient();
  const [view, dispatch] = useReducer(chatReducer, undefined, initialChatView);
  const [isStreaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    ctl.current?.abort();
    ctl.current = null;
    setStreaming(false);
  }, []);
  useEffect(() => () => ctl.current?.abort(), []);

  const send = useCallback(
    (body: SendMessageBody, overrideConversationId?: string) => {
      const id = overrideConversationId ?? conversationId;
      if (!id || ctl.current) return;
      setError(null);
      setStreaming(true);
      const c = new AbortController();
      ctl.current = c;
      void streamChat({ conversationId: id, body, signal: c.signal, onEvent: dispatch })
        .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'השיחה נכשלה'))
        .finally(() => {
          if (ctl.current === c) ctl.current = null;
          setStreaming(false);
          void qc.invalidateQueries({ queryKey: keys.ai.conversation(id) });
          void qc.invalidateQueries({ queryKey: ['ai', 'conversations'] });
        });
    },
    [conversationId, qc],
  );

  return { send, stop, view: view as ChatViewState, isStreaming, error: error ?? view.error };
}

export const useMessageFeedback = () =>
  useMutation({
    mutationFn: async (v: { messageId: string; rating: 'up' | 'down'; note?: string }): Promise<void> => {
      unwrap(
        await api.POST('/ai/messages/{id}/feedback', {
          params: { path: { id: v.messageId } },
          body: { rating: v.rating, ...(v.note ? { note: v.note } : {}) },
        }),
      );
    },
  });

/**
 * The hunks behind a `proposedEditsId`, for a transcript read back after a reload.
 *
 * A reply streamed in this session carries its ops in the `proposed_edits` frame, so the pane
 * renders the diff without asking. A message loaded from history carries only the id — X6 added
 * `GET /ai/proposed-edits/:id` so the chip can still open into real hunks.
 */
export const useProposedEdits = (id: string | null | undefined) =>
  useQuery({
    queryKey: keys.ai.proposedEdits(id ?? ''),
    enabled: !!id,
    queryFn: async () =>
      checked(
        ProposedEditsSchema,
        await api.GET('/ai/proposed-edits/{id}', { params: { path: { id: id! } } }),
      ),
  });

/**
 * Accepting a hunk set is an ordinary source save on the server, so the source, its version list,
 * the autosave draft and the document's review flag all move with it.
 */
export const useDecideProposedEdits = (documentId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; accept: string[] | 'all'; reject: string[] | 'all' }) =>
      checked(
        DecideProposedEditsResultSchema,
        await api.POST('/ai/proposed-edits/{id}/decide', {
          params: { path: { id: v.id } },
          body: { accept: v.accept, reject: v.reject },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.source(documentId) });
      void qc.invalidateQueries({ queryKey: keys.sourceVersions(documentId) });
      qc.removeQueries({ queryKey: keys.sourceDraft(documentId) });
      void qc.invalidateQueries({ queryKey: keys.doc(documentId) });
      void qc.invalidateQueries({ queryKey: ['ai'] });
    },
  });
};
