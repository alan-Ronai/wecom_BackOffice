import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamChat } from '../../src/api/aiStream.js';
import type { ChatEvent } from '@wecom/shared';

const sse = (chunks: string[], status = 200, ct = 'text/event-stream') =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { status, headers: { 'content-type': ct } },
  );

const DONE = '{"type":"done","messageId":"11111111-1111-4111-8111-111111111111","tokensIn":0,"tokensOut":0,"latencyMs":0}';

afterEach(() => vi.restoreAllMocks());

describe('streamChat', () => {
  it('parses events split across chunks and validates each against ChatEventSchema', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sse([
        'event: token\ndata: {"type":"token","te',
        'xt":"שלום"}\n\nevent: done\ndata: ' + DONE + '\n\n',
      ]),
    );
    const seen: ChatEvent[] = [];
    await streamChat({
      conversationId: 'c',
      body: { content: 'hi' },
      signal: new AbortController().signal,
      onEvent: (e) => seen.push(e),
    });
    expect(seen.map((e) => e.type)).toEqual(['token', 'done']);
    expect(seen[0]).toMatchObject({ text: 'שלום' });
  });

  it('turns a non-200 JSON error into an ApiError with the server code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'AI_RATE_LIMITED', message: 'יותר מדי' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(
      streamChat({
        conversationId: 'c',
        body: { content: 'hi' },
        signal: new AbortController().signal,
        onEvent: () => {},
      }),
    ).rejects.toMatchObject({ status: 429, code: 'AI_RATE_LIMITED' });
  });

  it('emits an error event for a malformed frame and keeps going', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse(['data: {nope}\n\n', 'data: ' + DONE + '\n\n']));
    const seen: ChatEvent[] = [];
    await streamChat({
      conversationId: 'c',
      body: { content: 'x' },
      signal: new AbortController().signal,
      onEvent: (e) => seen.push(e),
    });
    expect(seen.map((e) => e.type)).toEqual(['error', 'done']);
    expect(seen[0]).toMatchObject({ code: 'BAD_FRAME' });
  });

  it('turns a frame that does not match the contract into an error event, not a blank bubble', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sse(['data: {"type":"token"}\n\n']));
    const seen: ChatEvent[] = [];
    await streamChat({
      conversationId: 'c',
      body: { content: 'x' },
      signal: new AbortController().signal,
      onEvent: (e) => seen.push(e),
    });
    expect(seen).toEqual([{ type: 'error', code: 'CONTRACT', message: 'תשובת השרת אינה תואמת את החוזה' }]);
  });

  it('stops reading when the signal aborts', async () => {
    const ctl = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      ctl.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });
    await expect(
      streamChat({ conversationId: 'c', body: { content: 'x' }, signal: ctl.signal, onEvent: () => {} }),
    ).resolves.toBeUndefined();
  });
});
