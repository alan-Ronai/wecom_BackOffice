/**
 * The AI copilot's non-streaming routes (X2), plus the one streaming hook the chat pane drives.
 *
 * Everything but the stream goes through the temporary `wave6.ts` bridge and is parsed against
 * `@wecom/shared`; each call site is marked `// X6: api.*` for the swap to the generated client.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ConversationDetailSchema,
  ConversationSchema,
  ConversationsResponseSchema,
  DecideProposedEditsResultSchema,
  type Conversation,
  type ConversationKind,
  type SendMessageBody,
} from '@wecom/shared';
import { keys } from '../keys.js';
import { w6, w6Void } from '../wave6.js';
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
      w6(ConversationsResponseSchema, 'GET', '/ai/conversations', { query: { ...q, pageSize: 50 } }), // X6: api.GET('/ai/conversations')
  });

export const useConversation = (id: string | null) =>
  useQuery({
    queryKey: keys.ai.conversation(id ?? ''),
    enabled: !!id,
    queryFn: async () => w6(ConversationDetailSchema, 'GET', `/ai/conversations/${id!}`), // X6: api.GET('/ai/conversations/{id}')
  });

export const useCreateConversation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      kind: ConversationKind;
      documentId?: string;
      sourceRevisionId?: string;
      title?: string;
    }): Promise<Conversation> => w6(ConversationSchema, 'POST', '/ai/conversations', { body }), // X6: api.POST('/ai/conversations')
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
    mutationFn: async (v: { messageId: string; rating: 'up' | 'down'; note?: string }): Promise<void> =>
      w6Void('POST', `/ai/messages/${v.messageId}/feedback`, {
        body: { rating: v.rating, ...(v.note ? { note: v.note } : {}) },
      }), // X6: api.POST('/ai/messages/{id}/feedback')
  });

/**
 * Accepting a hunk set is an ordinary source save on the server, so the source, its version list,
 * the autosave draft and the document's review flag all move with it.
 */
export const useDecideProposedEdits = (documentId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; accept: string[] | 'all'; reject: string[] | 'all' }) =>
      w6(DecideProposedEditsResultSchema, 'POST', `/ai/proposed-edits/${v.id}/decide`, {
        body: { accept: v.accept, reject: v.reject },
      }), // X6: api.POST('/ai/proposed-edits/{id}/decide')
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.source(documentId) });
      void qc.invalidateQueries({ queryKey: keys.sourceVersions(documentId) });
      qc.removeQueries({ queryKey: keys.sourceDraft(documentId) });
      void qc.invalidateQueries({ queryKey: keys.doc(documentId) });
      void qc.invalidateQueries({ queryKey: ['ai'] });
    },
  });
};
