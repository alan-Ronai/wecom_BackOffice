import { describe, it, expect } from 'vitest';
import { chatReducer, initialChatView } from '../../src/lib/chatReducer.js';

const MSG = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';
const PE = '33333333-3333-4333-8333-333333333333';
const SUG = '44444444-4444-4444-8444-444444444444';
const done = { type: 'done', messageId: MSG, tokensIn: 3, tokensOut: 4, latencyMs: 9 } as const;

describe('chatReducer', () => {
  it('accumulates tokens into the streaming reply and seals it on done', () => {
    let s = initialChatView();
    s = chatReducer(s, { type: 'token', text: 'א' });
    s = chatReducer(s, { type: 'token', text: 'ב' });
    expect(s.streaming?.content).toBe('אב');
    s = chatReducer(s, done);
    expect(s.streaming).toBeNull();
    expect(s.sealed.at(-1)).toMatchObject({ messageId: MSG, content: 'אב', tokensOut: 4 });
  });

  it('keeps tool chips in call order and marks results, payload included', () => {
    let s = initialChatView();
    s = chatReducer(s, { type: 'tool_call', id: 't1', name: 'read_impact', args: {} });
    s = chatReducer(s, {
      type: 'tool_result',
      id: 't1',
      name: 'read_impact',
      ok: true,
      summary: 'ok',
      payload: { documents: 3 },
    });
    expect(s.streaming?.tools).toEqual([
      { id: 't1', name: 'read_impact', args: {}, ok: true, summary: 'ok', payload: { documents: 3 } },
    ]);
  });

  it('gives an orphan tool_result its own chip rather than dropping it', () => {
    const s = chatReducer(initialChatView(), {
      type: 'tool_result',
      id: 't9',
      name: 'draft_step',
      ok: true,
      summary: 'טיוטה',
    });
    expect(s.streaming?.tools).toHaveLength(1);
    expect(s.streaming?.tools[0]).toMatchObject({ id: 't9', name: 'draft_step' });
  });

  it('carries the proposed-edit set with its own document and base version', () => {
    let s = initialChatView();
    s = chatReducer(s, {
      type: 'proposed_edits',
      proposedEditsId: PE,
      messageId: MSG,
      documentId: DOC,
      baseSourceVersion: 7,
      ops: [],
    });
    s = chatReducer(s, {
      type: 'refined_suggestion',
      suggestionId: SUG,
      editedPayload: { type: 'deprecate-step', reason: 'x' },
    });
    expect(s.streaming?.proposed).toEqual({
      proposedEditsId: PE,
      messageId: MSG,
      documentId: DOC,
      baseSourceVersion: 7,
      ops: [],
    });
    expect(s.streaming?.refined?.suggestionId).toBe(SUG);
  });

  it('records an error and stops streaming', () => {
    const s = chatReducer(initialChatView(), {
      type: 'error',
      code: 'AI_RATE_LIMITED',
      message: 'יותר מדי',
    });
    expect(s.error).toBe('יותר מדי');
    expect(s.streaming).toBeNull();
  });
});
