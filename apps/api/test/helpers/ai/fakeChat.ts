import type { ChatMessage, ChatResult, ModelClient } from '@wecom/model';

export interface Turn {
  messages: ChatMessage[];
  /** Tool names the orchestrator offered this turn — what the permission gate actually allowed. */
  tools: string[];
  system: string;
  lastUser: string;
}

export type Script = (turn: Turn) => ChatResult | Promise<ChatResult>;

/** Everything a `ChatResult` needs beyond what a script usually bothers to say. */
export const chatResult = (content: string, toolCalls: ChatResult['toolCalls'] = []): ChatResult => ({
  content,
  toolCalls,
  tokensIn: 1,
  tokensOut: 1,
});

/**
 * A `ModelClient` whose `chat` is a function of the turn. Streams the content through `onToken`
 * in whitespace-delimited pieces, so a test can assert on the SSE token frames the way the pane
 * will actually receive them.
 */
export const fakeChat = (script: Script): ModelClient => ({
  name: 'fake-chat',
  available: async () => true,
  proposeChanges: async () => [],
  chat: async (i) => {
    const messages = i.messages;
    const r = await script({
      messages,
      tools: (i.tools ?? []).map((t) => t.name),
      system: messages.find((m) => m.role === 'system')?.content ?? '',
      lastUser: [...messages].reverse().find((m) => m.role === 'user')?.content ?? '',
    });
    for (const piece of r.content.split(/(?<=\s)/)) if (piece) i.onToken?.(piece);
    return r;
  },
});
