import { describe, it, expect } from 'vitest';
import { OllamaModel, buildQuestionMessages, parseQuestions } from '../src/index.js';

const ctx = {
  perDocument: 2,
  seeds: [],
  documents: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'ניתוק גלישה',
      steps: [
        {
          key: 's1',
          num: '1',
          title: 'בדיקת חסימה',
          actions: ['CRM ↗ שדה "גלישה בארץ"'],
          outcomes: [{ text: 'לא חסום', gotoTitle: 'סוג מכשיר' }],
        },
      ],
    },
  ],
};
const good = JSON.stringify({
  questions: [
    {
      documentId: ctx.documents[0].id,
      stepKey: 's1',
      stem: 'מה בודקים תחילה?',
      kind: 'single',
      options: [
        { id: 'o1', text: 'חסימה', correct: true },
        { id: 'o2', text: 'APN', correct: false },
      ],
      explanation: '',
      modelConf: 0.8,
    },
  ],
});

describe('question generation via Ollama', () => {
  it('builds messages that carry every step and the per-document cap', () => {
    const m = buildQuestionMessages(ctx);
    expect(m[0].role).toBe('system');
    expect(m[1].content).toContain('בדיקת חסימה');
    expect(m[1].content).toContain('"perDocument":2');
  });
  it('parses and validates the envelope', () => {
    expect(parseQuestions(good)).toMatchObject({ ok: true });
    expect(parseQuestions('{"questions":[{"stem":"x"}]}').ok).toBe(false);
    expect(parseQuestions('```json\n' + good + '\n```').ok).toBe(true);
  });
  it('retries once on bad JSON, then throws', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ message: { content: 'not json' } }), { status: 200 });
    }) as unknown as typeof fetch;
    const m = new OllamaModel({ url: 'http://x', model: 'm', fetchImpl });
    await expect(m.generateQuestions!(ctx)).rejects.toThrow(/model failed/);
    expect(calls).toBe(2);
  });
  it('returns validated questions on success', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: { content: good } }), { status: 200 })) as unknown as typeof fetch;
    const m = new OllamaModel({ url: 'http://x', model: 'm', fetchImpl });
    const qs = await m.generateQuestions!(ctx);
    expect(qs).toHaveLength(1);
    expect(qs[0].options[0].correct).toBe(true);
  });
});
