import type { AiToolName, ChatEvent, ProposedEditOp } from '@wecom/shared';

/**
 * The chat pane's view of one streaming reply, folded out of the SSE events.
 *
 * Pure and framework-free so the ordering rules of the contract ("any number of token /
 * tool_call / tool_result, then at most one proposed_edits or refined_suggestion, then exactly
 * one done or error") are testable without a component, a network or a clock.
 */

/** `payload` is whatever the tool returned; `draft_step` hands the editor dock a step to insert. */
export interface ToolChip {
  id: string;
  name: AiToolName | string;
  args: Record<string, unknown>;
  ok?: boolean;
  summary?: string;
  payload?: unknown;
}

export interface ProposedEditsView {
  proposedEditsId: string;
  documentId: string;
  /** From the event — never fabricated; the apply path sends it as `If-Match`. */
  baseSourceVersion: number;
  ops: ProposedEditOp[];
}

export interface StreamingReply {
  content: string;
  tools: ToolChip[];
  proposed: ProposedEditsView | null;
  refined: { suggestionId: string; editedPayload: unknown } | null;
}

export interface SealedReply extends StreamingReply {
  messageId: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface ChatViewState {
  streaming: StreamingReply | null;
  sealed: SealedReply[];
  error: string | null;
}

export const initialChatView = (): ChatViewState => ({ streaming: null, sealed: [], error: null });

const fresh = (): StreamingReply => ({ content: '', tools: [], proposed: null, refined: null });

/** Pure: one event in, one view out. `sealed` grows by one on `done`; `error` ends the stream. */
export function chatReducer(s: ChatViewState, e: ChatEvent): ChatViewState {
  const cur = s.streaming ?? fresh();
  switch (e.type) {
    case 'token':
      return { ...s, streaming: { ...cur, content: cur.content + e.text }, error: null };
    case 'tool_call':
      return { ...s, streaming: { ...cur, tools: [...cur.tools, { id: e.id, name: e.name, args: e.args }] } };
    case 'tool_result': {
      const known = cur.tools.some((t) => t.id === e.id);
      const result = { ok: e.ok, summary: e.summary, payload: e.payload };
      // A result without its call (a reconnect mid-stream) still gets a chip rather than vanishing.
      const tools = known
        ? cur.tools.map((t) => (t.id === e.id ? { ...t, name: e.name, ...result } : t))
        : [...cur.tools, { id: e.id, name: e.name, args: {}, ...result }];
      return { ...s, streaming: { ...cur, tools } };
    }
    case 'proposed_edits':
      return {
        ...s,
        streaming: {
          ...cur,
          proposed: {
            proposedEditsId: e.proposedEditsId,
            documentId: e.documentId,
            baseSourceVersion: e.baseSourceVersion,
            ops: e.ops,
          },
        },
      };
    case 'refined_suggestion':
      return {
        ...s,
        streaming: { ...cur, refined: { suggestionId: e.suggestionId, editedPayload: e.editedPayload } },
      };
    case 'done':
      return {
        streaming: null,
        error: null,
        sealed: [
          ...s.sealed,
          {
            ...cur,
            messageId: e.messageId,
            tokensIn: e.tokensIn,
            tokensOut: e.tokensOut,
            latencyMs: e.latencyMs,
          },
        ],
      };
    case 'error':
      return { ...s, streaming: null, error: e.message };
  }
}
