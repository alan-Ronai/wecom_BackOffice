import { describe, it, expect, afterEach } from 'vitest';
import { OllamaModel, RuleBasedModel, type ProposalContext } from '../src/index.js';
import { startOllamaStub } from './fixtures/ollama-stub.js';

const D = '11111111-1111-4111-8111-111111111111';
const ctx: ProposalContext = {
  source: { id: 's', title: 't' },
  paragraphs: [],
  /**
   * Real sentences, not `a. b.`: `material.ts` drops a change with nothing material in it, so a
   * fixture whose "new content" is two characters long now correctly produces no suggestion and
   * would have made the fallback assertions vacuous.
   */
  diffs: [
    {
      ref: '4.8',
      kind: 'changed',
      before: 'תוצאת Speedtest מעל 5 מגה נחשבת תקינה.',
      after: 'תוצאת Speedtest מעל 6 מגה נחשבת תקינה. ודא שהלקוח מנותק מ-Wi-Fi לפני הבדיקה.',
      similarity: 0.7,
    },
  ],
  linkedSteps: [
    {
      documentId: D,
      documentTitle: 'x',
      stepKey: 's8',
      stepNum: '8',
      stepTitle: 'y',
      anchor: '4.8',
      actions: [],
    },
  ],
  fields: [],
  blocks: [],
};
/** The default path's answer shape: flat, every id present, no `payload` (C-C1). */
const good = JSON.stringify({
  suggestions: [
    {
      anchor: '§4.8',
      type: 'update-step',
      title: 'סף Speedtest 5 → 6',
      targetDocumentId: D,
      targetStepKey: 's8',
      targetBlockId: '',
      actions: ['ודא שהלקוח מנותק מ-Wi-Fi לפני הבדיקה'],
      rationale: 'הסף שונה',
    },
  ],
});
/** The same answer in the legacy envelope, for the `legacyEnvelope` arm. */
const goodEnvelope = JSON.stringify({
  suggestions: [
    {
      anchor: '§4.8',
      type: 'update-step',
      title: 'סף Speedtest 5 → 6',
      targetDocumentId: D,
      targetStepKey: 's8',
      targetBlockId: null,
      payload: { type: 'update-step', addActions: ['ודא ניתוק Wi-Fi'], patch: {} },
      confidence: 0.9,
      rationale: 'r',
    },
  ],
});

let stop: (() => Promise<void>) | null = null;
afterEach(async () => {
  await stop?.();
  stop = null;
});

describe('OllamaModel', () => {
  it('returns validated proposals from /api/chat with format json', async () => {
    const s = await startOllamaStub({ chat: [good] });
    stop = s.close;
    const m = new OllamaModel({ url: s.url, model: 'm' });
    const out = await m.proposeChanges(ctx);
    expect(out[0].targetStepKey).toBe('s8');
    const chat = s.calls.find((c) => c.path === '/api/chat')!.body as {
      format: unknown;
      model: string;
      stream: boolean;
    };
    expect(chat.model).toBe('m');
    expect(chat.stream).toBe(false);
    expect(chat.format).toBeTruthy();
    expect(m.lastRun?.used).toBe('ollama');
    expect(m.name).toBe('ollama:m');
  });

  it('retries once on invalid json then succeeds', async () => {
    const s = await startOllamaStub({ chat: ['garbage', good] });
    stop = s.close;
    const out = await new OllamaModel({ url: s.url, model: 'm' }).proposeChanges(ctx);
    expect(out).toHaveLength(1);
    expect(s.calls.filter((c) => c.path === '/api/chat')).toHaveLength(2);
  });

  it('falls back to rules after two invalid answers', async () => {
    const s = await startOllamaStub({ chat: ['garbage', '{"suggestions":[{"type":"nope"}]}'] });
    stop = s.close;
    const m = new OllamaModel({ url: s.url, model: 'm', fallback: new RuleBasedModel() });
    const out = await m.proposeChanges(ctx);
    expect(m.lastRun?.used).toBe('fallback');
    expect(out[0].type).toBe('update-step');
  });

  it('sends the flat per-context schema by default and the envelope only when asked', async () => {
    const s = await startOllamaStub({ chat: [good, goodEnvelope] });
    stop = s.close;
    await new OllamaModel({ url: s.url, model: 'm' }).proposeChanges(ctx);
    await new OllamaModel({ url: s.url, model: 'm', legacyEnvelope: true }).proposeChanges(ctx);
    const [flat, envelope] = s.calls
      .filter((c) => c.path === '/api/chat')
      .map((c) => (c.body as { format: { properties: { suggestions: { items: { required: string[] } } } } }).format);
    expect(flat.properties.suggestions.items.required).toContain('targetBlockId');
    expect(envelope.properties.suggestions.items.required).toContain('payload');
  });

  it('replays its own answer and names the field in Hebrew on the one retry (C-I7)', async () => {
    const s = await startOllamaStub({ chat: [
        JSON.stringify({ suggestions: [{ type: 'update-step', targetDocumentId: D, targetStepKey: '' }] }),
        good,
      ] });
    stop = s.close;
    await new OllamaModel({ url: s.url, model: 'm' }).proposeChanges(ctx);
    const retry = s.calls.filter((c) => c.path === '/api/chat')[1].body as {
      messages: { role: string; content: string }[];
    };
    expect(retry.messages.at(-2)?.role).toBe('assistant');
    expect(retry.messages.at(-1)?.content).toContain('מפתח השלב');
  });

  it('falls back to rules on an http error', async () => {
    const s = await startOllamaStub({ chat: [{ error: 500 }] });
    stop = s.close;
    const m = new OllamaModel({ url: s.url, model: 'm', fallback: new RuleBasedModel() });
    await m.proposeChanges(ctx);
    expect(m.lastRun?.used).toBe('fallback');
    expect(m.lastRun?.error).toContain('http 500');
  });

  it('throws when the model fails and no fallback is configured', async () => {
    const s = await startOllamaStub({ chat: ['garbage'] });
    stop = s.close;
    await expect(new OllamaModel({ url: s.url, model: 'm' }).proposeChanges(ctx)).rejects.toThrow(
      /model failed/,
    );
  });

  it('reports availability and embeds', async () => {
    const s = await startOllamaStub({ chat: [], embeddings: [1, 2, 3] });
    stop = s.close;
    const m = new OllamaModel({ url: s.url, model: 'm' });
    expect(await m.available()).toBe(true);
    expect(await m.embed('x')).toEqual([1, 2, 3]);
    expect(await new OllamaModel({ url: 'http://127.0.0.1:1', model: 'm', timeoutMs: 300 }).available()).toBe(
      false,
    );
  });
});
