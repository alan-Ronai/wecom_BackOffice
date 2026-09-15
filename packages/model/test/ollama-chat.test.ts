import { describe, it, expect } from 'vitest';
import { OllamaModel } from '../src/index.js';
import { startOllamaStub } from './fixtures/ollama-stub.js';

describe('OllamaModel.chat', () => {
  it('streams tokens and returns native tool calls', async () => {
    const stub = await startOllamaStub({
      chatStream: [
        { message: { role: 'assistant', content: 'בודק ' } },
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: 'read_document', arguments: { documentId: 'd1' } } }],
          },
          done: true,
          prompt_eval_count: 10,
          eval_count: 4,
        },
      ],
      capabilities: ['completion', 'tools'],
    });
    const m = new OllamaModel({ url: stub.url, model: 'x', supportsTools: true });
    const tokens: string[] = [];
    const r = await m.chat!({
      messages: [{ role: 'user', content: 'היי' }],
      tools: [{ name: 'read_document', description: 'd', parameters: { type: 'object' } }],
      onToken: (t) => tokens.push(t),
    });
    expect(tokens.join('')).toBe('בודק ');
    expect(r.toolCalls).toEqual([
      { id: expect.any(String), name: 'read_document', args: { documentId: 'd1' } },
    ]);
    expect(r.tokensIn).toBe(10);
    expect(r.tokensOut).toBe(4);
    // Native tool support: the tools go in the request body, not into a system message.
    const body = stub.calls.find((c) => c.path === '/api/chat')!.body as {
      tools?: unknown[];
      messages: { role: string }[];
      stream: boolean;
    };
    expect(body.stream).toBe(true);
    expect(body.tools).toHaveLength(1);
    expect(body.messages.map((x) => x.role)).toEqual(['user']);
    await stub.close();
  });

  it('falls back to the JSON envelope when the model has no tool support', async () => {
    const stub = await startOllamaStub({
      chatStream: [
        {
          message: {
            role: 'assistant',
            content: '{"tool_calls":[{"name":"search_kb","args":{"q":"APN"}}]}',
          },
          done: true,
        },
      ],
      capabilities: ['completion'],
    });
    const m = new OllamaModel({ url: stub.url, model: 'x', supportsTools: false });
    const tokens: string[] = [];
    const r = await m.chat!({
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'search_kb', description: 'd', parameters: { type: 'object' } }],
      onToken: (t) => tokens.push(t),
    });
    expect(r.toolCalls[0]).toMatchObject({ name: 'search_kb', args: { q: 'APN' } });
    expect(r.content).toBe('');
    // The envelope must never reach the SSE stream as tokens.
    expect(tokens.join('')).toBe('');
    const body = stub.calls.find((c) => c.path === '/api/chat')!.body as {
      tools?: unknown[];
      messages: { role: string; content: string }[];
    };
    expect(body.tools).toBeUndefined();
    expect(body.messages.some((x) => x.role === 'system' && x.content.includes('tool_calls'))).toBe(
      true,
    );
    await stub.close();
  });

  it('streams plain prose in envelope mode once the first character is not a brace', async () => {
    const stub = await startOllamaStub({
      chatStream: [
        { message: { role: 'assistant', content: 'לפי ' } },
        { message: { role: 'assistant', content: 'שלב 2.' }, done: true, eval_count: 3 },
      ],
    });
    const m = new OllamaModel({ url: stub.url, model: 'x', supportsTools: false });
    const tokens: string[] = [];
    const r = await m.chat!({
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'search_kb', description: 'd', parameters: { type: 'object' } }],
      onToken: (t) => tokens.push(t),
    });
    expect(tokens.join('')).toBe('לפי שלב 2.');
    expect(r.content).toBe('לפי שלב 2.');
    expect(r.toolCalls).toEqual([]);
    await stub.close();
  });

  it('maps assistant tool calls and tool results onto Ollama’s message shape', async () => {
    const stub = await startOllamaStub({ chatStream: [{ message: { content: 'ok' }, done: true }] });
    const m = new OllamaModel({ url: stub.url, model: 'x', supportsTools: true });
    await m.chat!({
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'search_kb', args: { q: 'a' } }] },
        { role: 'tool', content: '{"ok":true}', toolCallId: 'c1' },
      ],
    });
    const body = stub.calls.find((c) => c.path === '/api/chat')!.body as {
      messages: Record<string, unknown>[];
    };
    expect(body.messages[2].tool_calls).toEqual([
      { function: { name: 'search_kb', arguments: { q: 'a' } } },
    ]);
    expect(body.messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
    await stub.close();
  });
});
