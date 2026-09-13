import { describe, it, expect } from 'vitest';
import { buildMessages, parseProposals, PROMPT_VERSION, RESPONSE_FORMAT } from '../src/index.js';
import type { ProposalContext } from '../src/index.js';

const D = '11111111-1111-4111-8111-111111111111';
const ctx: ProposalContext = {
  source: { id: 'src', title: 'נהלי תמיכה טכנית' },
  paragraphs: [],
  diffs: [
    { ref: '4.8', kind: 'changed', before: 'מעל 5 מגה – תקין.', after: 'מעל 6 מגה – תקין.', similarity: 0.9 },
  ],
  linkedSteps: [
    {
      documentId: D,
      documentTitle: 'איטיות גלישה',
      stepKey: 's8',
      stepNum: '8',
      stepTitle: 'בדיקת מהירות גלישה',
      anchor: '4.8',
      actions: ['בקש מהלקוח להריץ Speedtest'],
    },
  ],
  fields: [{ name: 'גלישה בארץ', status: 'ok' }],
  blocks: [],
};

describe('prompt', () => {
  it('builds a system prompt from the versioned file and a user message with the diff', () => {
    const msgs = buildMessages(ctx);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('update-step');
    expect(msgs[1].content).toContain('§4.8');
    expect(msgs[1].content).toContain('s8');
    expect(PROMPT_VERSION).toBe('propose-v1');
    expect(RESPONSE_FORMAT.required).toEqual(['suggestions']);
  });

  it('parses and validates model JSON', () => {
    const text = JSON.stringify({
      suggestions: [
        {
          anchor: '§4.8',
          type: 'update-step',
          title: 'סף Speedtest',
          targetDocumentId: D,
          targetStepKey: 's8',
          targetBlockId: null,
          payload: { type: 'update-step', addActions: ['ודא ניתוק Wi-Fi'], patch: {} },
          confidence: 0.9,
          rationale: 'ערך שונה',
        },
      ],
    });
    const r = parseProposals(text);
    expect(r.ok && r.items[0].targetStepKey).toBe('s8');
  });

  it('parses JSON wrapped in a markdown fence', () => {
    const text =
      '```json\n' +
      JSON.stringify({
        suggestions: [
          {
            anchor: '§1',
            type: 'field-alert',
            title: 'שדה לא מוכר',
            targetDocumentId: null,
            targetStepKey: null,
            targetBlockId: null,
            payload: { type: 'field-alert', fieldName: 'חסימת גלישה', issue: 'unknown' },
            confidence: 0.5,
            rationale: '',
          },
        ],
      }) +
      '\n```';
    const r = parseProposals(text);
    expect(r.ok && r.items).toHaveLength(1);
  });

  it('rejects mismatched payload type and non-json', () => {
    const bad = JSON.stringify({
      suggestions: [
        {
          anchor: '§1',
          type: 'new-card',
          title: 'x',
          targetDocumentId: null,
          targetStepKey: null,
          targetBlockId: null,
          payload: { type: 'update-step', addActions: [], patch: {} },
          confidence: 0.5,
          rationale: '',
        },
      ],
    });
    expect(parseProposals(bad).ok).toBe(false);
    expect(parseProposals('not json').ok).toBe(false);
  });
});
