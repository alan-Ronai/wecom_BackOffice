import { describe, it, expect } from 'vitest';
import { RuleBasedModel } from '../src/rules.js';
import type {
  ChatMessage,
  ChatResult,
  ChatToolSpec,
  ImpactSet,
  ModelClient,
  ProposalContext,
  ProposedSuggestion,
} from '../src/contract.js';

/**
 * Wave 6 (X0). The chat and batch-embedding halves of `ModelClient` are *types* until X2 and
 * X1 implement them, so the test that matters is that a client can implement them at all and
 * that the rule model still satisfies the interface without either.
 */
const fake: ModelClient = {
  name: 'fake',
  available: async () => true,
  proposeChanges: async () => [],
  embed: async () => [0.1, 0.2],
  embedBatch: async (texts) => texts.map(() => [0.1, 0.2]),
  chat: async ({ messages, tools, onToken, signal }) => {
    if (signal?.aborted) throw new Error('aborted');
    onToken?.('שלום');
    const last = messages.at(-1);
    const result: ChatResult = {
      content: last?.content ?? '',
      toolCalls: tools?.length ? [{ id: 't1', name: tools[0]!.name, args: { q: 'גלישה' } }] : [],
      tokensIn: 12,
      tokensOut: 3,
    };
    return result;
  },
};

describe('wave 6 model contract', () => {
  it('streams tokens, returns tool calls and counts tokens', async () => {
    const tools: ChatToolSpec[] = [
      {
        name: 'search_kb',
        description: 'חיפוש בבסיס הידע',
        parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
      },
    ];
    const messages: ChatMessage[] = [
      { role: 'system', content: 'brief v3' },
      { role: 'user', content: 'מה השתנה בסף Speedtest?' },
    ];
    const seen: string[] = [];
    const r = await fake.chat!({ messages, tools, onToken: (t) => seen.push(t) });
    expect(seen).toEqual(['שלום']);
    expect(r.toolCalls).toEqual([{ id: 't1', name: 'search_kb', args: { q: 'גלישה' } }]);
    expect([r.tokensIn, r.tokensOut]).toEqual([12, 3]);
  });
  it('carries a tool turn back to the model', async () => {
    const r = await fake.chat!({
      messages: [
        { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'search_kb', args: {} }] },
        { role: 'tool', toolCallId: 't1', content: '{"hits":2}' },
      ],
    });
    expect(r.content).toBe('{"hits":2}');
    expect(r.toolCalls).toEqual([]);
  });
  it('embeds a batch in one call', async () => {
    const v = await fake.embedBatch!(['א', 'ב', 'ג']);
    expect(v).toHaveLength(3);
    expect(v[0]).toHaveLength(2);
  });
  it('an abort signal stops the call', async () => {
    const c = new AbortController();
    c.abort();
    await expect(fake.chat!({ messages: [], signal: c.signal })).rejects.toThrow('aborted');
  });
  it('an impact-aware, briefed ProposalContext type-checks', async () => {
    const impact: ImpactSet = {
      documents: [{ id: 'd1', title: 'גלישה בחו״ל', why: 'משתמש בבלוק המשותף' }],
      blocks: [{ id: 'b1', title: 'זיהוי לקוח', usedBy: 9 }],
      fields: [{ name: 'גלישה בארץ', usedBy: 4 }],
      topics: [{ id: 't1', name: 'תקלות גלישה' }],
      related: [{ id: 'd2', title: 'בדיקת מהירות', similarity: 0.82 }],
    };
    const example: ProposedSuggestion = {
      anchor: '§4.8',
      type: 'deprecate-step',
      title: 'שלב מיותר',
      targetDocumentId: null,
      targetStepKey: 's8',
      targetBlockId: null,
      payload: { type: 'deprecate-step', reason: 'הנוהל בוטל' },
      confidence: 0.6,
      rationale: 'הפסקה נמחקה',
    };
    const ctx: ProposalContext = {
      source: { id: 's1', title: 'נוהל גלישה' },
      diffs: [],
      paragraphs: [],
      linkedSteps: [],
      fields: [],
      blocks: [],
      brief: 'רונאי — ספקית תקשורת',
      style: 'פנייה ישירה, בלי ז׳רגון',
      impact,
      examples: [{ diff: 'מעל 5 מגה → מעל 6 מגה', suggestion: example }],
      maxContextChars: 24000,
    };
    expect(ctx.impact?.blocks[0]?.usedBy).toBe(9);
    expect(await fake.proposeChanges(ctx)).toEqual([]);
  });
  it('the rule model implements neither optional method', () => {
    const rules: ModelClient = new RuleBasedModel();
    expect(rules.chat).toBeUndefined();
    expect(rules.embedBatch).toBeUndefined();
    expect(rules.generateQuestions).toBeUndefined();
  });
});
