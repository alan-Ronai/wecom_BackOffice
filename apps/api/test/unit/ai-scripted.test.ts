import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '@wecom/model';
import { ScriptedChatModel } from '../../src/modules/ai/scripted.js';
import { scriptedChatRequested } from '../../src/modules/ai/chatModel.js';
import { DOCUMENT_ID_LABEL, SECOND_CALL, SUGGESTION_ID_LABEL } from '../../src/modules/ai/prompt.js';

const DOC = '11111111-1111-4111-8111-111111111111';
const SUG = '22222222-2222-4222-8222-222222222222';

const system = `אתה עוזר.\n${DOCUMENT_ID_LABEL}: ${DOC}`;
const turn = (user: string, extra: ChatMessage[] = []): ChatMessage[] => [
  { role: 'system', content: system },
  { role: 'user', content: user },
  ...extra,
];

/**
 * The deterministic stand-in the e2e stack runs against (`AI_TEST_SCRIPT=1`, `MODEL_DISABLED`,
 * no Ollama). These are its contract, so a change here is a change to what the integration
 * lane can assert.
 */
describe('ScriptedChatModel', () => {
  const m = new ScriptedChatModel();

  it('is selected only by AI_TEST_SCRIPT=1, and in production only inside the e2e stack', () => {
    const before = process.env.AI_TEST_SCRIPT;
    const beforeRunner = process.env.WECOM_E2E_RUNNER;
    try {
      delete process.env.AI_TEST_SCRIPT;
      delete process.env.WECOM_E2E_RUNNER;
      expect(scriptedChatRequested('test')).toBe(false);
      process.env.AI_TEST_SCRIPT = '1';
      expect(scriptedChatRequested('test')).toBe(true);
      expect(scriptedChatRequested('development')).toBe(true);
      // A deployment sets neither `WECOM_E2E_RUNNER` nor `AI_TEST_SCRIPT`, and one of the two is
      // not enough: production refuses the script without the e2e-stack marker.
      expect(scriptedChatRequested('production')).toBe(false);
      process.env.WECOM_E2E_RUNNER = '1';
      expect(scriptedChatRequested('production')).toBe(true);
      delete process.env.AI_TEST_SCRIPT;
      expect(scriptedChatRequested('production')).toBe(false);
    } finally {
      if (before === undefined) delete process.env.AI_TEST_SCRIPT;
      else process.env.AI_TEST_SCRIPT = before;
      if (beforeRunner === undefined) delete process.env.WECOM_E2E_RUNNER;
      else process.env.WECOM_E2E_RUNNER = beforeRunner;
    }
  });

  it('asks for propose_source_edit on an edit intent', async () => {
    for (const word of ['שנה', 'החלף', 'תקן', 'קצר']) {
      const r = await m.chat({ messages: turn(`${word} את "הישן" ל"החדש"`) });
      expect(r.toolCalls).toHaveLength(1);
      expect(r.toolCalls[0]).toMatchObject({ name: 'propose_source_edit', args: { documentId: DOC } });
    }
  });

  it('asks for refine_suggestion when the context carries a suggestion id', async () => {
    const r = await m.chat({
      messages: turn(`שפר את הניסוח\n\n${SUGGESTION_ID_LABEL}: ${SUG}`),
    });
    expect(r.toolCalls[0]).toMatchObject({ name: 'refine_suggestion', args: { suggestionId: SUG } });
    const r2 = await m.chat({ messages: turn(`עדכן את ההצעה\n\n${SUGGESTION_ID_LABEL}: ${SUG}`) });
    expect(r2.toolCalls[0]).toMatchObject({ name: 'refine_suggestion' });
  });

  it('reads the document for a question and then cites שלב 1', async () => {
    const first = await m.chat({ messages: turn('מה עושים כשאין גלישה?') });
    expect(first.toolCalls[0]).toMatchObject({ name: 'read_document', args: { documentId: DOC } });
    const second = await m.chat({
      messages: turn('מה עושים כשאין גלישה?', [
        { role: 'tool', toolCallId: 'x', content: '{"ok":true,"data":{}}' },
      ]),
    });
    expect(second.content).toContain('שלב 1');
    expect(second.toolCalls).toEqual([]);
  });

  /**
   * X6: every pane sends a context, which `withContext` glues onto the end of the message as
   * `…\n\n---\nהקשר:\n…`. The rules read the *end* of the text, so matching the whole string
   * meant an agent's "מה השלב הראשון?" from the ask pane never looked like a question.
   */
  it('reads the intent from the typed line, not from the context block after it', async () => {
    const withStep = 'מה השלב הראשון?\n\n---\nהקשר:\nהשלב הפתוח: s1';
    const r = await m.chat({ messages: turn(withStep) });
    expect(r.toolCalls[0]).toMatchObject({ name: 'read_document', args: { documentId: DOC } });
    // The ids still come from the whole message — that is where `withContext` puts them.
    const refine = await m.chat({
      messages: turn(`שפר את הניסוח\n\n---\nהקשר:\n${SUGGESTION_ID_LABEL}: ${SUG}`),
    });
    expect(refine.toolCalls[0]).toMatchObject({ name: 'refine_suggestion', args: { suggestionId: SUG } });
  });

  it('says הבנתי. to anything else, and streams it', async () => {
    const tokens: string[] = [];
    const r = await m.chat({ messages: turn('שלום'), onToken: (t) => tokens.push(t) });
    expect(r.content).toBe('הבנתי.');
    expect(tokens.join('')).toBe('הבנתי.');
    expect(r.toolCalls).toEqual([]);
  });

  it('reports the gate’s refusal rather than retrying it', async () => {
    const r = await m.chat({
      messages: turn('שנה את המסמך', [
        { role: 'tool', toolCallId: 'x', content: '{"ok":false,"error":"אין הרשאה להפעיל כלי זה"}' },
      ]),
    });
    expect(r.content).toBe('אין לי הרשאה לשנות תוכן');
    expect(r.toolCalls).toEqual([]);
  });

  it('rewrites the quoted text in the paragraph that holds it, on the second call', async () => {
    const r = await m.chat({
      messages: [
        { role: 'system', content: `${SECOND_CALL.proposeSourceEdit}\nכללים` },
        {
          role: 'user',
          content: 'הנחיה: החלף את "הישן" ב"החדש"\n\nהפסקאות:\n§p-1\nכאן יש הישן.\n\n§p-2\nפסקה שנייה.',
        },
      ],
    });
    expect(r.content).toBe('§p-1\nכאן יש החדש.\n\n§p-2\nפסקה שנייה.');
  });

  it('echoes the current payload back on a refine second call', async () => {
    const payload = { type: 'update-step', addActions: ['בדוק'], patch: {} };
    const r = await m.chat({
      messages: [
        { role: 'system', content: `${SECOND_CALL.refineSuggestion}\nכללים` },
        { role: 'user', content: `הנחיה: שפר\n\nההצעה הנוכחית (x):\n${JSON.stringify(payload)}` },
      ],
    });
    expect(JSON.parse(r.content)).toEqual(payload);
  });
});
